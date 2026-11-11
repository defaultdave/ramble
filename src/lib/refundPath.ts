import { z } from 'zod';
import { WriteIdSchema } from './catalog';
import { holdFanOut } from './cancelSession';
import type { RefundPathReason } from './confirmOrder';
import type { holdStatuses } from './holds';
import type { OrderStatus } from './orders';
import { requireOrderTransition } from './providerEvents';
import { RefundMinorSchema, type orderRefundReasons } from './refunds';
import type { LapseReason } from './bookingEmails';

// What a payment that cannot be confirmed does (design doc 4.2.3, step 5). Only the refund path for
// a cancelled session is built; the others answer `unavailable` until their unit lands.

/** The reasons whose refund path is built. */
export function isRefundPathBuilt(
  reason: RefundPathReason,
): reason is 'session_cancelled' {
  return reason === 'session_cancelled';
}

/** The refund of a payment that landed after the order was given up on. */
export const lateRefundReason =
  'lapse_after_payment' as const satisfies (typeof orderRefundReasons)[number];

/** With the order and the reason, names the one refund of a late payment, so a retried event asks again and changes nothing. */
export const lateRefundKey = 'late-payment';

export type LateRefundPlan = {
  orderStatus: Extract<OrderStatus, 'refunded_after_lapse'>;
  /** A hold still open at this point stops holding spaces; one that ended already is left. */
  releaseHold: boolean;
};

/**
 * What the refund path does with the order and hold it found under the locks. The order moves to
 * `refunded_after_lapse` (an order that cannot, such as a confirmed one, throws), and an open hold
 * is released with the session.
 */
export function lateRefundPlan(input: {
  orderStatus: OrderStatus;
  holdStatus: (typeof holdStatuses)[number] | null;
}): LateRefundPlan {
  requireOrderTransition(input.orderStatus, 'refunded_after_lapse');
  return {
    orderStatus: 'refunded_after_lapse',
    releaseHold:
      input.holdStatus !== null && holdFanOut(input.holdStatus) === 'release',
  };
}

/** The job that tells the guest their late payment is on its way back. */
export const paidAfterLapseJobKind = 'guest-paid-after-lapse';

const lapseReasons = [
  'sold_out_after_lapse',
  'session_cancelled',
] as const satisfies readonly LapseReason[];

export const PaidAfterLapsePayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  reason: z.enum(lapseReasons),
  amountMinor: RefundMinorSchema.min(1),
});

/** One email per order: a second event for the same payment queues nothing. */
export function paidAfterLapseDedupeKey(orderId: string): string {
  return `${paidAfterLapseJobKind}:${orderId.toLowerCase()}`;
}
