import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PaymentsPort } from '@/server/ports/payments';
import { dueClock } from '../support/dueClock';
import {
  attemptOf,
  holdOf,
  newSession,
  ops,
  orderRow,
  seedActiveHoldOn,
  seedUnpaidOn,
  type SeededOrder,
} from './cancelSessionFixtures';
import {
  client,
  clearJobs,
  drain,
  gateway,
  jobsOfKind,
  ledgerOf,
  refundsOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/ports/email', () => ({ sendEmail }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk (the `session_cancelled` refund path of `confirmOrder`, the fake payment adapter):
// - a payment that lands on a voided order of a cancelled session (the cancellation could not stop it) is refunded in full: the
//   order moves to refunded_after_lapse, one refund (lapse_after_payment, pending) and its job exist, the answer is `refunded`
// - the cash is booked before the refund: the host share, commission, and tax come in under the payment, and the refund's legs follow
// - the guest is emailed once with the amount and the cancelled-session reason, under a key built from the order
// - a hold still open at that point is released as session_cancelled; one already released is left as it was
// - the other reasons are not built: an amount that does not match on a cancelled session answers `unavailable` and writes nothing
// - a session cancelled by `cancelSession` while the payment is already succeeded at the provider takes this path end to end

beforeEach(async () => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
  await clearJobs();
});

type ConfirmInput = Parameters<
  typeof import('@/server/db/confirmOrder').confirmOrder
>[1];

/** The payment lands: the provider confirms it, the event job marks the attempt succeeded, and the confirm step runs. */
async function paymentLands(
  booking: SeededOrder,
  over: Partial<ConfirmInput> = {},
) {
  const fake = gateway.getFakePayments();
  await fake.confirm(booking.paymentId, { outcome: 'succeeded' });
  await client.db
    .update(schema.paymentAttempts)
    .set({ status: 'succeeded' })
    .where(eq(schema.paymentAttempts.id, booking.attemptId));
  const { confirmOrder } = await import('@/server/db/confirmOrder');
  const { readDatabaseTime } = await import('@/server/db/time');
  const { amountDueMinor } = await orderRow(booking.orderId);
  return client.db.transaction(async (tx) =>
    confirmOrder(tx, {
      orderId: booking.orderId,
      attemptId: booking.attemptId,
      providerEventId: randomUUID(),
      providerPaymentId: booking.paymentId,
      amountMinor: amountDueMinor,
      currency: 'USD',
      feeMinor: null,
      now: await readDatabaseTime(tx),
      ...over,
    }),
  );
}

/** A cancellation that left the payment at the provider, as one does when the provider reports it succeeded or processing. */
async function cancelLeavingPayment(sessionId: string, booking: SeededOrder) {
  const { cancelSession } = await import('@/server/db/cancelSession');
  const port = {
    ...gateway.getFakePayments(),
    retrieve: vi.fn().mockResolvedValue({
      id: booking.paymentId,
      status: 'processing',
      metadata: {},
    }),
  } as unknown as PaymentsPort;
  return cancelSession(ops, { sessionId, reason: 'weather' }, port);
}

describe('a payment that lands after its session was cancelled', () => {
  it('is refunded in full, with the order refunded after the lapse', async () => {
    const session = await newSession();
    const booking = await seedUnpaidOn(session.id);
    await cancelLeavingPayment(session.id, booking);

    const answer = await paymentLands(booking);

    expect(answer).toEqual({ status: 'refunded' });
    const order = await orderRow(booking.orderId);
    expect(order).toMatchObject({
      status: 'refunded_after_lapse',
      refundedTicketMinor: order.ticketSubtotalMinor,
      refundedTaxMinor: order.taxMinor,
    });
    const refunds = await refundsOf(booking);
    expect(refunds).toHaveLength(1);
    expect(refunds[0]).toMatchObject({
      reason: 'lapse_after_payment',
      status: 'pending',
      amountMinor: order.totalMinor,
      paymentAttemptId: booking.attemptId,
    });
    expect(await jobsOfKind('process-refund')).toHaveLength(1);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(0);
  });

  it('books the cash in before the refund sends it back', async () => {
    const session = await newSession();
    const booking = await seedUnpaidOn(session.id);
    await cancelLeavingPayment(session.id, booking);

    await paymentLands(booking);

    const entries = await ledgerOf(booking);
    expect(entries.map((entry) => entry.entryType)).toEqual([
      'charge_host_share',
      'charge_commission',
      'refund_host_share',
      'commission_returned',
    ]);
    const cash = entries.filter((entry) => entry.providerObjectId !== null);
    expect(cash.map((entry) => entry.providerObjectId)).toEqual([
      booking.paymentId,
      booking.paymentId,
    ]);
  });

  it('emails the guest once, with the amount and why', async () => {
    const session = await newSession();
    const booking = await seedUnpaidOn(session.id);
    await cancelLeavingPayment(session.id, booking);
    await paymentLands(booking);
    const { amountDueMinor } = await orderRow(booking.orderId);

    expect(await jobsOfKind('guest-paid-after-lapse')).toMatchObject([
      {
        dedupe_key: `guest-paid-after-lapse:${booking.orderId}`,
        payload: {
          orderId: booking.orderId,
          reason: 'session_cancelled',
          amountMinor: amountDueMinor,
        },
      },
    ]);
    for (let round = 0; round < 6; round += 1) {
      await drain.drainJobs(dueClock);
    }

    const lapse = sendEmail.mock.calls
      .map(([request]) => request as { template: string })
      .filter((request) => request.template === 'paid-after-lapse');
    expect(lapse).toHaveLength(1);
    expect(lapse[0]).toMatchObject({
      to: 'pat@example.com',
      idempotencyKey: `guest-paid-after-lapse:${booking.orderId}`,
      data: {
        amount: '$130.00',
        reasonLine:
          'The session was cancelled before your payment went through.',
      },
    });
  });

  it('releases a hold that is still open, and leaves one already released', async () => {
    const session = await newSession();
    const open = await seedUnpaidOn(session.id);
    const released = await seedUnpaidOn(session.id);
    await client.db
      .update(schema.sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(eq(schema.sessions.id, session.id));
    await client.db
      .update(schema.holds)
      .set({ status: 'released', releasedReason: 'payment_abandoned' })
      .where(eq(schema.holds.id, released.holdId));
    const releasedBefore = await holdOf(released.holdId);

    await paymentLands(open);
    await paymentLands(released);

    expect(await holdOf(open.holdId)).toMatchObject({
      status: 'released',
      releasedReason: 'session_cancelled',
    });
    expect(await holdOf(released.holdId)).toEqual(releasedBefore);
  });

  it('does not touch a hold or an order of a session still scheduled', async () => {
    const session = await newSession();
    const other = await newSession();
    const landed = await seedUnpaidOn(session.id);
    const elsewhere = await seedUnpaidOn(other.id);
    const heldElsewhere = await seedActiveHoldOn(other.id);
    await cancelLeavingPayment(session.id, landed);

    await paymentLands(landed);

    expect((await orderRow(elsewhere.orderId)).status).toBe('pending_payment');
    expect((await holdOf(elsewhere.holdId)).status).toBe('paying');
    expect((await holdOf(heldElsewhere.id)).status).toBe('active');
    expect((await attemptOf(elsewhere.attemptId)).status).toBe(
      'requires_action',
    );
  });
});

describe('a payment that cannot be confirmed for another reason', () => {
  it.each([
    ['an amount that is not what was due', { amountMinor: 1 }],
    ['a currency that is not the order’s', { currency: 'EUR' }],
  ])('answers unavailable and writes nothing for %s', async (_name, over) => {
    const session = await newSession();
    const booking = await seedUnpaidOn(session.id);
    await cancelLeavingPayment(session.id, booking);

    const answer = await paymentLands(booking, over);

    expect(answer).toEqual({ status: 'unavailable' });
    expect((await orderRow(booking.orderId)).status).toBe('void');
    expect(await refundsOf(booking)).toHaveLength(0);
    expect(await ledgerOf(booking)).toHaveLength(0);
    expect(await jobsOfKind('guest-paid-after-lapse')).toHaveLength(0);
  });
});
