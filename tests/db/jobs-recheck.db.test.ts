import { sql } from 'drizzle-orm';
import type { PoolClient } from 'pg';
import { describe, expect, it, vi } from 'vitest';
import { logger } from '@/server/monitoring/logger';
import { backendPid, waitUntilBlocked } from './harness';
import {
  allRows,
  client,
  clockModule,
  drainAt,
  drainModule,
  gate,
  handled,
  insertRaw,
  onlyRow,
  raise,
  setupJobsDatabase,
  side,
  testRegistry,
} from './jobsFixtures';

vi.mock('@/server/monitoring/alerts', async () => ({
  alerts: { raise: (await import('./jobsFixtures')).raise },
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - a job whose claim is no longer ours when its row lock is granted does not run (the locked re-check)
// - a failure is recorded only while the claim is still ours; one that cannot be recorded is counted and logged
//   by name, and the rest of the batch still runs

setupJobsDatabase();

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
      await waitUntilBlocked(side, { blockedBy: otherPid });
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
      await waitUntilBlocked(side, { pid: otherPid });
      gate.open();
      await queued;
      await waitUntilBlocked(side, { blockedBy: otherPid });
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
