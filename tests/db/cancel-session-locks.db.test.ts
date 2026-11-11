import { eq } from 'drizzle-orm';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { raceAgainstOpenTransaction } from './harness';
import {
  holdOf,
  newSession,
  ops,
  orderRow,
  seedActiveHoldOn,
  seedConfirmedOn,
  sessionOf,
  snapshot,
} from './cancelSessionFixtures';
import { insertGift } from './giftFixtures';
import {
  client,
  clearJobs,
  getParents,
  jobsOfKind,
  refundsOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (`cancelSession`, the fake payment adapter):
// - the cancellation waits for the session's lock, then judges the session as the holder left it (fails if it reads before the lock)
// - a guest cancelling the booking at the same moment (the booking's session and order locks held) is waited for: the order is
//   then already cancelled by the guest, and the session cancellation neither refunds it again nor changes who cancelled it
// - two cancellations of one session at once cancel it once: one answers cancelled, the other already_cancelled, one refund
// - an order that cannot be refunded in full (a gift paid part of it) rolls the whole cancellation back: the session is still
//   scheduled, the hold open, the booking confirmed, and no job, refund, or audit row exists
// - the times it writes are the database's, not the application's: a hold released while the application clock reads 2001

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
const inTransaction = (body: (tx: Tx) => Promise<void>) =>
  client.db.transaction(body);

beforeEach(clearJobs);
afterEach(() => {
  vi.useRealTimers();
});

const cancel = async (
  sessionId: string,
  reason: 'host' | 'weather' = 'host',
) => {
  const { cancelSession } = await import('@/server/db/cancelSession');
  return cancelSession(ops, { sessionId, reason });
};

describe('the locks of a session cancellation', () => {
  it('waits for the session lock and then judges what the holder left', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);
    const { lockSessionRow } = await import('@/server/db/locks');

    const result = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await lockSessionRow(tx, session.id);
        await tx
          .update(schema.sessions)
          .set({ status: 'cancelled', cancelReason: 'ramble' })
          .where(eq(schema.sessions.id, session.id));
      },
      () => cancel(session.id, 'host'),
    );

    expect(result).toMatchObject({
      status: 'already_cancelled',
      ordersRefunded: 1,
    });
    expect(await orderRow(booking.orderId)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'ramble',
    });
  });

  it('waits for a guest cancelling the booking and leaves their cancellation as it is', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);
    const { lockSessionRow, lockHoldRow, lockOrderById } =
      await import('@/server/db/locks');

    const result = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await lockSessionRow(tx, session.id);
        await lockHoldRow(tx, booking.holdId);
        await lockOrderById(tx, booking.orderId);
        await tx
          .update(schema.orders)
          .set({
            status: 'cancelled',
            cancelledBy: 'guest',
            cancelledAt: new Date(Date.now() + 5_000),
          })
          .where(eq(schema.orders.id, booking.orderId));
      },
      () => cancel(session.id),
    );

    expect(result).toMatchObject({ status: 'cancelled', ordersRefunded: 0 });
    expect(await orderRow(booking.orderId)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'guest',
    });
    expect(await refundsOf(booking)).toHaveLength(0);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(0);
  });

  it('cancels a session once when two cancellations run at once', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id);

    const answers = await Promise.all([
      cancel(session.id, 'host'),
      cancel(session.id, 'weather'),
    ]);

    expect(answers.map((answer) => answer.status).sort()).toEqual([
      'already_cancelled',
      'cancelled',
    ]);
    expect(await refundsOf(booking)).toHaveLength(1);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(1);
    expect((await sessionOf(session.id)).version).toBe(2);
  });
});

describe('a booking that cannot be refunded in full', () => {
  it('rolls the whole cancellation back', async () => {
    const session = await newSession();
    const held = await seedActiveHoldOn(session.id);
    const fine = await seedConfirmedOn(session.id);
    const giftPaid = await seedConfirmedOn(session.id);
    const gift = await insertGift(client.db, getParents());
    const { totalMinor } = await orderRow(giftPaid.orderId);
    await client.db
      .update(schema.orders)
      .set({
        giftId: gift.id,
        giftAppliedMinor: 3_000,
        amountDueMinor: totalMinor - 3_000,
      })
      .where(eq(schema.orders.id, giftPaid.orderId));
    const before = await snapshot(session.id, [fine.orderId, giftPaid.orderId]);

    await expect(cancel(session.id)).rejects.toThrow(
      'cannot be refunded in full',
    );

    expect(
      await snapshot(session.id, [fine.orderId, giftPaid.orderId]),
    ).toEqual(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await holdOf(held.id)).status).toBe('active');
    expect((await orderRow(fine.orderId)).status).toBe('confirmed');
    expect((await orderRow(giftPaid.orderId)).status).toBe('confirmed');
  });
});

describe('the clock', () => {
  it('stamps what it releases with the database time, not the application time', async () => {
    const session = await newSession();
    const held = await seedActiveHoldOn(session.id);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date('2001-01-01T00:00:00Z'));

    await cancel(session.id);

    vi.useRealTimers();
    expect((await holdOf(held.id)).updatedAt.getFullYear()).toBeGreaterThan(
      2020,
    );
  });
});
