import { afterEach, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { backendPid, waitUntilBlocked } from './harness';
import {
  seatsSoldOf,
  seedCancellable,
  type CancelWorld,
} from './cancelFixtures';
import {
  ask,
  client,
  clearJobs,
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
// - the lock order is session, then hold, then order: a cancel waiting on the session holds no other lock; a cancel
//   waiting on the hold holds the session's and not the order's (fails if a lock is dropped or the order is reversed)
// - a cancel waits for the hold's lock, so a path holding the hold finishes before the cancel judges it
// - the data layer parses its input at the entry: a bad id, version, or refund throws before anything is read or written, and an upper-case id is the same order
// - the refunds reconcile after a cancellation that follows an earlier partial refund (two refund rows), and the
//   cancellation rolls back whole when the order's totals do not match its refund rows

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
});

type Row = 'sessions' | 'holds' | 'orders';

/** Whether another connection can take the row's lock right now: false means the cancel holds it. */
async function isLocked(table: Row, id: string): Promise<boolean> {
  try {
    await side.query(
      `SELECT id FROM ${table} WHERE id = $1 FOR UPDATE NOWAIT`,
      [id],
    );
    return false;
  } catch (error) {
    if ((error as { code?: string }).code === '55P03') return true;
    throw error;
  }
}

/** Holds one row's lock on a connection of its own until `release`, starts a cancel, and waits for it to block on the lock. */
async function cancelBlockedOn(
  table: 'sessions' | 'holds',
  world: CancelWorld,
) {
  const id = table === 'sessions' ? world.sessionId : world.holdId;
  const holder = await side.connect();
  await holder.query('BEGIN');
  await holder.query(`SELECT id FROM ${table} WHERE id = $1 FOR UPDATE`, [id]);
  const waiting = cancel(world, 13_000);
  await waitUntilBlocked(side, { blockedBy: await backendPid(holder) });
  return {
    waiting,
    release: async () => {
      await holder.query('COMMIT');
      holder.release();
    },
  };
}

describe('the lock order of a cancellation', () => {
  it('waits on the session first, holding neither the hold nor the order', async () => {
    const world = await fresh();
    const blocked = await cancelBlockedOn('sessions', world);

    expect(await isLocked('holds', world.holdId)).toBe(false);
    expect(await isLocked('orders', world.orderId)).toBe(false);
    await blocked.release();

    expect(await blocked.waiting).toMatchObject({ status: 'cancelled' });
  });

  it('waits on the hold with the session held and the order not yet taken', async () => {
    const world = await fresh();
    const blocked = await cancelBlockedOn('holds', world);

    expect(await isLocked('sessions', world.sessionId)).toBe(true);
    expect(await isLocked('orders', world.orderId)).toBe(false);
    await blocked.release();

    expect(await blocked.waiting).toMatchObject({ status: 'cancelled' });
    expect((await orderOf(world)).status).toBe('cancelled');
  });
});

describe('the refunds after a cancellation', () => {
  it('reconcile when an earlier partial refund left two refund rows', async () => {
    const world = await fresh({ gatewayPayment: true });
    await ask(world, {
      reason: 'goodwill',
      key: 'partial',
      ticketMinor: 5_000,
    });

    expect(await cancel(world, 8_000)).toMatchObject({
      status: 'cancelled',
      refundMinor: 8_000,
    });

    const refunds = await refundsOf(world);
    expect(refunds.map((refund) => refund.amountMinor).sort()).toEqual([
      5_000, 8_000,
    ]);
    const order = await orderOf(world);
    expect(order.refundedTicketMinor).toBe(13_000);
    expect(order.commissionReturnedMinor).toBe(world.commissionMinor);
  });

  it('roll the cancellation back whole when the order totals do not match its refund rows', async () => {
    const world = await fresh({ gatewayPayment: true });
    await ask(world, {
      reason: 'goodwill',
      key: 'partial',
      ticketMinor: 5_000,
    });
    await side.query(
      `UPDATE orders SET refunded_ticket_minor = refunded_ticket_minor + 1000 WHERE id = $1`,
      [world.orderId],
    );
    const seatsBefore = await seatsSoldOf(world);

    await expect(cancel(world, 7_000)).rejects.toThrow('do not reconcile');

    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await refundsOf(world)).toHaveLength(1);
    expect(await seatsSoldOf(world)).toBe(seatsBefore);
  });
});

describe('the entry of the data layer', () => {
  const direct = async (over: Record<string, unknown>) => {
    const { cancelBookingOrder } = await import('@/server/db/orderCancel');
    return cancelBookingOrder({
      orderId: '00000000-0000-4000-8000-000000000000',
      openedTokenVersion: 1,
      expectedRefundMinor: 0,
      ...over,
    });
  };

  it.each([
    ['an id that is not one', { orderId: 'nope' }],
    ['version 0', { openedTokenVersion: 0 }],
    ['a negative refund', { expectedRefundMinor: -1 }],
    ['an extra key', { extra: 1 }],
  ])('refuses %s before it reads anything', async (_name, over) => {
    await expect(direct(over)).rejects.toBeInstanceOf(ZodError);
  });

  it('takes an upper-case id for the same order', async () => {
    const world = await fresh();

    expect(
      await direct({
        orderId: world.orderId.toUpperCase(),
        expectedRefundMinor: 13_000,
      }),
    ).toMatchObject({ status: 'cancelled' });
  });

  it('refuses a facts read of an id that is not one', async () => {
    const { readCancelFacts } = await import('@/server/db/ordersCancelFacts');

    await expect(
      client.db.transaction((tx) => readCancelFacts(tx, 'nope')),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
