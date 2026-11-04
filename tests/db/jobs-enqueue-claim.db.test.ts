import { describe, expect, it, vi } from 'vitest';
import {
  allRows,
  clockModule,
  client,
  drainAt,
  enqueueModule,
  insertRaw,
  jobsDb,
  onlyRow,
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
// - enqueue writes in the caller's transaction (it vanishes if the caller rolls back), is a no-op for a used dedupe key,
//   and writes nothing for an unknown kind
// - a claim skips rows another transaction has locked
// - a job inserted without run_after is stamped from the clock port, so it is claimable at that clock's now even when
//   the clock runs behind the database's

setupJobsDatabase();

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

describe('insertJob run_after', () => {
  it('stamps run_after from the clock when the caller gives none', async () => {
    const skewedNow = new Date('2000-01-01T00:00:00Z');

    await client.db.transaction((tx) =>
      jobsDb.insertJob(
        tx,
        { kind: 'ok', payload: {}, maxAttempts: 3 },
        clockModule.fixedClock(skewedNow),
      ),
    );

    const { claimed } = await jobsDb.claimDueJobs(skewedNow, 25);
    expect(claimed).toHaveLength(1);
  });
});
