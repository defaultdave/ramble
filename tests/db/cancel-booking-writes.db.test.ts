import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { backendPid, waitUntilBlocked } from './harness';
import { seedBooking } from './confirmOrderFixtures';
import {
  cancelSnapshot,
  seatsSoldOf,
  seedCancellable,
  type CancelWorld,
} from './cancelFixtures';
import {
  clearJobs,
  client,
  getParents,
  orderOf,
  refundsOf,
  setupRefundsDatabase,
  side,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the action `cancelBooking`, the fake payment adapter):
// - the reconcile read takes up to 100 refund rows: an order with 60 failed refund rows cancels, and one with 101 rolls the
//   cancellation back whole (fails if the read is cut short or the bound is loosened)
// - a cancel writes only the order it was asked for: another confirmed booking, on its own session, keeps its status,
//   its cancelled_* columns, its refund totals, and its seats
// - `cancelled_at` is read after the order's lock, so a cancel that waited for another writer is stamped after it (and
//   the CHECK against `confirmed_at` holds)
// - an unknown order, and an order with no session and hold, answer not found and write nothing

const cancel = async (world: CancelWorld, expectedRefundMinor: number) => {
  const { cancelBooking } = await import('@/server/actions/orders');
  return cancelBooking({ manageToken: world.token, expectedRefundMinor });
};

async function fresh(seed: Parameters<typeof seedCancellable>[0] = {}) {
  await clearJobs();
  return seedCancellable(seed);
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** Refund rows that stand for nothing (failed ones are not counted), so only the read bound can change what the check sees. */
async function addFailedRefunds(world: CancelWorld, count: number) {
  await side.query(
    `WITH ids AS (SELECT gen_random_uuid() AS id FROM generate_series(1, $3::int))
     INSERT INTO refunds (id, order_id, payment_attempt_id, ticket_minor, tax_minor, commission_returned_minor, amount_minor, reason, provider_key, status)
     SELECT id, $1, $2, 1, 0, 0, 1, 'goodwill', 'refund:' || id::text, 'failed' FROM ids`,
    [world.orderId, world.attemptId, count],
  );
}

/** What a cancel of this order writes, without the job counts, which every order's cancel moves. */
const ownRows = async (world: CancelWorld) => ({
  ...(await cancelSnapshot(world)),
  jobs: null,
});

describe('the bound on the refund read', () => {
  it('cancels an order with 60 failed refund rows, read whole', async () => {
    const world = await fresh({ gatewayPayment: true });
    await addFailedRefunds(world, 60);

    expect(await cancel(world, 13_000)).toMatchObject({
      status: 'cancelled',
      refundMinor: 13_000,
    });
    expect(await refundsOf(world)).toHaveLength(61);
  });

  it('cancels an order with exactly 100 failed refund rows, the most one read holds', async () => {
    const world = await fresh({
      gatewayPayment: true,
      freeCancelInMinutes: -1,
    });
    await addFailedRefunds(world, 100);

    expect(await cancel(world, 0)).toMatchObject({
      status: 'cancelled',
      refundMinor: 0,
    });
    expect((await orderOf(world)).status).toBe('cancelled');
  });

  it('rolls the cancellation back whole for an order whose refund rows pass the bound', async () => {
    // No refund is due, so no new row is added and only the bound can tell the check anything.
    const world = await fresh({
      gatewayPayment: true,
      freeCancelInMinutes: -1,
    });
    await addFailedRefunds(world, 101);
    const before = await cancelSnapshot(world);

    await expect(cancel(world, 0)).rejects.toThrow('do not reconcile');

    expect(await cancelSnapshot(world)).toEqual(before);
    expect((await orderOf(world)).status).toBe('confirmed');
  });
});

describe('a cancel writes only its own order', () => {
  it('leaves another confirmed booking, on another session, untouched', async () => {
    const mine = await fresh({ gatewayPayment: true });
    const other = await seedCancellable({ gatewayPayment: true });
    const before = await ownRows(other);

    expect(await cancel(mine, 13_000)).toMatchObject({ status: 'cancelled' });

    expect(await ownRows(other)).toEqual(before);
    expect(await orderOf(other)).toMatchObject({
      status: 'confirmed',
      cancelledAt: null,
      cancelledBy: null,
    });
    expect(await seatsSoldOf(other)).toBe(other.seatsSoldBefore);
    expect(await seatsSoldOf(mine)).toBe(mine.seatsSoldBefore - mine.seats);
  });
});

describe('a cancel next to another booking of the same session', () => {
  it('leaves the other booking, on the same session and its own hold, untouched', async () => {
    const mine = await fresh({ gatewayPayment: true });
    const base = await orderOf(mine);
    const sibling = await seedBooking(client.db, getParents(), {
      on: {
        experienceId: base.experienceId,
        hostId: base.hostId,
        sessionId: mine.sessionId,
      },
    });
    await side.query(
      `UPDATE orders SET status = 'confirmed', confirmed_at = clock_timestamp() WHERE id = $1`,
      [sibling.orderId],
    );
    await side.query(`UPDATE holds SET status = 'converted' WHERE id = $1`, [
      sibling.holdId,
    ]);

    expect(await cancel(mine, 13_000)).toMatchObject({ status: 'cancelled' });

    expect(await orderOf(sibling)).toMatchObject({
      status: 'confirmed',
      cancelledAt: null,
      cancelledBy: null,
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
    });
    expect((await orderOf(mine)).status).toBe('cancelled');
  });
});

describe('the time a cancellation is stamped', () => {
  it('is read from the database clock, so an app clock far behind cannot put it before the order was confirmed', async () => {
    const world = await fresh({ gatewayPayment: true });
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() - 10 * 24 * 60 * 60_000,
    });

    expect(await cancel(world, 13_000)).toMatchObject({ status: 'cancelled' });

    const order = await orderOf(world);
    expect(order.cancelledAt?.getTime()).toBeGreaterThanOrEqual(
      order.confirmedAt?.getTime() ?? Infinity,
    );
  });

  it('is after the writer it waited for, so it never reads before the order was confirmed', async () => {
    const world = await fresh({ gatewayPayment: true });
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query(
      'UPDATE orders SET confirmed_at = clock_timestamp() WHERE id = $1',
      [world.orderId],
    );

    const waiting = cancel(world, 13_000);
    await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const released = await holder.query<{ at: Date }>(
      'SELECT clock_timestamp() AS at',
    );
    await holder.query('COMMIT');
    holder.release();

    expect(await waiting).toMatchObject({ status: 'cancelled' });
    const order = await orderOf(world);
    expect(order.cancelledAt?.getTime()).toBeGreaterThanOrEqual(
      released.rows[0]?.at.getTime() ?? Infinity,
    );
    expect(order.cancelledAt?.getTime()).toBeGreaterThan(
      order.confirmedAt?.getTime() ?? Infinity,
    );
  });
});

describe('a token that is not the one that opened this order', () => {
  const forged = async (token: Record<string, unknown>, world: CancelWorld) => {
    const { cancelBookingOrder } = await import('@/server/db/orderCancel');
    return cancelBookingOrder({
      actor: { kind: 'guest' },
      token: {
        id: world.orderId,
        version: 1,
        kind: 'manage',
        ...token,
      } as never,
      expectedRefundMinor: 13_000,
    });
  };

  it.each([
    ['a gift token', { kind: 'gift' }],
    ['an order token', { kind: 'order' }],
    ['a token from before a bump', { version: 2 }],
  ])(
    'refuses %s inside the data layer, and writes nothing',
    async (_name, token) => {
      const world = await fresh({ gatewayPayment: true });
      const before = await cancelSnapshot(world);

      expect(await forged(token, world)).toEqual({ status: 'not_found' });

      expect(await cancelSnapshot(world)).toEqual(before);
      expect((await orderOf(world)).status).toBe('confirmed');
    },
  );

  it('cancels with the token that opened the order', async () => {
    const world = await fresh({ gatewayPayment: true });

    expect(await forged({}, world)).toMatchObject({ status: 'cancelled' });
  });
});

describe('the lock ids of an order', () => {
  const read = async (orderId: string) => {
    const { readOrderLockIds } = await import('@/server/db/locks');
    return client.db.transaction((tx) => readOrderLockIds(tx, orderId));
  };

  it('are the session and hold of a booking', async () => {
    const world = await fresh();

    expect(await read(world.orderId)).toEqual({
      sessionId: world.sessionId,
      holdId: world.holdId,
    });
  });

  it('are null ids for an order that is not a booking, and null for no order', async () => {
    const gift = await seedBooking(client.db, getParents(), {
      orderKind: 'gift_purchase',
    });

    expect(await read(gift.orderId)).toEqual({
      sessionId: null,
      holdId: null,
    });
    expect(await read(randomUUID())).toBeNull();
  });
});

describe('an order that is not a booking to cancel', () => {
  const direct = async (orderId: string) => {
    const { cancelBookingOrder } = await import('@/server/db/orderCancel');
    return cancelBookingOrder({
      actor: { kind: 'guest' },
      token: { id: orderId, version: 1, kind: 'manage' } as never,
      expectedRefundMinor: 0,
    });
  };

  const counts = async () => {
    const { rows } = await client.db.execute<{ audit: string; jobs: string }>(
      sql`SELECT (SELECT count(*) FROM audit_log)::text AS audit, (SELECT count(*) FROM jobs)::text AS jobs`,
    );
    return rows[0];
  };

  it('answers not found for an order that does not exist', async () => {
    const before = await counts();

    expect(await direct(randomUUID())).toEqual({ status: 'not_found' });
    expect(await counts()).toEqual(before);
  });

  it('reads no facts for an order that does not exist', async () => {
    const { readCancelFacts } = await import('@/server/db/ordersCancelFacts');

    expect(
      await client.db.transaction((tx) => readCancelFacts(tx, randomUUID())),
    ).toBeNull();
  });

  it('answers not found for an order with no session and no hold (a gift purchase)', async () => {
    const world = await seedBooking(client.db, getParents(), {
      orderKind: 'gift_purchase',
    });
    const before = await counts();

    // Even with the order's row locked by someone else, the answer needs no lock: it is read before any is taken.
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT id FROM orders WHERE id = $1 FOR UPDATE', [
      world.orderId,
    ]);

    const answer = direct(world.orderId);
    const raced = await Promise.race([
      answer,
      new Promise<'waiting'>((resolve) =>
        setTimeout(() => {
          resolve('waiting');
        }, 1_000),
      ),
    ]);
    await holder.query('COMMIT');
    holder.release();
    await answer;

    expect(raced).toEqual({ status: 'not_found' });
    expect(await counts()).toEqual(before);
    expect((await orderOf(world)).status).toBe('pending_payment');
  });
});
