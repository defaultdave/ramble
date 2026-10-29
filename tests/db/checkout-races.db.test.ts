import { count, eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { holds, orders, paymentAttempts } from '@/server/db/schema';
import type { Device } from '@/server/device';
import { formFor, holdFor, ordersFor, publishLegal } from './checkoutFixtures';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { minute, seedBookable } from './holdFixtures';
import { testDevice } from '../deviceFixture';

// The payment path's real-database concurrency tests (design doc 4.2.3 rule 1, ADR 0002 item 13).
// Behaviours under test, one per decision, branch or risk:
// - a payment that waits for the session lock judges the hold again after it: a hold released or lapsed
//   meanwhile answers hold_expired and no order is written (each fails if the locked re-check is removed)
// - a payment that waits for the session lock reads the order again after it: a confirmation committed
//   meanwhile answers already_confirmed and no second attempt is made
// - two first calls on one hold at once make one order and one attempt, in each of 5 rounds
// - payments, reserves, and releases on one session in parallel, 20 rounds: no deadlock and no error

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let checkout: typeof import('@/server/db/checkout');
let holdData: typeof import('@/server/db/holds');
let locks: typeof import('@/server/db/locks');
let guestA: Device;
let guestB: Device;
let termsId: string;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  checkout = await import('@/server/db/checkout');
  holdData = await import('@/server/db/holds');
  locks = await import('@/server/db/locks');
  guestA = await testDevice('checkout-race-a');
  guestB = await testDevice('checkout-race-b');
  termsId = (await publishLegal(client.db, 'terms', 1)).id;
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
const inTransaction = (body: (tx: Tx) => Promise<void>) =>
  client.db.transaction(body);

const pay = (holdId: string, device = guestA) =>
  checkout.startPaymentTx(device, formFor(holdId, termsId), 'fake');

async function orderCount() {
  const [row] = await client.db.select({ n: count() }).from(orders);
  return row?.n ?? 0;
}

describe('a payment that waits for the session lock', () => {
  it.each([
    [
      'released',
      (tx: Tx, holdId: string) =>
        tx
          .update(holds)
          .set({ status: 'released', releasedReason: 'guest_left' })
          .where(eq(holds.id, holdId)),
    ],
    [
      'lapsed',
      (tx: Tx, holdId: string) =>
        tx
          .update(holds)
          .set({
            createdAt: new Date(Date.now() - 30 * minute),
            updatedAt: new Date(Date.now() - 30 * minute),
            expiresAt: new Date(Date.now() - 20 * minute),
          })
          .where(eq(holds.id, holdId)),
    ],
  ])(
    'answers hold_expired when the hold was %s meanwhile',
    async (_name, change) => {
      const bookable = await seedBookable(client.db);
      const hold = await holdFor(client.db, bookable, guestA);
      const before = await orderCount();

      const answer = await raceAgainstOpenTransaction(
        inTransaction,
        async (tx) => {
          await locks.lockSessionRow(tx, bookable.session.id);
          await locks.lockHoldRow(tx, hold.id);
          await change(tx, hold.id);
        },
        () => pay(hold.id),
      );

      expect(answer).toEqual({
        done: true,
        result: { status: 'hold_expired', canRehold: true, spacesLeft: 10 },
      });
      expect(await orderCount()).toBe(before);
      expect(await ordersFor(client.db, hold.id)).toEqual([]);
    },
  );

  it('answers already_confirmed when the order was confirmed meanwhile, without a second attempt', async () => {
    const bookable = await seedBookable(client.db);
    const hold = await holdFor(client.db, bookable, guestA);
    const first = await pay(hold.id);
    if (first.done) throw new Error('expected a payment to start');

    const answer = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockSessionRow(tx, bookable.session.id);
        await locks.lockHoldRow(tx, hold.id);
        await locks.lockOrderRow(tx, `book:${hold.id}`);
        await tx
          .update(orders)
          .set({ status: 'confirmed', confirmedAt: new Date() })
          .where(eq(orders.id, first.order.id));
        await tx
          .update(holds)
          .set({ status: 'converted' })
          .where(eq(holds.id, hold.id));
      },
      () => pay(hold.id),
    );

    expect(answer).toMatchObject({
      done: true,
      result: {
        status: 'already_confirmed',
        reference: first.order.reference,
      },
    });
    const attempts = await client.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.orderId, first.order.id));
    expect(attempts).toHaveLength(1);
  });
});

describe('two first calls on one hold at once', () => {
  it.each([1, 2, 3, 4, 5])(
    'make one order and one attempt (round %i)',
    async () => {
      const bookable = await seedBookable(client.db);
      const hold = await holdFor(client.db, bookable, guestA);

      const [one, two] = await Promise.all([pay(hold.id), pay(hold.id)]);
      if (one.done || two.done)
        throw new Error('expected both to start a payment');

      expect(two.order.id).toBe(one.order.id);
      expect(two.attempt.id).toBe(one.attempt.id);
      expect([one.attempt.existed, two.attempt.existed].toSorted()).toEqual([
        false,
        true,
      ]);
      const [attempts] = await client.db
        .select({ n: count() })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, one.order.id));
      expect(attempts?.n).toBe(1);
      expect(await ordersFor(client.db, hold.id)).toHaveLength(1);
    },
  );
});

describe('the lock order', () => {
  it('lets payments, reserves, and releases on one session run together without a deadlock', async () => {
    const bookable = await seedBookable(client.db, { allocation: 100 });
    const reserve = (device: Device) =>
      holdData.reserveSpaces(device, {
        sessionId: bookable.session.id,
        items: [{ priceOptionId: bookable.adult.id, quantity: 1 }],
        purpose: 'booking',
      });

    for (let round = 0; round < 20; round += 1) {
      const held = await reserve(guestA);
      if (held.status !== 'held') throw new Error(`not held: ${held.status}`);
      const results = await Promise.allSettled([
        pay(held.holdId),
        pay(held.holdId),
        reserve(guestB),
        holdData.releaseHold(guestA, { holdId: held.holdId }),
      ]);

      expect(
        results.filter((result) => result.status === 'rejected'),
        `round ${String(round)}`,
      ).toEqual([]);
    }
  });
});
