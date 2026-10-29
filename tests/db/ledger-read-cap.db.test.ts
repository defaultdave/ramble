import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { bookingPaid } from '@/lib/ledger';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { createLedgerParents } from './ledgerParents';

// Behaviours under test: a statement or export over more grouped rows than the cap is refused, never
// cut short (a total over part of the rows would be wrong); a window at the cap is answered. The cap
// is lowered to 2 here so the test does not need twenty thousand rows.

vi.mock('@/lib/ledger', async (importOriginal) => {
  const original = await importOriginal<typeof import('@/lib/ledger')>();
  return {
    ...original,
    ledgerLimits: { ...original.ledgerLimits, maxReadGroups: 2 },
  };
});

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let ledger: typeof import('@/server/db/ledger');

const ops = testCaller({ roles: [Role.Ops] });
const first = new Date('2026-12-02T00:00:00Z');
const second = new Date('2026-12-04T00:00:00Z');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  stopHttp = await serveNeonHttp(fresh.url);
  client = await import('@/server/db/client');
  ledger = await import('@/server/db/ledger');
  const parents = await createLedgerParents(client.db, 'cap');
  for (const [index, occurredAt] of [first, second].entries()) {
    const orderId = await parents.newOrder();
    const paymentAttemptId = await parents.newAttempt(orderId);
    await client.db.transaction((tx) =>
      ledger.postEntries(
        tx,
        bookingPaid({
          occurredAt,
          simulated: true,
          orderId,
          hostId: parents.hostId,
          paymentAttemptId,
          providerObjectId: `pi_cap_${String(index)}`,
          split: { ticketMinor: 13000, commissionMinor: 1950, taxMinor: 0 },
        }),
      ),
    );
  }
});

afterAll(async () => {
  await stopHttp();
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

describe('the read cap', () => {
  it('answers a window whose groups fit the cap', async () => {
    const rows = await ledger.readFinanceExport(ops, {
      from: new Date('2026-12-01T00:00:00Z'),
      to: new Date('2026-12-03T00:00:00Z'),
    });
    expect(rows).toHaveLength(1);
  });

  it('refuses a window with more groups than the cap, writing and changing nothing', async () => {
    await expect(
      ledger.readFinanceExport(ops, {
        from: new Date('2026-12-01T00:00:00Z'),
        to: new Date('2026-12-08T00:00:00Z'),
      }),
    ).rejects.toThrow(RangeError);
    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ledger_entries`,
    );
    expect(rows[0]?.n).toBe(4);
  });
});
