import 'server-only';
import {
  deadJobAlertKey,
  drainMayContinue,
  failureOutcome,
  jobLimits,
  nextClaimSize,
  ownsClaim,
} from '@/lib/jobs';
import { db } from '@/server/db/client';
import {
  claimDueJobs,
  countDueJobs,
  lockJobForRun,
  markJobFailed,
  markJobSucceeded,
  type ClaimedJob,
} from '@/server/db/jobs';
import { alerts } from '@/server/monitoring/alerts';
import { logger } from '@/server/monitoring/logger';
import type { Clock } from '@/server/ports/clock';
import { findJob, jobRegistry, type JobRegistry } from './registry';

export type DrainReport = {
  claimed: number;
  succeeded: number;
  retried: number;
  dead: number;
  /** Jobs whose failure could not be written down; they are reclaimed once their lock lapses. */
  unrecorded: number;
  /** Jobs still due when the call stopped, counted up to 1,000. */
  left: number;
};

export type RunOutcome = 'succeeded' | 'retried' | 'dead' | 'lost';

function raiseDead(kind: string, jobId: string): void {
  alerts.raise('job-dead', 'error', deadJobAlertKey(kind, jobId), {
    kind,
    jobId,
  });
}

/**
 * Runs one claimed job in its own transaction. The row is read again under its lock first: if the
 * claim is no longer ours (the lock lapsed and another drain took the job, or it finished), the
 * handler does not run. A handler that throws rolls back its writes, then the failure is recorded
 * in a second transaction: a retry after a backoff, or a dead letter on the last attempt.
 */
export async function runJob(
  job: ClaimedJob,
  clock: Clock,
  registry: JobRegistry = jobRegistry,
): Promise<RunOutcome> {
  try {
    return await db.transaction(async (tx) => {
      const row = await lockJobForRun(tx, job.id);
      if (!row || !ownsClaim(row, job)) return 'lost';
      const definition = findJob(registry, row.kind);
      if (!definition) throw new Error('Unknown job kind');
      const payload: unknown = definition.payload.parse(row.payload);
      await definition.handleIdempotent({
        tx,
        payload,
        jobId: job.id,
        clock,
      });
      await markJobSucceeded(tx, job.id, clock.now());
      return 'succeeded';
    });
  } catch (error) {
    // The error's message is not logged: a driver error can carry query parameters.
    logger.warn('job failed', {
      jobId: job.id,
      kind: job.kind,
      attempt: job.attempts,
      errorName: error instanceof Error ? error.name : 'NonError',
    });
    return recordFailure(job, error, clock);
  }
}

async function recordFailure(
  job: ClaimedJob,
  error: unknown,
  clock: Clock,
): Promise<RunOutcome> {
  const outcome = await db.transaction(async (tx) => {
    const row = await lockJobForRun(tx, job.id);
    if (!row || !ownsClaim(row, job)) return 'lost';
    const now = clock.now();
    const failure = failureOutcome({
      attempts: row.attempts,
      maxAttempts: row.maxAttempts,
      jobId: job.id,
      now,
      error,
    });
    await markJobFailed(tx, job.id, failure, now);
    return failure.status === 'dead' ? 'dead' : 'retried';
  });
  if (outcome === 'dead') raiseDead(job.kind, job.id);
  return outcome;
}

/**
 * Claims and runs due jobs until none are left, 200 have been claimed, or 60 seconds have passed.
 * The limits are checked between claims, so a call can run a little past them by one batch of 25.
 * Two drains at once never take the same row. Delivery is at least once.
 */
export async function drainJobs(
  clock: Clock,
  registry: JobRegistry = jobRegistry,
): Promise<DrainReport> {
  const startedAt = performance.now();
  const report: DrainReport = {
    claimed: 0,
    succeeded: 0,
    retried: 0,
    dead: 0,
    unrecorded: 0,
    left: 0,
  };

  while (
    drainMayContinue({
      claimed: report.claimed,
      elapsedMs: performance.now() - startedAt,
    })
  ) {
    const { claimed, abandoned } = await claimDueJobs(
      clock.now(),
      nextClaimSize(report.claimed),
    );
    for (const job of abandoned) raiseDead(job.kind, job.id);
    report.dead += abandoned.length;
    if (claimed.length === 0 && abandoned.length === 0) break;
    report.claimed += claimed.length;

    for (const job of claimed) {
      let outcome: RunOutcome;
      try {
        outcome = await runJob(job, clock, registry);
      } catch (error) {
        // Recording the failure itself failed (the database is unreachable, say). The row keeps its
        // lock and is reclaimed once it lapses, so the rest of the batch still runs.
        logger.error('job failure could not be recorded', {
          jobId: job.id,
          kind: job.kind,
          errorName: error instanceof Error ? error.name : 'NonError',
        });
        report.unrecorded += 1;
        continue;
      }
      if (outcome === 'succeeded') report.succeeded += 1;
      else if (outcome === 'retried') report.retried += 1;
      else if (outcome === 'dead') report.dead += 1;
    }
  }

  report.left = await countDueJobs(clock.now(), jobLimits.leftCountCap);
  return report;
}
