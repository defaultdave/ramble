import { userOrderEntry } from './audit';
import type { OrderKind } from './orders';
import { orderRefundReasons, type RefundRequestInput } from './refunds';

// Retrying a refund the provider refused (design doc 4.2.3, Refunds: a new attempt is a new row with
// its own key). The data layer reads the order under its lock and acts on what this says.

/** The reason an ops refund carries, and the one a retry falls back to for a reason the refund path does not take. */
export const opsRefundReason =
  'ops_adjustment' as const satisfies (typeof orderRefundReasons)[number];

export type RetryPlan =
  { kind: 'retry'; request: RefundRequestInput } | { kind: 'stop' };

/**
 * What retrying a failed refund asks for, from the order as it stands under its lock: the whole
 * rest of the order, under a key named for the failed refund so a double click asks once. The
 * refund keeps its reason (a guest's cancellation still emails the guest). An order with no failed
 * refund, one not flagged, or one that is not a booking is left alone.
 */
export function retryPlan(input: {
  orderId: string;
  userId: string;
  order: { kind: OrderKind; refundFailed: boolean } | null;
  failed: { id: string; reason: string } | null;
}): RetryPlan {
  const { order, failed } = input;
  if (order === null || order.kind !== 'booking' || !order.refundFailed) {
    return { kind: 'stop' };
  }
  if (failed === null) return { kind: 'stop' };
  const reason = orderRefundReasons.find((known) => known === failed.reason);
  return {
    kind: 'retry',
    request: {
      orderId: input.orderId,
      reason: reason ?? opsRefundReason,
      key: `retry:${failed.id}`,
      ticketMinor: 'remaining',
      initiatedBy: input.userId,
    },
  };
}

/** A failed refund was asked for again: the new refund's id names it. */
export const refundRetriedEntry = (
  userId: string,
  orderId: string,
  refundId: string,
) =>
  userOrderEntry(userId, 'booking.ops_refund_retried', orderId, {
    refund_id: refundId,
  });
