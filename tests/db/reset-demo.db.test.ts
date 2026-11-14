import { eq, getTableName, sql } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { insertGift } from './giftFixtures';
import { insertHold } from './holdFixtures';
import {
  ask,
  client,
  getParents,
  refundEvent,
  refundsOf,
  seedPaidOrder,
  setupRefundsDatabase,
  storeEvent,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - after a tester has made rows in every table the reset wipes (an order with its lines, payment attempt, ledger rows, refund,
//   transfer and provider event; a hold with its line; a gift with its line; a message and a bounce; jobs), the reset leaves
//   every one of those tables empty, in one go, with the foreign keys between them in the way
// - what the seed owns stays, and a session a tester filled is back to the seats the seed gives it
// - the ledger refuses to be emptied again once the reset is over (the guard was lifted only inside it)

type Tables = typeof import('@/server/db/seed/reset');
type Schema = typeof import('@/server/db/schema');
let reset: Tables;
let schema: Schema;

beforeAll(async () => {
  reset = await import('@/server/db/seed/reset');
  schema = await import('@/server/db/schema');
});

const now = new Date('2026-11-13T15:00:00Z');

async function rowsIn(table: Tables['wipedTables'][number]) {
  const { rows } = await client.db.execute<{ n: number }>(
    sql`SELECT count(*)::int AS n FROM ${sql.identifier(getTableName(table))}`,
  );
  return rows[0]?.n ?? -1;
}

async function seatsSold() {
  const { rows } = await client.db.execute<{ id: string; seats_sold: number }>(
    sql`SELECT id, seats_sold FROM sessions ORDER BY id`,
  );
  return new Map(rows.map((row) => [row.id, row.seats_sold]));
}

/** One of everything a tester makes, built through the fixtures the other db tests use. */
async function makeTesterRows() {
  const { db } = client;
  const parents = getParents();
  const world = await seedPaidOrder();
  const [order] = await db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  if (!order?.holdId) throw new Error('no order or hold');
  await db.insert(schema.holdItems).values({
    holdId: order.holdId,
    priceOptionId: parents.priceOptionId,
    quantity: 2,
    unitPriceMinor: 6500,
    usesSpace: true,
  });
  await insertHold(db, parents.sessionId, { deviceKey: 'e'.repeat(64) });

  const gift = await insertGift(db, parents);
  await db.insert(schema.giftItems).values({
    giftId: gift.id,
    priceOptionId: parents.priceOptionId,
    label: 'Adult',
    quantity: 1,
    unitPriceMinor: 5000,
    taxRatePpm: 0,
    usesSpace: true,
    lineTotalMinor: 5000,
  });

  await db.insert(schema.transfers).values({
    orderId: world.orderId,
    hostId: world.hostId,
    releaseAfter: new Date(now.getTime() + 7 * 86_400_000),
    providerKey: `transfer:${world.orderId}`,
  });

  await ask(world);
  const [refund] = await refundsOf(world);
  if (!refund) throw new Error('no refund');
  await storeEvent(
    refundEvent(
      world,
      { id: refund.id, amountMinor: refund.ticketMinor },
      'refund.succeeded',
    ),
  );

  const [message] = await db
    .insert(schema.messages)
    .values({
      idempotencyKey: `reset-test:${world.orderId}`,
      template: 'order-confirmation',
      recipient: 'pat@example.com',
      subject: 'Your booking',
      status: 'queued',
      adapter: 'fake',
    })
    .returning({ id: schema.messages.id });
  await db.insert(schema.emailSuppressions).values({
    address: 'bounced@example.com',
    reason: 'hard_bounce',
    sourceMessageId: message?.id ?? null,
  });
  await db.insert(schema.jobs).values({
    kind: 'reset-test',
    payload: { orderId: world.orderId },
    dedupeKey: `reset-test:${world.orderId}`,
  });

  // A tester's booking took seats from a session of the seed's.
  const [seeded] = await db
    .select({ id: schema.sessions.id })
    .from(schema.sessions)
    .where(
      sql`${schema.sessions.seatsSold} = 0 AND ${schema.sessions.allocation} >= 2 AND ${schema.sessions.id} <> ${parents.sessionId}`,
    )
    .limit(1);
  if (!seeded) throw new Error('no seeded session with room');
  await db
    .update(schema.sessions)
    .set({ seatsSold: 2 })
    .where(eq(schema.sessions.id, seeded.id));
  await db
    .update(schema.sessions)
    .set({ seatsSold: 1 })
    .where(eq(schema.sessions.id, parents.sessionId));
  return { world, seededSessionId: seeded.id };
}

describe('resetDemoData', () => {
  it('empties every wiped table, keeps what the seed owns, and restores the seats', async () => {
    const { seedCaller } = await import('@/server/db/seed/caller');
    const { runSeed } = await import('@/server/db/seed/run');
    await runSeed({ caller: seedCaller, now });
    const seatsAfterSeed = await seatsSold();
    const catalogue = async () => {
      const { rows } = await client.db.execute<Record<string, number>>(
        sql`SELECT (SELECT count(*)::int FROM experiences) AS experiences,
          (SELECT count(*)::int FROM hosts) AS hosts,
          (SELECT count(*)::int FROM guests) AS guests,
          (SELECT count(*)::int FROM price_options) AS price_options,
          (SELECT count(*)::int FROM audit_log) AS audit_log,
          (SELECT count(*)::int FROM consents) AS consents`,
      );
      return rows[0];
    };

    const { seededSessionId } = await makeTesterRows();
    for (const table of reset.wipedTables) {
      expect(await rowsIn(table), getTableName(table)).toBeGreaterThan(0);
    }
    const keptBefore = await catalogue();
    expect((await seatsSold()).get(seededSessionId)).toBe(2);

    const report = await reset.resetDemoData({ now });

    for (const table of reset.wipedTables) {
      expect(await rowsIn(table), getTableName(table)).toBe(0);
    }
    expect(await catalogue()).toEqual(keptBefore);
    const seatsAfterReset = await seatsSold();
    for (const [id, seats] of seatsAfterSeed) {
      expect(seatsAfterReset.get(id), id).toBe(seats);
    }
    expect([...seatsAfterReset.values()].reduce((a, b) => a + b, 0)).toBe(
      [...seatsAfterSeed.values()].reduce((a, b) => a + b, 0),
    );
    expect(report.curated.experiences).toBeGreaterThan(0);
  });

  it('puts the ledger guard back: the ledger still refuses to be emptied', async () => {
    await expect(
      client.db.execute(sql`TRUNCATE ledger_entries`),
    ).rejects.toMatchObject({ cause: { code: '23001' } });
  });
});
