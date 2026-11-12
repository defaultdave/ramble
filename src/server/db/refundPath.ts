import 'server-only';
import { eq } from 'drizzle-orm';
import { requireSessionRefund, releasedHold } from '@/lib/cancelSession';
import { bookingEmailKey } from '@/lib/bookingEmails';
import type { RefundPathReason } from '@/lib/confirmOrder';
import { isSimulatedPayment } from '@/lib/confirmOrder';
import { bookingPaid } from '@/lib/ledger';
import {
  isRefundPathBuilt,
  lateRefundKey,
  lateRefundPlan,
  lateRefundReason,
  paidAfterLapseJobKind,
} from '@/lib/refundPath';
import { enqueue } from '@/server/jobs/enqueue';
import type { Transaction } from './client';
import { postEntries } from './ledger';
import { requestRefund } from './refunds';
import { holds, orders, paymentAttempts } from './schema';

type RefundPathInput = {
  orderId: string;
  attemptId: string;
  providerPaymentId: string;
  amountMinor: number | null;
  currency: string | null;
  reason: RefundPathReason;
  at: Date;
};

/**
 * Where a payment goes that cannot be confirmed (design doc 4.2.3, step 5): the order is refunded
 * after the lapse, the hold released, a full refund requested, and the guest told. It runs inside
 * the confirm step's transaction, under its locks. `unavailable` leaves the order and the payment
 * as they were, so the provider event is retried instead of any refund state being guessed.
 */
export type TakeRefundPath = (
  tx: Transaction,
  input: RefundPathInput,
) => Promise<{ status: 'unavailable' | 'refunded' }>;

// TODO(U-109): the other reasons (amount, currency, sold out after a lapse) answer `unavailable` until they are built.
export const takeRefundPath: TakeRefundPath = async (tx, input) => {
  if (!isRefundPathBuilt(input.reason)) return { status: 'unavailable' };
  const [order] = await tx
    .select({
      status: orders.status,
      hostId: orders.hostId,
      holdId: orders.holdId,
      ticketSubtotalMinor: orders.ticketSubtotalMinor,
      commissionMinor: orders.commissionMinor,
      taxMinor: orders.taxMinor,
    })
    .from(orders)
    .where(eq(orders.id, input.orderId));
  const [attempt] = await tx
    .select({ provider: paymentAttempts.provider })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, input.attemptId));
  if (!order || !attempt) throw new Error('The late payment has no order');
  const [hold] =
    order.holdId === null
      ? []
      : await tx
          .select({ status: holds.status })
          .from(holds)
          .where(eq(holds.id, order.holdId));
  const plan = lateRefundPlan({
    orderStatus: order.status,
    holdStatus: hold?.status ?? null,
  });

  // The cash came in, so it is booked before the refund that sends it back.
  await postEntries(
    tx,
    bookingPaid({
      occurredAt: input.at,
      simulated: isSimulatedPayment(attempt.provider),
      orderId: input.orderId,
      hostId: order.hostId,
      paymentAttemptId: input.attemptId,
      providerObjectId: input.providerPaymentId,
      split: {
        ticketMinor: order.ticketSubtotalMinor,
        commissionMinor: order.commissionMinor,
        taxMinor: order.taxMinor,
      },
    }),
  );
  await tx
    .update(orders)
    .set({ status: plan.orderStatus })
    .where(eq(orders.id, input.orderId));
  if (plan.releaseHold && order.holdId !== null && hold) {
    await tx
      .update(holds)
      .set({ ...releasedHold(hold.status), updatedAt: input.at })
      .where(eq(holds.id, order.holdId));
  }
  const refund = requireSessionRefund(
    await requestRefund(tx, {
      orderId: input.orderId,
      reason: lateRefundReason,
      key: lateRefundKey,
      ticketMinor: 'remaining',
    }),
  );
  await enqueue(tx, {
    kind: paidAfterLapseJobKind,
    payload: {
      orderId: input.orderId,
      reason: input.reason,
      amountMinor: refund.amountMinor,
    },
    dedupeKey: bookingEmailKey(paidAfterLapseJobKind, input.orderId),
  });
  return { status: 'refunded' };
};
