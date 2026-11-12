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

type FailedRefund = { id: string; reason: string; ticketMinor: number };

/** The retry of one failed refund: that refund's own ticket part, under a key named for it, keeping its reason (a guest's cancellation still emails the guest). */
function retryRequest(
  orderId: string,
  userId: string,
  failed: FailedRefund,
): RefundRequestInput {
  return opsRefundRequest({
    orderId,
    userId,
    reason:
      orderRefundReasons.find((known) => known === failed.reason) ??
      opsRefundReason,
    key: `retry:${failed.id}`,
    ticketMinor: failed.ticketMinor,
  });
}

/**
 * Which failed refund of the order to ask for again, from the rows read under its lock, newest
 * first. A failed refund is passed over when it has no ticket part to ask for or when its retry
 * already exists (`standingIds` holds the order's refund ids, and `refundIdOf` names the refund a
 * request would write), so an older failure is never stuck behind a newer one. An order that is not
 * a flagged booking, or has no failed refund left to retry, is left alone.
 */
export function pickRetry(input: {
  orderId: string;
  userId: string;
  order: { kind: OrderKind; refundFailed: boolean } | null;
  failed: readonly FailedRefund[];
  standingIds: ReadonlySet<string>;
  refundIdOf: (request: RefundRequestInput) => string;
}): RetryPlan {
  const { order } = input;
  if (order === null || order.kind !== 'booking' || !order.refundFailed) {
    return { kind: 'stop' };
  }
  for (const failed of input.failed) {
    if (failed.ticketMinor < 1) continue;
    const request = retryRequest(input.orderId, input.userId, failed);
    if (!input.standingIds.has(input.refundIdOf(request))) {
      return { kind: 'retry', request };
    }
  }
  return { kind: 'stop' };
}

/** An ops refund was requested or retried: the new refund's id names it. */
export const refundAuditEntry = (
  action: 'booking.ops_refund_requested' | 'booking.ops_refund_retried',
  userId: string,
  orderId: string,
  refundId: string,
) => opsViewEntry(userId, action, 'order', orderId, { refund_id: refundId });
