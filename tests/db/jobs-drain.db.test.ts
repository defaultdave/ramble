import { sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { backoffSeconds, deadJobAlertKey, jobLimits } from '@/lib/jobs';
import {
  allRows,
  client,
  clockModule,
  drainAt,
  drainModule,
  handled,
  insertRaw,
  onlyRow,
  raise,
  setupJobsDatabase,
  type Row,
} from './jobsFixtures';

vi.mock('@/server/monitoring/alerts', async () => ({
  alerts: { raise: (await import('./jobsFixtures')).raise },
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - the drain runs a due job once and marks it succeeded with the clock's time; it leaves a job that is not yet due
// - a handler that throws rolls back its writes; the job returns to pending with a backoff and a bounded error
// - a job that fails on its last attempt is dead and raises one alert
// - a job whose kind the registry no longer knows fails like any other
// - a running row with a live lock is left alone; one with a lapsed lock is taken again and spends an attempt;
//   one with a lapsed lock and no attempts left is dead, not run
// - one call stops at 200 jobs and reports the rest as left
// - two drains at once never run the same job twice (the claim takes SKIP LOCKED)

setupJobsDatabase();

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
