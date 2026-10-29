import { z } from 'zod';
import { isSlug } from './catalog';
import { redactString } from './redact';

export const jobStatuses = ['pending', 'running', 'succeeded', 'dead'] as const;
export type JobStatus = (typeof jobStatuses)[number];

/**
 * The numbers the outbox runs on. They change here without a migration, except the four the
 * database also enforces (kind length, payload bytes, attempts range, last-error length), which
 * the `jobs` CHECKs spell out.
 */
export const jobLimits = {
  kindMaxChars: 64,
  dedupeKeyMaxChars: 200,
  payloadMaxBytes: 16 * 1024,
  maxAttemptsCeiling: 20,
  defaultMaxAttempts: 8,
  lastErrorMaxChars: 2000,
  claimBatch: 25,
  lockSeconds: 5 * 60,
  drainMaxJobs: 200,
  drainMaxMillis: 60_000,
  backoffBaseSeconds: 30,
  backoffCapSeconds: 6 * 60 * 60,
  asOfWindowDays: 400,
  pulseBodyMaxBytes: 1024,
} as const;

/** Shared with the `jobs_dedupe_key_shape` CHECK, which spells the same pattern. */
export const dedupeKeyPattern = String.raw`^[A-Za-z0-9][A-Za-z0-9:_./-]*$`;

const JobKindSchema = z
  .string()
  .max(jobLimits.kindMaxChars)
  .refine(isSlug, { message: 'Lower-case words joined by single hyphens' });

const DedupeKeySchema = z
  .string()
  .max(jobLimits.dedupeKeyMaxChars)
  .regex(new RegExp(dedupeKeyPattern));

// Postgres reads a timestamp outside these years back as something JavaScript cannot hold.
const earliestRunAfter = new Date(Date.UTC(1000, 0, 1));
const latestRunAfter = new Date(Date.UTC(9999, 11, 31));

export const EnqueueInputSchema = z.object({
  kind: JobKindSchema,
  dedupeKey: DedupeKeySchema.optional(),
  runAfter: z.date().min(earliestRunAfter).max(latestRunAfter).optional(),
});

/** Serialized size of a payload, the figure the 16 KB cap is judged on before the insert. */
function payloadBytes(payload: unknown): number {
  const text = JSON.stringify(payload) as string | undefined;
  return new TextEncoder().encode(text ?? '').length;
}

export function payloadFits(payload: unknown): boolean {
  return payloadBytes(payload) <= jobLimits.payloadMaxBytes;
}

// FNV-1a, so the jitter is a pure function of the job ID and tests stay deterministic.
function unitFraction(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  // FNV-1a leaves ids that differ only in their last characters close together; this final mix spreads them.
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b) >>> 0;
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35) >>> 0;
  hash ^= hash >>> 16;
  return (hash >>> 0) / 2 ** 32;
}

/**
 * Seconds to wait after the `attempts`th failure: 30 seconds doubling to a 6-hour cap, then up to
 * 20 percent shorter by a jitter taken from the job ID, so jobs that failed together do not all
 * return together and the cap is never exceeded.
 */
export function backoffSeconds(attempts: number, jobId: string): number {
  const exponent = Math.min(Math.max(attempts - 1, 0), 30);
  const nominal = Math.min(
    jobLimits.backoffCapSeconds,
    jobLimits.backoffBaseSeconds * 2 ** exponent,
  );
  return Math.round(nominal * (1 - 0.2 * unitFraction(jobId)));
}

export type ClaimableRow = {
  status: JobStatus;
  runAfter: Date;
  lockedUntil: Date | null;
  attempts: number;
  maxAttempts: number;
};

export type ClaimDecision = 'claim' | 'abandon' | 'skip';

/**
 * What a drain does with a row it has locked. A pending row is due once `runAfter` has passed; a
 * running row is due once its lock has lapsed, which means the drain that took it died. Each claim
 * spends an attempt, so a job that crashes its runner every time still reaches its last attempt;
 * a lapsed row with none left is abandoned (dead) instead of claimed.
 */
export function claimDecision(row: ClaimableRow, now: Date): ClaimDecision {
  const due =
    (row.status === 'pending' && row.runAfter <= now) ||
    (row.status === 'running' &&
      row.lockedUntil !== null &&
      row.lockedUntil <= now);
  if (!due) return 'skip';
  return row.attempts >= row.maxAttempts ? 'abandon' : 'claim';
}

export function lockExpiry(now: Date): Date {
  return new Date(now.getTime() + jobLimits.lockSeconds * 1000);
}

export type JobClaim = { attempts: number; lockedUntil: Date };

/**
 * Whether the row, read again under its lock, is still the claim this drain made. If the lock
 * lapsed and another drain took the job, or the job finished meanwhile, running it again would
 * deliver twice.
 */
export function ownsClaim(
  row: { status: JobStatus; attempts: number; lockedUntil: Date | null },
  claim: JobClaim,
): boolean {
  return (
    row.status === 'running' &&
    row.attempts === claim.attempts &&
    row.lockedUntil !== null &&
    row.lockedUntil.getTime() === claim.lockedUntil.getTime()
  );
}

/** The error kind and a redacted, bounded message: what is stored in `last_error`. */
export function describeJobError(error: unknown): string {
  const name = error instanceof Error ? error.name : 'NonError';
  const message = error instanceof Error ? error.message : 'thrown value';
  // Leaves room for the truncation marker so the stored text stays within the column's CHECK.
  return redactString(`${name}: ${message}`, jobLimits.lastErrorMaxChars - 100);
}

export type FailureOutcome =
  | { status: 'dead'; lastError: string }
  | { status: 'pending'; runAfter: Date; lastError: string };

/** After a failed run: retry later, or dead-letter once the last attempt has been spent. */
export function failureOutcome(input: {
  attempts: number;
  maxAttempts: number;
  jobId: string;
  now: Date;
  error: unknown;
}): FailureOutcome {
  const lastError = describeJobError(input.error);
  if (input.attempts >= input.maxAttempts) return { status: 'dead', lastError };
  const delay = backoffSeconds(input.attempts, input.jobId);
  return {
    status: 'pending',
    runAfter: new Date(input.now.getTime() + delay * 1000),
    lastError,
  };
}

export const abandonedMessage =
  'AbandonedJob: the lock lapsed with no attempts left';

/** One call stops claiming after 200 jobs or 60 seconds, whichever comes first. */
export function drainMayContinue(progress: {
  claimed: number;
  elapsedMs: number;
}): boolean {
  return (
    progress.claimed < jobLimits.drainMaxJobs &&
    progress.elapsedMs < jobLimits.drainMaxMillis
  );
}

/** How many rows the next claim may take: a full batch, or what is left of the call's job budget. */
export function nextClaimSize(claimed: number): number {
  return Math.min(jobLimits.claimBatch, jobLimits.drainMaxJobs - claimed);
}

/** The purge deletes in batches; a short batch means nothing expired is left. */
export function purgeMayContinue(input: {
  purged: number;
  batchSize: number;
  elapsedMs: number;
}): boolean {
  return (
    input.purged >= input.batchSize &&
    input.elapsedMs < jobLimits.drainMaxMillis
  );
}

/** Groups every alert for one job into one Sentry issue; the kind is cut so the key stays within 100. */
export function deadJobAlertKey(kind: string, jobId: string): string {
  return `${kind.slice(0, 40)}:${jobId}`;
}

/** Reads `Authorization: Bearer <token>`; anything else is no token. */
export function bearerToken(header: string | null): string | null {
  const match = /^bearer ([!-~]{1,256})$/i.exec(header ?? '');
  return match?.[1] ?? null;
}

const PulseBodySchema = z.strictObject({
  asOf: z.iso.datetime({ offset: true }).max(40).optional(),
});

export type PulseBody = { ok: true; asOf: Date | undefined } | { ok: false };

/** An empty body is a plain pulse. Anything else must be `{ "asOf": "<ISO date-time>" }` and nothing more. */
export function parsePulseBody(text: string): PulseBody {
  if (text.trim() === '') return { ok: true, asOf: undefined };
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    return { ok: false };
  }
  const parsed = PulseBodySchema.safeParse(json);
  if (!parsed.success) return { ok: false };
  return {
    ok: true,
    asOf:
      parsed.data.asOf === undefined ? undefined : new Date(parsed.data.asOf),
  };
}

export type ClockChoice =
  | { ok: true; asOf: Date | undefined }
  | { ok: false; reason: 'demo-clock-off' | 'out-of-range' };

/**
 * Whether a manual time may be used: only while `DEMO_CLOCK` is on, and only within 400 days of
 * the real time either way, so a typo cannot fire a year of reminders.
 */
export function chooseClock(input: {
  asOf: Date | undefined;
  demoClock: 'on' | 'off';
  realNow: Date;
}): ClockChoice {
  if (input.asOf === undefined) return { ok: true, asOf: undefined };
  if (input.demoClock !== 'on') return { ok: false, reason: 'demo-clock-off' };
  const windowMs = jobLimits.asOfWindowDays * 24 * 60 * 60 * 1000;
  const distance = Math.abs(input.asOf.getTime() - input.realNow.getTime());
  if (!(distance <= windowMs)) return { ok: false, reason: 'out-of-range' };
  return { ok: true, asOf: input.asOf };
}
