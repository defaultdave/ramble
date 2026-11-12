import { opsViewEntry } from './opsAudit';
import type { OrderKind } from './orders';
import { orderRefundReasons, type RefundRequestInput } from './refunds';

// Ops asking for a refund: a first one for a cancelled booking, and a new attempt at one the provider
// refused (design doc 4.2.3, Refunds: a new attempt is a new row with its own key). The data layer
// reads the order under its lock and acts on what this says.

/** The reason an ops refund carries, and the one a retry falls back to for a reason the refund path does not take. */
const opsRefundReason =
  'ops_adjustment' as const satisfies (typeof orderRefundReasons)[number];

/** A refund an ops user asks for: the key names it, so asking twice asks once. */
function opsRefundRequest(input: {
  orderId: string;
  userId: string;
  reason: RefundRequestInput['reason'];
  key: string;
  ticketMinor: RefundRequestInput['ticketMinor'];
}): RefundRequestInput {
  return {
    orderId: input.orderId,
    reason: input.reason,
    key: input.key,
    ticketMinor: input.ticketMinor,
    initiatedBy: input.userId,
  };
}

/** The whole rest of an order, under the one ops key. */
export const opsFullRefundRequest = (orderId: string, userId: string) =>
  opsRefundRequest({
    orderId,
    userId,
    reason: opsRefundReason,
    key: 'ops-refund',
    ticketMinor: 'remaining',
  });

export type RetryPlan =
  { kind: 'retry'; request: RefundRequestInput } | { kind: 'stop' };

/**
 * What retrying a failed refund asks for, from the order as it stands under its lock: that refund's
 * own ticket part, under a key named for it. The refund keeps its reason (a guest's cancellation
 * still emails the guest). An order with no failed refund, one not flagged, or one that is not a
 * booking is left alone.
 */
export function retryPlan(input: {
  orderId: string;
  userId: string;
  order: { kind: OrderKind; refundFailed: boolean } | null;
  failed: { id: string; reason: string; ticketMinor: number } | null;
}): RetryPlan {
  const { order, failed } = input;
  if (order === null || order.kind !== 'booking' || !order.refundFailed) {
    return { kind: 'stop' };
  }
  if (failed === null || failed.ticketMinor < 1) return { kind: 'stop' };
  return {
    kind: 'retry',
    request: opsRefundRequest({
      orderId: input.orderId,
      userId: input.userId,
      reason:
        orderRefundReasons.find((known) => known === failed.reason) ??
        opsRefundReason,
      key: `retry:${failed.id}`,
      ticketMinor: failed.ticketMinor,
    }),
  };
}

/** An ops refund was requested or retried: the new refund's id names it. */
export const refundAuditEntry = (
  action: 'booking.ops_refund_requested' | 'booking.ops_refund_retried',
  userId: string,
  orderId: string,
  refundId: string,
) => opsViewEntry(userId, action, 'order', orderId, { refund_id: refundId });
