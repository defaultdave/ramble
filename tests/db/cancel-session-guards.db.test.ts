import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentsPort } from '@/server/ports/payments';
import {
  attemptOf,
  holdOf,
  newSession,
  ops,
  orderRow,
  seedActiveHoldOn,
  seedUnpaidOn,
} from './cancelSessionFixtures';
import { raceAgainstOpenTransaction } from './harness';
import {
  client,
  clearJobs,
  gateway,
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
// - the holds it releases are read under their lock: a hold another path converts first is waited for and then left, not released over
// - the orders it acts on are read under their lock: an order another path confirms first is waited for and then refunded, not voided
// - an attempt a payment event moves to succeeded between the provider's cancel and the write stays succeeded and is counted as left
// - marking an attempt cancelled waits for the order's lock (the session already cancelled and the order already void, so only that lock is in play)

beforeEach(clearJobs);

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];
const inTransaction = (body: (tx: Tx) => Promise<void>) =>
  client.db.transaction(body);

const cancel = async (
  sessionId: string,
  payments?: PaymentsPort,
  reason: 'host' | 'weather' = 'host',
) => {
  const { cancelSession } = await import('@/server/db/cancelSession');
  return cancelSession(ops, { sessionId, reason }, payments);
};

describe('the locks on what is read', () => {
  it('waits for the holder of an open hold and leaves the hold the holder converted', async () => {
    const session = await newSession();
    const held = await seedActiveHoldOn(session.id);
    const { lockHoldRow } = await import('@/server/db/locks');

    const result = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await lockHoldRow(tx, held.id);
        await tx
          .update(schema.holds)
          .set({ status: 'converted' })
          .where(eq(schema.holds.id, held.id));
      },
      () => cancel(session.id),
    );

    expect(result).toMatchObject({ status: 'cancelled', holdsReleased: 0 });
    expect((await holdOf(held.id)).status).toBe('converted');
  });

  it('waits for the holder of an unpaid order and refunds the booking the holder confirmed', async () => {
    const session = await newSession();
    const unpaid = await seedUnpaidOn(session.id);
    const { lockOrderById } = await import('@/server/db/locks');

    const result = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await lockOrderById(tx, unpaid.orderId);
        await tx
          .update(schema.paymentAttempts)
          .set({ status: 'succeeded' })
          .where(eq(schema.paymentAttempts.id, unpaid.attemptId));
        await tx
          .update(schema.holds)
          .set({ status: 'converted' })
          .where(eq(schema.holds.id, unpaid.holdId));
        await tx
          .update(schema.sessions)
          .set({ seatsSold: unpaid.seats })
          .where(eq(schema.sessions.id, session.id));
        await tx
          .update(schema.orders)
          .set({ status: 'confirmed', confirmedAt: new Date() })
          .where(eq(schema.orders.id, unpaid.orderId));
      },
      () => cancel(session.id),
    );

    expect(result).toMatchObject({ ordersRefunded: 1, ordersVoided: 0 });
    expect((await orderRow(unpaid.orderId)).status).toBe('cancelled');
    expect(await refundsOf(unpaid)).toHaveLength(1);
  });
});

describe('the attempts it cancels', () => {
  it('leaves an attempt a payment event moved to succeeded in the meantime, and counts it', async () => {
    const session = await newSession();
    const unpaid = await seedUnpaidOn(session.id);
    const port = {
      ...gateway.getFakePayments(),
      retrieve: vi.fn().mockResolvedValue({
        id: unpaid.paymentId,
        status: 'requires_action',
        metadata: {},
      }),
      cancelPayment: vi.fn().mockImplementation(async () => {
        await client.db
          .update(schema.paymentAttempts)
          .set({ status: 'succeeded' })
          .where(eq(schema.paymentAttempts.id, unpaid.attemptId));
        return { id: unpaid.paymentId, status: 'canceled', metadata: {} };
      }),
    } as unknown as PaymentsPort;

    const result = await cancel(session.id, port);

    expect(result).toMatchObject({ ordersVoided: 1, attemptsLeft: 1 });
    expect((await attemptOf(unpaid.attemptId)).status).toBe('succeeded');
  });

  it('waits for the order’s lock before marking the attempt cancelled', async () => {
    const session = await newSession();
    const unpaid = await seedUnpaidOn(session.id);
    const down = {
      ...gateway.getFakePayments(),
      retrieve: vi.fn().mockRejectedValue(new Error('provider down')),
    } as unknown as PaymentsPort;
    await expect(cancel(session.id, down)).rejects.toThrow('provider down');
    expect((await orderRow(unpaid.orderId)).status).toBe('void');
    const { lockOrderById } = await import('@/server/db/locks');

    const result = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await lockOrderById(tx, unpaid.orderId);
      },
      () => cancel(session.id),
    );

    expect(result).toMatchObject({
      status: 'already_cancelled',
      attemptsLeft: 0,
    });
    expect((await attemptOf(unpaid.attemptId)).status).toBe('canceled');
  });
});
