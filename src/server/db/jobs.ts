import 'server-only';
import { and, asc, eq, inArray, lte, or, sql } from 'drizzle-orm';
import {
  abandonedMessage,
  lockExpiry,
  partitionClaims,
  type FailureOutcome,
  type JobClaim,
} from '@/lib/jobs';
import { db, type Transaction } from './client';
import { jobs } from './schema';

export type ClaimedJob = JobClaim & {
  id: string;
  kind: string;
  payload: unknown;
  maxAttempts: number;
};

export type AbandonedJob = { id: string; kind: string };

function dueAt(now: Date) {
  return or(
    and(eq(jobs.status, 'pending'), lte(jobs.runAfter, now)),
    and(eq(jobs.status, 'running'), lte(jobs.lockedUntil, now)),
  );
}

/** Writes one job in the caller's transaction. A dedupe key already used writes nothing and returns null. */
export async function insertJob(
  tx: Transaction,
  values: {
    kind: string;
    payload: unknown;
    dedupeKey?: string | undefined;
    maxAttempts: number;
    runAfter?: Date | undefined;
  },
): Promise<{ id: string } | null> {
  const [row] = await tx
    .insert(jobs)
    .values(values)
    .onConflictDoNothing({
      target: jobs.dedupeKey,
      where: sql`${jobs.dedupeKey} IS NOT NULL`,
    })
    .returning({ id: jobs.id });
  return row ?? null;
}

/**
 * One short transaction: locks up to `limit` due rows with SKIP LOCKED, so a second drain at the
 * same moment gets other rows, then marks the ones `src/lib/jobs.ts` says to claim as running with
 * a lock and a spent attempt, and the ones it says to abandon as dead. The SQL filter only picks
 * candidates; the decision on each locked row is the lib's.
 */
export async function claimDueJobs(
  now: Date,
  limit: number,
): Promise<{ claimed: ClaimedJob[]; abandoned: AbandonedJob[] }> {
  return db.transaction(async (tx) => {
    const candidates = await tx
      .select()
      .from(jobs)
      .where(dueAt(now))
      .orderBy(asc(jobs.runAfter), asc(jobs.createdAt))
      .limit(limit)
      .for('update', { skipLocked: true });

    const { toClaim, toAbandon } = partitionClaims(candidates, now);

    const lockedUntil = lockExpiry(now);
    const claimed =
      toClaim.length === 0
        ? []
        : await tx
            .update(jobs)
            .set({
              status: 'running',
              attempts: sql`${jobs.attempts} + 1`,
              lockedUntil,
            })
            .where(
              inArray(
                jobs.id,
                toClaim.map((row) => row.id),
              ),
            )
            .returning({
              id: jobs.id,
              kind: jobs.kind,
              payload: jobs.payload,
              attempts: jobs.attempts,
              maxAttempts: jobs.maxAttempts,
            });

    if (toAbandon.length > 0) {
      await tx
        .update(jobs)
        .set({
          status: 'dead',
          lockedUntil: null,
          finishedAt: now,
          lastError: abandonedMessage,
        })
        .where(
          inArray(
            jobs.id,
            toAbandon.map((row) => row.id),
          ),
        );
    }

    return {
      claimed: claimed.map((row) => ({ ...row, lockedUntil })),
      abandoned: toAbandon.map(({ id, kind }) => ({ id, kind })),
    };
  });
}

/** Reads a job under its row lock, waiting for any other holder. */
export async function lockJobForRun(tx: Transaction, id: string) {
  const [row] = await tx
    .select({
      id: jobs.id,
      kind: jobs.kind,
      payload: jobs.payload,
      status: jobs.status,
      attempts: jobs.attempts,
      maxAttempts: jobs.maxAttempts,
      lockedUntil: jobs.lockedUntil,
    })
    .from(jobs)
    .where(eq(jobs.id, id))
    .for('update');
  return row;
}

export async function markJobSucceeded(
  tx: Transaction,
  id: string,
  now: Date,
): Promise<void> {
  await tx
    .update(jobs)
    .set({ status: 'succeeded', lockedUntil: null, finishedAt: now })
    .where(eq(jobs.id, id));
}

export async function markJobFailed(
  tx: Transaction,
  id: string,
  outcome: FailureOutcome,
  now: Date,
): Promise<void> {
  await tx
    .update(jobs)
    .set(
      outcome.status === 'dead'
        ? {
            status: 'dead',
            lockedUntil: null,
            finishedAt: now,
            lastError: outcome.lastError,
          }
        : {
            status: 'pending',
            lockedUntil: null,
            runAfter: outcome.runAfter,
            lastError: outcome.lastError,
          },
    )
    .where(eq(jobs.id, id));
}

/** How many jobs are due now, counted up to `cap` so the query stays bounded. */
export async function countDueJobs(now: Date, cap: number): Promise<number> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(dueAt(now))
    .limit(cap);
  return rows.length;
}
