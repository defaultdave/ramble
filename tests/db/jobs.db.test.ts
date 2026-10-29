import { sql } from 'drizzle-orm';
import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { backoffSeconds, deadJobAlertKey, jobLimits } from '@/lib/jobs';
import type { JobRegistry } from '@/server/jobs/registry';
import { logger } from '@/server/monitoring/logger';
import { createFreshDatabase, type FreshDatabase } from './harness';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - the database accepts a well-formed job and refuses each bad row: kind shape and length, payload type and size,
//   dedupe key shape and reuse, max attempts range, attempts range, last-error length, finished_at and locked_until
//   out of step with status, and a run_after outside the readable years
// - enqueue writes in the caller's transaction (it vanishes if the caller rolls back), is a no-op for a used dedupe key,
//   and writes nothing for an unknown kind
// - the drain runs a due job once and marks it succeeded with the clock's time; it leaves a job that is not yet due
// - a handler that throws rolls back its writes; the job returns to pending with a backoff and a bounded error
// - a job that fails on its last attempt is dead and raises one alert
// - a job whose kind the registry no longer knows fails like any other
// - a running row with a live lock is left alone; one with a lapsed lock is taken again and spends an attempt;
//   one with a lapsed lock and no attempts left is dead, not run
// - one call stops at 200 jobs and reports the rest as left
// - two drains at once never run the same job twice (the claim takes SKIP LOCKED)
// - a claim skips rows another transaction has locked
// - a job whose claim is no longer ours when its row lock is granted does not run (the locked re-check)

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let enqueueModule: typeof import('@/server/jobs/enqueue');
let drainModule: typeof import('@/server/jobs/drain');
let jobsDb: typeof import('@/server/db/jobs');
let clockModule: typeof import('@/server/ports/clock');
let side: Pool;

/**
 * Held shut until a test lets the `gated` and `held` kinds' handlers go on; `entered` resolves once
 * one of them has started, which means the job holds its row lock.
 */
let gate: {
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

const handled: { kind: string; jobId: string; payload: unknown }[] = [];
let testRegistry: JobRegistry;

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

type Row = {
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
async function allRows(): Promise<Row[]> {
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

async function onlyRow() {
  const rows = await allRows();
  expect(rows).toHaveLength(1);
  return rows[0] as Row;
}

type RawJob = {
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
async function insertRaw(row: RawJob = {}) {
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

const drainAt = (iso: string) =>
  drainModule.drainJobs(clockModule.fixedClock(new Date(iso)), testRegistry);

describe('jobs constraints', () => {
  it('accepts a well-formed row', async () => {
    await insertRaw({ kind: 'send-email', dedupeKey: 'order:1/mail_2.x' });

    expect((await onlyRow()).status).toBe('pending');
  });

  it.each([
    ['an upper-case kind', { kind: 'Send' }, 'jobs_kind_shape'],
    ['a double hyphen', { kind: 'a--b' }, 'jobs_kind_shape'],
    ['a leading hyphen', { kind: '-a' }, 'jobs_kind_shape'],
    ['an empty kind', { kind: '' }, 'jobs_kind_shape'],
    ['a trailing newline', { kind: 'a\n' }, 'jobs_kind_shape'],
    ['a kind of 65 characters', { kind: 'a'.repeat(65) }, 'jobs_kind_shape'],
    ['an array payload', { payload: '[]' }, 'jobs_payload_bounded'],
    ['a string payload', { payload: '"x"' }, 'jobs_payload_bounded'],
    [
      'a payload over 16 KB',
      { payload: JSON.stringify({ text: 'x'.repeat(20_000) }) },
      'jobs_payload_bounded',
    ],
    [
      'a dedupe key with a space',
      { dedupeKey: 'a b' },
      'jobs_dedupe_key_shape',
    ],
    ['an empty dedupe key', { dedupeKey: '' }, 'jobs_dedupe_key_shape'],
    [
      'a dedupe key of 201 characters',
      { dedupeKey: 'k'.repeat(201) },
      'jobs_dedupe_key_shape',
    ],
    ['zero max attempts', { maxAttempts: 0 }, 'jobs_max_attempts_range'],
    ['21 max attempts', { maxAttempts: 21 }, 'jobs_max_attempts_range'],
    [
      'attempts past max attempts',
      { attempts: 4, maxAttempts: 3 },
      'jobs_attempts_range',
    ],
    ['negative attempts', { attempts: -1 }, 'jobs_attempts_range'],
    [
      'a last error of 2001 characters',
      { lastError: 'e'.repeat(2001) },
      'jobs_last_error_bounded',
    ],
    [
      'a succeeded job with no finish time',
      { status: 'succeeded' },
      'jobs_finished_matches_status',
    ],
    [
      'a dead job with no finish time',
      { status: 'dead' },
      'jobs_finished_matches_status',
    ],
    [
      'a pending job with a finish time',
      { finishedAt: '2026-01-01T00:00:00Z' },
      'jobs_finished_matches_status',
    ],
    [
      'a running job with no lock',
      { status: 'running', attempts: 1 },
      'jobs_locked_matches_status',
    ],
    [
      'a pending job with a lock',
      { lockedUntil: '2026-01-01T00:00:00Z' },
      'jobs_locked_matches_status',
    ],
    [
      'a run time before year 1000',
      { runAfter: '0500-01-01T00:00:00Z' },
      'jobs_run_after_readable',
    ],
    [
      'a run time in year 10000',
      { runAfter: '10000-01-01T00:00:00Z' },
      'jobs_run_after_readable',
    ],
  ])('refuses %s', async (_name, row, constraint) => {
    await expect(insertRaw(row)).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it('accepts a payload and last error exactly at their limits', async () => {
    await insertRaw({
      payload: JSON.stringify({ text: 'x'.repeat(16_000) }),
      lastError: 'e'.repeat(2000),
    });

    expect(await allRows()).toHaveLength(1);
  });

  it('refuses a second row with the same dedupe key, and allows many with none', async () => {
    await insertRaw({ dedupeKey: 'same' });
    await insertRaw();
    await insertRaw();

    await expect(insertRaw({ dedupeKey: 'same' })).rejects.toMatchObject({
      cause: { constraint: 'jobs_dedupe_key_unique' },
    });
  });

  it('refuses a null kind and a null payload', async () => {
    await insertRaw();
    await expect(
      client.db.execute(sql`UPDATE jobs SET kind = NULL`),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
    await expect(
      client.db.execute(sql`UPDATE jobs SET payload = NULL`),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});

describe('enqueue', () => {
  const enqueue = (input: Parameters<typeof enqueueModule.enqueue>[1]) =>
    client.db.transaction((tx) =>
      enqueueModule.enqueue(tx, input, testRegistry),
    );

  it('writes a pending job with the kind max attempts', async () => {
    const result = await enqueue({ kind: 'ok', payload: { n: 1 } });

    const row = await onlyRow();
    expect(result).toEqual({ id: row.id });
    expect(row).toMatchObject({
      status: 'pending',
      attempts: 0,
      max_attempts: 3,
    });
  });

  it('honours runAfter', async () => {
    await enqueue({
      kind: 'ok',
      payload: {},
      runAfter: new Date('2030-05-05T05:05:05Z'),
    });

    expect((await onlyRow()).run_after).toEqual(
      new Date('2030-05-05T05:05:05Z'),
    );
  });

  it('writes nothing if the caller rolls back', async () => {
    await expect(
      client.db.transaction(async (tx) => {
        await enqueueModule.enqueue(
          tx,
          { kind: 'ok', payload: {} },
          testRegistry,
        );
        throw new Error('the change failed');
      }),
    ).rejects.toThrow('the change failed');

    expect(await allRows()).toHaveLength(0);
  });

  it('is a no-op for a dedupe key already used, even after the job finished', async () => {
    const first = await enqueue({ kind: 'ok', payload: {}, dedupeKey: 'k1' });
    await drainAt('2030-01-01T00:00:00Z');
    const second = await enqueue({ kind: 'ok', payload: {}, dedupeKey: 'k1' });

    expect(first).not.toBeNull();
    expect(second).toBeNull();
    expect(await allRows()).toHaveLength(1);
  });

  it('writes nothing for an unknown kind or a bad payload', async () => {
    await expect(enqueue({ kind: 'nope', payload: {} })).rejects.toThrow();
    await expect(
      enqueue({ kind: 'ok', payload: { n: 'text' } }),
    ).rejects.toThrow();

    expect(await allRows()).toHaveLength(0);
  });
});

describe('drain', () => {
  const t0 = '2030-01-01T00:00:00Z';

  it('runs a due job once and marks it succeeded at the clock time', async () => {
    const id = await insertRaw({ payload: '{"n":7}' });

    const report = await drainAt(t0);

    expect(report).toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      dead: 0,
      lost: 0,
      unrecorded: 0,
      left: 0,
    });
    expect(handled).toEqual([{ kind: 'ok', jobId: id, payload: { n: 7 } }]);
    expect(await onlyRow()).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      locked_until: null,
      finished_at: new Date(t0),
    });
  });

  it('leaves a job that is not yet due, and runs it once it is', async () => {
    await insertRaw({ runAfter: '2030-06-01T00:00:00Z' });

    expect((await drainAt(t0)).claimed).toBe(0);
    expect((await onlyRow()).status).toBe('pending');
    expect((await drainAt('2030-06-01T00:00:00Z')).succeeded).toBe(1);
  });

  it('does not run a finished or dead job again', async () => {
    await insertRaw({
      status: 'succeeded',
      finishedAt: '2026-01-01T00:00:00Z',
    });
    await insertRaw({
      status: 'dead',
      attempts: 3,
      finishedAt: '2026-01-01T00:00:00Z',
    });

    expect((await drainAt(t0)).claimed).toBe(0);
    expect(handled).toHaveLength(0);
  });

  it('rolls back a failed handler, schedules a backoff, and stores a bounded redacted error', async () => {
    const id = await insertRaw({ kind: 'broken', maxAttempts: 2 });

    const report = await drainAt(t0);

    expect(report).toMatchObject({
      claimed: 1,
      succeeded: 0,
      retried: 1,
      dead: 0,
    });
    const rows = await allRows();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Row;
    expect(row).toMatchObject({
      id,
      status: 'pending',
      attempts: 1,
      locked_until: null,
      finished_at: null,
    });
    expect(row.run_after).toEqual(
      new Date(new Date(t0).getTime() + backoffSeconds(1, id) * 1000),
    );
    expect(row.last_error).toMatch(/^Error: boom for \[redacted:email\]/);
    expect((row.last_error ?? '').length).toBeLessThanOrEqual(
      jobLimits.lastErrorMaxChars,
    );
    expect(raise).not.toHaveBeenCalled();
  });

  it('retries later and dead-letters on the last attempt with one alert', async () => {
    const id = await insertRaw({ kind: 'broken', maxAttempts: 2 });

    await drainAt(t0);
    const second = await drainAt('2030-01-02T00:00:00Z');

    expect(second).toMatchObject({ claimed: 1, retried: 0, dead: 1 });
    expect(await onlyRow()).toMatchObject({
      status: 'dead',
      attempts: 2,
      finished_at: new Date('2030-01-02T00:00:00Z'),
      locked_until: null,
    });
    expect(raise).toHaveBeenCalledExactlyOnceWith(
      'job-dead',
      'error',
      deadJobAlertKey('broken', id),
      { kind: 'broken', jobId: id },
    );
  });

  it('fails a job whose kind the registry does not know, like any other', async () => {
    await insertRaw({ kind: 'ghost' });

    const report = await drainAt(t0);

    expect(report.retried).toBe(1);
    expect((await onlyRow()).last_error).toBe('Error: Unknown job kind');
  });

  it('fails a job whose stored payload the kind now refuses', async () => {
    await insertRaw({ payload: '{"n":"text"}' });

    expect((await drainAt(t0)).retried).toBe(1);
    expect(handled).toHaveLength(0);
  });

  it('leaves a running row with a live lock alone', async () => {
    await insertRaw({
      status: 'running',
      attempts: 1,
      lockedUntil: '2030-01-01T00:04:00Z',
    });

    expect((await drainAt('2030-01-01T00:03:00Z')).claimed).toBe(0);
    expect(handled).toHaveLength(0);
  });

  it('takes a running row again once its lock has lapsed, spending an attempt', async () => {
    await insertRaw({
      status: 'running',
      attempts: 1,
      lockedUntil: '2030-01-01T00:04:00Z',
    });

    const report = await drainAt('2030-01-01T00:05:00Z');

    expect(report.succeeded).toBe(1);
    expect(await onlyRow()).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('marks a lapsed running row with no attempts left dead, without running it', async () => {
    const id = await insertRaw({
      status: 'running',
      attempts: 3,
      lockedUntil: '2030-01-01T00:04:00Z',
    });

    const report = await drainAt('2030-01-01T00:05:00Z');

    expect(report).toMatchObject({ claimed: 1, dead: 1 });
    expect(handled).toHaveLength(0);
    expect(await onlyRow()).toMatchObject({
      status: 'dead',
      attempts: 3,
      locked_until: null,
      last_error: 'AbandonedJob: the lock lapsed with no attempts left',
    });
    expect(raise).toHaveBeenCalledExactlyOnceWith(
      'job-dead',
      'error',
      deadJobAlertKey('ok', id),
      { kind: 'ok', jobId: id },
    );
  });

  it('stops at 200 jobs and reports the rest as left', async () => {
    await client.db.execute(sql`
      INSERT INTO jobs (kind, payload, run_after)
      SELECT 'noop', '{}'::jsonb, '2026-01-01T00:00:00Z' FROM generate_series(1, 205)`);

    const report = await drainModule.drainJobs(
      clockModule.fixedClock(new Date(t0)),
    );

    expect(report).toEqual({
      claimed: 200,
      succeeded: 200,
      retried: 0,
      dead: 0,
      lost: 0,
      unrecorded: 0,
      left: 5,
    });
  });

  it('runs two drains at once without running any job twice', async () => {
    await client.db.execute(sql`
      INSERT INTO jobs (kind, payload, run_after)
      SELECT 'slow', '{}'::jsonb, '2026-01-01T00:00:00Z' FROM generate_series(1, 60)`);

    const [a, b] = await Promise.all([drainAt(t0), drainAt(t0)]);

    const ids = handled.map((entry) => entry.jobId);
    expect(ids).toHaveLength(60);
    expect(new Set(ids).size).toBe(60);
    expect(a.succeeded + b.succeeded).toBe(60);
    expect(a.claimed + b.claimed).toBe(60);
    expect((await allRows()).every((row) => row.attempts === 1)).toBe(true);
  });
});

describe('claim', () => {
  it('skips rows another transaction has locked', async () => {
    for (let index = 0; index < 10; index += 1) await insertRaw();
    const holder = await side.connect();
    try {
      await holder.query('BEGIN');
      const { rows: held } = await holder.query<{ id: string }>(
        'SELECT id FROM jobs ORDER BY created_at LIMIT 5 FOR UPDATE',
      );

      const { claimed } = await jobsDb.claimDueJobs(
        new Date('2030-01-01T00:00:00Z'),
        25,
      );

      const heldIds = new Set(held.map((row) => row.id));
      expect(claimed).toHaveLength(5);
      expect(claimed.some((job) => heldIds.has(job.id))).toBe(false);
    } finally {
      await holder.query('ROLLBACK');
      holder.release();
    }
  });

  it('takes at most the limit, oldest first, and spends one attempt each', async () => {
    const first = await insertRaw({ runAfter: '2026-01-01T00:00:00Z' });
    await insertRaw({ runAfter: '2026-01-03T00:00:00Z' });
    const second = await insertRaw({ runAfter: '2026-01-02T00:00:00Z' });

    const { claimed } = await jobsDb.claimDueJobs(
      new Date('2030-01-01T00:00:00Z'),
      2,
    );

    expect(claimed.map((job) => job.id)).toEqual([first, second]);
    expect(claimed.every((job) => job.attempts === 1)).toBe(true);
    expect(claimed[0]?.lockedUntil).toEqual(new Date('2030-01-01T00:05:00Z'));
  });
});

/** Polls until `check` is true, so a loaded machine only makes a test slower, never reorders it. */
async function waitUntil(
  what: string,
  check: () => Promise<boolean>,
  timeoutMs = 15_000,
) {
  const deadline = performance.now() + timeoutMs;
  while (!(await check())) {
    if (performance.now() > deadline) {
      throw new Error(`timed out waiting until ${what}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

/** Whether a backend of this database, other than `exceptPid`, is queued behind a row lock. */
async function someoneIsWaitingForALock(exceptPid: number) {
  const { rows } = await side.query(
    `SELECT 1 FROM pg_stat_activity
     WHERE datname = current_database() AND wait_event_type = 'Lock' AND pid <> $1`,
    [exceptPid],
  );
  return rows.length > 0;
}

async function isWaitingForALock(pid: number) {
  const { rows } = await side.query(
    `SELECT 1 FROM pg_stat_activity WHERE pid = $1 AND wait_event_type = 'Lock'`,
    [pid],
  );
  return rows.length > 0;
}

async function backendPid(connection: PoolClient) {
  const { rows } = await connection.query<{ pid: number }>(
    'SELECT pg_backend_pid() AS pid',
  );
  return (rows[0] as { pid: number }).pid;
}

const t0 = new Date('2030-01-01T00:00:00Z');
const finishedMeanwhile = `UPDATE jobs SET status = 'succeeded', locked_until = NULL, finished_at = clock_timestamp() WHERE id = $1`;
const takenAgain = `UPDATE jobs SET attempts = attempts + 1, locked_until = locked_until + interval '10 minutes' WHERE id = $1`;

describe('the locked re-check before a job runs', () => {
  /**
   * Drains two jobs. The first (`held`) stops at the gate, so the second is already claimed when a
   * second connection locks its row; the drain then queues for that lock when it reaches the
   * second job, and `change` alters the row before the lock is released.
   */
  async function drainWhileAnotherTransactionChangesTheSecondRow(
    change: string,
  ) {
    await insertRaw({ kind: 'held', runAfter: '2026-01-01T00:00:00Z' });
    const second = await insertRaw({ runAfter: '2026-01-02T00:00:00Z' });

    const other: PoolClient = await side.connect();
    let draining: ReturnType<typeof drainModule.drainJobs> | undefined;
    try {
      const otherPid = await backendPid(other);
      draining = drainModule.drainJobs(
        clockModule.fixedClock(t0),
        testRegistry,
      );
      await gate.entered; // both jobs are claimed; the second one is not locked by anyone
      await other.query('BEGIN');
      await other.query('SELECT id FROM jobs WHERE id = $1 FOR UPDATE', [
        second,
      ]);
      gate.open();
      await waitUntil('the drain is queued for the second row', () =>
        someoneIsWaitingForALock(otherPid),
      );
      await other.query(change, [second]);
      await other.query('COMMIT');
      return { report: await draining, second };
    } finally {
      gate.open();
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
      await draining?.catch(() => undefined);
    }
  }

  it('does not run a job that finished while it waited for the lock', async () => {
    const { report, second } =
      await drainWhileAnotherTransactionChangesTheSecondRow(finishedMeanwhile);

    expect(report).toMatchObject({ claimed: 2, succeeded: 1, lost: 1 });
    expect(handled.map((entry) => entry.kind)).toEqual(['held']);
    const row = (await allRows()).find((entry) => entry.id === second);
    expect(row).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('does not run a job another drain took again while it waited', async () => {
    const { report } =
      await drainWhileAnotherTransactionChangesTheSecondRow(takenAgain);

    expect(report).toMatchObject({ claimed: 2, succeeded: 1, lost: 1 });
    expect(handled.map((entry) => entry.kind)).toEqual(['held']);
  });

  it('runs a job whose row was only touched, not taken', async () => {
    const { report } = await drainWhileAnotherTransactionChangesTheSecondRow(
      `UPDATE jobs SET last_error = 'seen' WHERE id = $1`,
    );

    expect(report).toMatchObject({ claimed: 2, succeeded: 2, lost: 0 });
    expect(handled.map((entry) => entry.kind)).toEqual(['held', 'ok']);
  });
});

describe('the locked re-check when recording a failure', () => {
  /**
   * Drains one job whose handler throws. A second connection queues for the row lock while the
   * handler still holds it, so it is granted the lock the moment the handler's transaction rolls
   * back, and the failure recording has to wait behind it. `change` alters the row before that lock
   * is released.
   */
  async function failWhileAnotherTransactionChangesTheRow(change: string) {
    const id = await insertRaw({ kind: 'gated', maxAttempts: 2 });

    const other: PoolClient = await side.connect();
    let draining: ReturnType<typeof drainModule.drainJobs> | undefined;
    try {
      const otherPid = await backendPid(other);
      draining = drainModule.drainJobs(
        clockModule.fixedClock(t0),
        testRegistry,
      );
      await gate.entered; // the handler now holds the row lock and waits at the gate
      const before = await onlyRow();
      await other.query('BEGIN');
      const queued = other.query(
        'SELECT id FROM jobs WHERE id = $1 FOR UPDATE',
        [id],
      );
      await waitUntil('the side connection is queued for the row', () =>
        isWaitingForALock(otherPid),
      );
      gate.open();
      await queued;
      await waitUntil('the failure recording is queued for the row', () =>
        someoneIsWaitingForALock(otherPid),
      );
      await other.query(change, [id]);
      await other.query('COMMIT');
      return { report: await draining, before };
    } finally {
      gate.open();
      await other.query('ROLLBACK').catch(() => undefined);
      other.release();
      await draining?.catch(() => undefined);
    }
  }

  it('records nothing when another drain took the job again while the handler ran', async () => {
    const { report, before } =
      await failWhileAnotherTransactionChangesTheRow(takenAgain);

    expect(report).toMatchObject({ claimed: 1, lost: 1, retried: 0, dead: 0 });
    expect(await onlyRow()).toEqual({
      ...before,
      attempts: before.attempts + 1,
      locked_until: new Date((before.locked_until as Date).getTime() + 600_000),
    });
    expect(raise).not.toHaveBeenCalled();
  });

  it('records nothing when the job finished meanwhile', async () => {
    const { report, before } =
      await failWhileAnotherTransactionChangesTheRow(finishedMeanwhile);

    expect(report).toMatchObject({ claimed: 1, lost: 1, retried: 0, dead: 0 });
    const row = await onlyRow();
    expect(row).toMatchObject({
      status: 'succeeded',
      attempts: 1,
      last_error: null,
      locked_until: null,
    });
    expect(row.run_after).toEqual(before.run_after);
    expect(raise).not.toHaveBeenCalled();
  });
});

describe('a failure that cannot be recorded', () => {
  it('is counted and logged by name, and the rest of the batch still runs', async () => {
    await client.db.execute(sql`
      CREATE FUNCTION refuse_poison_failure() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.kind = 'poison' AND NEW.status <> 'running' THEN
          RAISE EXCEPTION 'refused for guest@example.com';
        END IF;
        RETURN NEW;
      END $$`);
    await client.db.execute(sql`
      CREATE TRIGGER refuse_poison_failure BEFORE UPDATE ON jobs
      FOR EACH ROW EXECUTE FUNCTION refuse_poison_failure()`);
    try {
      const poison = await insertRaw({
        kind: 'poison',
        runAfter: '2026-01-01T00:00:00Z',
      });
      await insertRaw({ runAfter: '2026-01-02T00:00:00Z' });
      await insertRaw({ runAfter: '2026-01-03T00:00:00Z' });

      const report = await drainAt('2030-01-01T00:00:00Z');

      expect(report).toMatchObject({
        claimed: 3,
        succeeded: 2,
        retried: 0,
        dead: 0,
        lost: 0,
        unrecorded: 1,
      });
      expect(handled).toHaveLength(2);
      const stuck = (await allRows()).find((row) => row.id === poison);
      expect(stuck).toMatchObject({ status: 'running', last_error: null });
      expect(logger.error).toHaveBeenCalledExactlyOnceWith(
        'job failure could not be recorded',
        { jobId: poison, kind: 'poison', errorName: 'Error' },
      );
      expect(JSON.stringify(vi.mocked(logger.error).mock.calls)).not.toContain(
        'guest@example.com',
      );
    } finally {
      await client.db.execute(sql`DROP TRIGGER refuse_poison_failure ON jobs`);
      await client.db.execute(sql`DROP FUNCTION refuse_poison_failure()`);
    }
  });
});
