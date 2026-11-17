import { getTableName, type SQL } from 'drizzle-orm';
import { PgDialect } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - on a production deployment, and on the production-demo target, the reset throws before it opens a transaction, writes anything or runs the seed
// - elsewhere it lifts the ledger's keep-table guard, empties the wiped tables in one statement, puts the guard back, and clears seats sold, all in one transaction, then reruns the seed once as the seed caller with the clock it was given
// - after the seed it writes the past bookings and reviews again, as the seed caller with the same clock, since the wipe took them
// - a failure in the transaction means neither the seed nor the past bookings run

const mocks = vi.hoisted(() => ({
  env: { VERCEL_ENV: undefined as string | undefined, SEED_TARGET: 'staging' },
  runSeed: vi.fn(),
  seedReviews: vi.fn(),
  executed: [] as SQL[],
  updated: [] as unknown[],
  transaction:
    vi.fn<(body: (tx: unknown) => Promise<unknown>) => Promise<unknown>>(),
}));

vi.mock('@/server/env', () => ({ env: mocks.env }));
vi.mock('./run', () => ({ runSeed: mocks.runSeed }));
vi.mock('./reviews', () => ({ seedReviews: mocks.seedReviews }));
vi.mock('@/server/db/client', () => ({
  db: { transaction: mocks.transaction },
}));

import { seedCaller } from './caller';
import { ResetRefusedError, resetDemoData, wipedTables } from './reset';

const dialect = new PgDialect();
const now = new Date('2026-11-13T15:00:00Z');
const textOf = (query: SQL) => dialect.sqlToQuery(query).sql;

beforeEach(() => {
  mocks.env.VERCEL_ENV = undefined;
  mocks.env.SEED_TARGET = 'staging';
  mocks.executed.length = 0;
  mocks.updated.length = 0;
  mocks.runSeed.mockReset().mockResolvedValue({ seeded: true });
  mocks.seedReviews.mockReset().mockResolvedValue({ bookings: 11, reviews: 9 });
  mocks.transaction.mockReset().mockImplementation((body) =>
    body({
      execute: (query: SQL) => {
        mocks.executed.push(query);
        return Promise.resolve();
      },
      update: () => ({
        set: (values: unknown) => ({
          where: () => {
            mocks.updated.push(values);
            return Promise.resolve();
          },
        }),
      }),
    }),
  );
});

describe('resetDemoData refusals', () => {
  it.each([
    ['a production deployment', 'production', 'staging'],
    ['a production deployment with no target', 'production', undefined],
    ['the production-demo target', undefined, 'production-demo'],
  ])(
    'refuses %s before anything is opened or written',
    async (_what, vercelEnv, seedTarget) => {
      mocks.env.VERCEL_ENV = vercelEnv;
      mocks.env.SEED_TARGET = seedTarget as string;
      await expect(resetDemoData({ now })).rejects.toBeInstanceOf(
        ResetRefusedError,
      );
      expect(mocks.transaction).not.toHaveBeenCalled();
      expect(mocks.runSeed).not.toHaveBeenCalled();
    },
  );
});

describe('resetDemoData', () => {
  it('empties the wiped tables in one transaction, with the ledger guard lifted only inside it', async () => {
    await resetDemoData({ now });
    expect(mocks.transaction).toHaveBeenCalledTimes(1);
    const statements = mocks.executed.map(textOf);
    expect(statements).toHaveLength(3);
    expect(statements[0]).toMatch(
      /^ALTER TABLE "ledger_entries" DISABLE TRIGGER "ledger_entries_keep_table"$/,
    );
    expect(statements[1]).toBe(
      `TRUNCATE ${wipedTables.map((table) => `"${getTableName(table)}"`).join(', ')}`,
    );
    expect(statements[2]).toMatch(
      /^ALTER TABLE "ledger_entries" ENABLE TRIGGER "ledger_entries_keep_table"$/,
    );
  });

  it('clears the seats sold, and reruns the seed once as the seed caller with the clock', async () => {
    const log = vi.fn();
    expect(await resetDemoData({ now, log })).toEqual({ seeded: true });
    expect(mocks.updated).toEqual([{ seatsSold: 0 }]);
    expect(mocks.runSeed).toHaveBeenCalledTimes(1);
    expect(mocks.runSeed).toHaveBeenCalledWith({
      caller: seedCaller,
      now,
      log,
    });
  });

  it('writes the past bookings and reviews again after the seed, as the seed caller with the same clock', async () => {
    await resetDemoData({ now });
    expect(mocks.seedReviews).toHaveBeenCalledExactlyOnceWith(seedCaller, now);
    expect(mocks.seedReviews.mock.invocationCallOrder[0]).toBeGreaterThan(
      mocks.runSeed.mock.invocationCallOrder[0] ?? Infinity,
    );
  });

  it('does not run the seed or write the past bookings when the wipe fails', async () => {
    mocks.transaction.mockRejectedValue(new Error('refused'));
    await expect(resetDemoData({ now })).rejects.toThrow('refused');
    expect(mocks.runSeed).not.toHaveBeenCalled();
    expect(mocks.seedReviews).not.toHaveBeenCalled();
  });
});
