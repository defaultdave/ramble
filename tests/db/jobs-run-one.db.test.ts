import { describe, expect, it, vi } from 'vitest';
import {
  allRows,
  clockModule,
  drainModule,
  handled,
  insertRaw,
  jobsDb,
  onlyRow,
  raise,
  setupJobsDatabase,
  testRegistry,
} from './jobsFixtures';

vi.mock('@/server/monitoring/alerts', async () => ({
  alerts: { raise: (await import('./jobsFixtures')).raise },
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test (the test console's "run one job"):
// - a waiting job runs once and succeeds even when its run_after is far in the future
// - a job that fails goes back to pending with a backoff, and one on its last attempt is dead and raises an alert
// - a job that is finished, dead, running under a live lock, or unknown is not runnable and nothing runs
// - claimJobById itself claims and abandons nothing, and changes no row, for a running job under a live lock, a succeeded job and a dead job
// - a running job whose lock has lapsed is taken again; one with no attempts left is dead without running

setupJobsDatabase();

const now = '2030-01-01T00:00:00Z';
const runOne = (id: string) =>
  drainModule.runJobById(
    id,
    clockModule.fixedClock(new Date(now)),
    testRegistry,
  );

describe('runJobById', () => {
  it('runs a waiting job that is not yet due, once', async () => {
    const id = await insertRaw({ runAfter: '2031-01-01T00:00:00Z' });

    expect(await runOne(id)).toBe('succeeded');

    expect(handled).toHaveLength(1);
    expect(await onlyRow()).toMatchObject({ status: 'succeeded', attempts: 1 });
  });

  it('retries a failing job and dead-letters it on the last attempt', async () => {
    const id = await insertRaw({ kind: 'poison', maxAttempts: 2 });

    expect(await runOne(id)).toBe('retried');
    expect((await onlyRow()).status).toBe('pending');

    expect(await runOne(id)).toBe('dead');
    expect((await onlyRow()).status).toBe('dead');
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it.each([
    [
      'a succeeded job',
      { status: 'succeeded', finishedAt: '2026-01-01T00:00:00Z' },
    ],
    [
      'a dead job',
      { status: 'dead', attempts: 3, finishedAt: '2026-01-01T00:00:00Z' },
    ],
    [
      'a job under a live lock',
      { status: 'running', attempts: 1, lockedUntil: '2030-01-01T00:05:00Z' },
    ],
  ])('does not run %s', async (_name, row) => {
    const id = await insertRaw(row);

    expect(await runOne(id)).toBe('not_runnable');
    expect(handled).toHaveLength(0);
  });

  it('does not run an id that is no job', async () => {
    expect(await runOne('0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b')).toBe(
      'not_runnable',
    );
  });

  it('takes a running job whose lock has lapsed, and spends an attempt', async () => {
    const id = await insertRaw({
      status: 'running',
      attempts: 1,
      lockedUntil: '2029-12-31T23:00:00Z',
    });

    expect(await runOne(id)).toBe('succeeded');
    expect(await onlyRow()).toMatchObject({ status: 'succeeded', attempts: 2 });
  });

  it('dead-letters a lapsed job with no attempts left, without running it', async () => {
    const id = await insertRaw({
      status: 'running',
      attempts: 3,
      lockedUntil: '2029-12-31T23:00:00Z',
    });

    expect(await runOne(id)).toBe('dead');
    expect(handled).toHaveLength(0);
    expect(raise).toHaveBeenCalledTimes(1);
  });
});

describe('claimJobById', () => {
  it.each([
    [
      'a running job under a live lock',
      { status: 'running', attempts: 1, lockedUntil: '2030-01-01T00:05:00Z' },
    ],
    [
      'a succeeded job',
      { status: 'succeeded', finishedAt: '2026-01-01T00:00:00Z' },
    ],
    [
      'a dead job',
      { status: 'dead', attempts: 3, finishedAt: '2026-01-01T00:00:00Z' },
    ],
  ])('leaves %s alone', async (_name, row) => {
    const id = await insertRaw(row);
    const before = await allRows();

    expect(await jobsDb.claimJobById(id, new Date(now))).toEqual({
      claimed: [],
      abandoned: [],
    });
    expect(await allRows()).toEqual(before);
  });
});
