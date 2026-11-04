import { sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { z } from 'zod';
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest';
import type { JobRegistry } from '@/server/jobs/registry';
import { createFreshDatabase, type FreshDatabase } from './harness';

// Shared setup for the jobs-*.db.test.ts files. Each file mocks the alerts and logger modules itself (the alerts mock
// returns `raise` from here), calls setupJobsDatabase() at its top level for its own schema, then uses the live
// bindings and helpers below under the names it had before the split.

/** The alert spy each file's `vi.mock('@/server/monitoring/alerts')` factory returns. */
export const raise = vi.fn();

let fresh: FreshDatabase;
export let client: typeof import('@/server/db/client');
export let enqueueModule: typeof import('@/server/jobs/enqueue');
export let drainModule: typeof import('@/server/jobs/drain');
export let jobsDb: typeof import('@/server/db/jobs');
export let clockModule: typeof import('@/server/ports/clock');
export let side: Pool;

/**
 * Held shut until a test lets the `gated` and `held` kinds' handlers go on; `entered` resolves once
 * one of them has started, which means the job holds its row lock.
 */
export let gate: {
  promise: Promise<void>;
  open: () => void;
  entered: Promise<void>;
  enter: () => void;
};
function closeGate() {
  let open: () => void = () => undefined;
  let enter: () => void = () => undefined;
  const promise = new Promise<void>((resolve) => {
    open = resolve;
  });
  const entered = new Promise<void>((resolve) => {
    enter = resolve;
  });
  gate = { promise, open, entered, enter };
}

export const handled: { kind: string; jobId: string; payload: unknown }[] = [];
export let testRegistry: JobRegistry;

/** Opens a fresh database for the file that calls it, loads the jobs modules, and registers the test job kinds. */
export function setupJobsDatabase() {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    enqueueModule = await import('@/server/jobs/enqueue');
    drainModule = await import('@/server/jobs/drain');
    jobsDb = await import('@/server/db/jobs');
    clockModule = await import('@/server/ports/clock');
    side = new Pool({ connectionString: fresh.url, max: 4 });

    const record =
      (kind: string) => (context: { jobId: string; payload: unknown }) => {
        handled.push({ kind, jobId: context.jobId, payload: context.payload });
        return Promise.resolve();
      };
    testRegistry = {
      ok: {
        payload: z.object({ n: z.number().optional() }),
        maxAttempts: 3,
        handleIdempotent: record('ok'),
      },
      slow: {
        payload: z.object({}),
        maxAttempts: 3,
        handleIdempotent: async (context) => {
          await new Promise((resolve) => setTimeout(resolve, 10));
          await record('slow')(context);
        },
      },
      poison: {
        payload: z.object({}),
        maxAttempts: 3,
        handleIdempotent: () => Promise.reject(new Error('always fails')),
      },
      held: {
        payload: z.object({}),
        maxAttempts: 3,
        handleIdempotent: async (context) => {
          gate.enter();
          await gate.promise;
          await record('held')(context);
        },
      },
      gated: {
        payload: z.object({}),
        maxAttempts: 2,
        handleIdempotent: async () => {
          gate.enter();
          await gate.promise;
          throw new Error('boom after the gate');
        },
      },
      broken: {
        payload: z.object({}),
        maxAttempts: 2,
        handleIdempotent: async ({ tx }) => {
          // A write the failure must undo: it enqueues another job in the handler's transaction.
          await enqueueModule.enqueue(
            tx,
            { kind: 'ok', payload: { n: 99 } },
            testRegistry,
          );
          throw new Error(`boom for guest@example.com ${'x'.repeat(4000)}`);
        },
      },
    } satisfies JobRegistry;
  });

  afterAll(async () => {
    await side.end();
    await client.db.$client.end();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    handled.length = 0;
    closeGate();
    raise.mockClear();
    await client.db.execute(sql`DELETE FROM jobs`);
  });
}

export type Row = {
  id: string;
  status: string;
  attempts: number;
  max_attempts: number;
  run_after: Date;
  locked_until: Date | null;
  finished_at: Date | null;
  last_error: string | null;
};

/** Timestamps come back as epoch milliseconds, so they compare as Dates whatever the driver's text format. */
export async function allRows(): Promise<Row[]> {
  const { rows } = await client.db.execute<{
    id: string;
    status: string;
    attempts: number;
    max_attempts: number;
    run_after_ms: number | string;
    locked_until_ms: number | string | null;
    finished_at_ms: number | string | null;
    last_error: string | null;
  }>(
    sql`SELECT id, status, attempts, max_attempts,
      (extract(epoch FROM run_after) * 1000)::float8 AS run_after_ms,
      (extract(epoch FROM locked_until) * 1000)::float8 AS locked_until_ms,
      (extract(epoch FROM finished_at) * 1000)::float8 AS finished_at_ms,
      last_error FROM jobs ORDER BY created_at`,
  );
  const date = (ms: number | string | null) =>
    ms === null ? null : new Date(Number(ms));
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    attempts: row.attempts,
    max_attempts: row.max_attempts,
    run_after: new Date(Number(row.run_after_ms)),
    locked_until: date(row.locked_until_ms),
    finished_at: date(row.finished_at_ms),
    last_error: row.last_error,
  }));
}

export async function onlyRow() {
  const rows = await allRows();
  expect(rows).toHaveLength(1);
  return rows[0] as Row;
}

export type RawJob = {
  kind?: string;
  payload?: string;
  dedupeKey?: string | null;
  status?: string;
  attempts?: number;
  maxAttempts?: number;
  runAfter?: string;
  lockedUntil?: string | null;
  finishedAt?: string | null;
  lastError?: string | null;
};

/** Inserts straight into the table, bypassing enqueue, so each CHECK is reached on its own. */
export async function insertRaw(row: RawJob = {}) {
  const result = await client.db.execute<{ id: string }>(sql`
    INSERT INTO jobs (kind, payload, dedupe_key, status, attempts, max_attempts, run_after, locked_until, finished_at, last_error)
    VALUES (
      ${row.kind ?? 'ok'},
      ${row.payload ?? '{}'}::jsonb,
      ${row.dedupeKey ?? null},
      ${row.status ?? 'pending'}::job_status,
      ${row.attempts ?? 0},
      ${row.maxAttempts ?? 3},
      ${row.runAfter ?? '2026-01-01T00:00:00Z'}::timestamptz,
      ${row.lockedUntil ?? null}::timestamptz,
      ${row.finishedAt ?? null}::timestamptz,
      ${row.lastError ?? null}
    ) RETURNING id`);
  return (result.rows[0] as { id: string }).id;
}

export const drainAt = (iso: string) =>
  drainModule.drainJobs(clockModule.fixedClock(new Date(iso)), testRegistry);
