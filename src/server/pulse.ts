import 'server-only';
import { clientAddress } from '@/lib/clientAddress';
import { declaredLengthExceeds } from '@/lib/email/message';
import { cleanupMayContinue } from '@/lib/holds';
import { bearerToken } from '@/lib/http';
import {
  chooseClock,
  decidePulse,
  heartbeatDue,
  type DrainReport,
  jobLimits,
  parsePulseBody,
  purgeMayContinue,
} from '@/lib/jobs';
import { readBodyText } from '@/server/boundedBody';
import { releaseLapsedHolds, scrubReleasedHolds } from '@/server/db/holds';
import { PURGE_BATCH, purgeExpiredRateLimits } from '@/server/db/rateLimits';
import { env } from '@/server/env';
import { drainJobs } from '@/server/jobs/drain';
import { sendHeartbeat } from '@/server/monitoring/heartbeat';
import { fixedClock, systemClock } from '@/server/ports/clock';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { secureEqual } from '@/server/secureEqual';

type PulseCounts = DrainReport & {
  purged: number;
  holdsReleased: number;
  holdsScrubbed: number;
};

type PulseResult =
  | { status: 200; counts: PulseCounts }
  | { status: 400 | 401 | 413 }
  | { status: 429; retryAfterSeconds: number };

type Progress = { done: number; batches: number; elapsedMs: number };

/** Runs a batch function, summing what it did, until `mayContinue` says the work is done or out of budget. */
async function runBatches(
  startedAt: number,
  batch: () => Promise<number>,
  mayContinue: (progress: Progress) => boolean,
): Promise<number> {
  let total = 0;
  for (let batches = 1; ; batches += 1) {
    const done = await batch();
    total += done;
    if (
      !mayContinue({ done, batches, elapsedMs: performance.now() - startedAt })
    ) {
      return total;
    }
  }
}

/** Deletes expired rate-limit rows in batches until a short batch or the call's time budget ends. */
function purgeRateLimits(startedAt: number): Promise<number> {
  return runBatches(startedAt, purgeExpiredRateLimits, (progress) =>
    purgeMayContinue({
      purged: progress.done,
      batchSize: PURGE_BATCH,
      elapsedMs: progress.elapsedMs,
    }),
  );
}

/**
 * Releases lapsed holds, then scrubs the hashes of long-released ones, each in capped batches. Holds
 * are judged at database time inside each batch, so a demo `asOf` clock never releases one early.
 */
async function cleanUpHolds(
  startedAt: number,
): Promise<{ holdsReleased: number; holdsScrubbed: number }> {
  return {
    holdsReleased: await runBatches(
      startedAt,
      releaseLapsedHolds,
      cleanupMayContinue,
    ),
    holdsScrubbed: await runBatches(
      startedAt,
      scrubReleasedHolds,
      cleanupMayContinue,
    ),
  };
}

/**
 * Every entry the pulse runs, in order. The later units' entries join this list:
 * TODO(U-097): synthetic booking and timing checks; TODO(U-098): hourly dump trigger.
 */
async function runPulse(
  asOf: Date | undefined,
  heartbeat: boolean,
): Promise<PulseCounts> {
  const startedAt = performance.now();
  const report = await drainJobs(asOf ? fixedClock(asOf) : systemClock);
  const purged = await purgeRateLimits(startedAt);
  const { holdsReleased, holdsScrubbed } = await cleanUpHolds(startedAt);
  if (
    heartbeatDue({ sendHeartbeat: heartbeat, unrecorded: report.unrecorded })
  ) {
    await sendHeartbeat(env.BETTERSTACK_HEARTBEAT_URL);
  }
  return { ...report, purged, holdsReleased, holdsScrubbed };
}

async function handlePulse(request: Request): Promise<PulseResult> {
  const token = bearerToken(request.headers.get('authorization'));
  const secret = env.PULSE_SECRET;
  const gates = {
    method: request.method,
    secretSet: Boolean(secret),
    tokenMatches: Boolean(token && secret && secureEqual(token, secret)),
  };
  const entry = decidePulse({ ...gates, asOf: undefined });
  if (entry.action === 'refuse') return { status: 401 };
  if (entry.action === 'reject-secret') {
    const failures = await consumeRateLimit(
      'pulse_failed',
      clientAddress(request.headers.get('x-forwarded-for')),
    );
    return failures.allowed
      ? { status: 401 }
      : { status: 429, retryAfterSeconds: failures.retryAfterSeconds };
  }

  const budget = await consumeRateLimit('pulse', 'schedule');
  if (!budget.allowed) {
    return { status: 429, retryAfterSeconds: budget.retryAfterSeconds };
  }

  if (
    declaredLengthExceeds(
      request.headers.get('content-length'),
      jobLimits.pulseBodyMaxBytes,
    )
  ) {
    return { status: 413 };
  }
  const { text, exceeded } = await readBodyText(
    request,
    jobLimits.pulseBodyMaxBytes,
  );
  if (exceeded) return { status: 413 };

  const body = parsePulseBody(text);
  if (!body.ok) return { status: 400 };
  const clock = chooseClock({
    asOf: body.asOf,
    demoClock: env.DEMO_CLOCK,
    realNow: systemClock.now(),
  });
  if (!clock.ok) return { status: 400 };

  const run = decidePulse({ ...gates, asOf: clock.asOf });
  return {
    status: 200,
    counts: await runPulse(
      clock.asOf,
      run.action === 'run' && run.sendHeartbeat,
    ),
  };
}

/**
 * The HTTP answer for `/api/pulse`. Any method but POST, and a missing or wrong secret, get the
 * same empty 401 with no work done; failed tries are counted per source address. A good call is
 * counted on one shared cap, then drains the jobs and runs the rest of the pulse. The answer holds
 * counts only. Any error is thrown, so a failed pulse is a 500 and sends no heartbeat.
 */
export async function pulseResponse(request: Request): Promise<Response> {
  const result = await handlePulse(request);
  if (result.status === 200) return Response.json(result.counts);
  if (result.status === 429) {
    return new Response(null, {
      status: 429,
      headers: { 'retry-after': String(result.retryAfterSeconds) },
    });
  }
  return new Response(null, { status: result.status });
}
