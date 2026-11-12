import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { reconcileReadLimit } from '@/lib/cancelBooking';
import { WriteIdSchema } from '@/lib/catalog';
import {
  RefundRequestSchema,
  refundIdFromDigest,
  refundRequestIdentity,
} from '@/lib/refunds';
import { refundAuditEntry, retryPlan } from '@/lib/refundRetry';
import type { Caller } from '@/server/auth/caller';
import { sha256Hex } from '@/server/hash';
import { requireOpsUserId } from './audit';
import { db } from './client';
import { lockOrderById } from './locks';
import {
  clearRefundFailed,
  requestAuditedRefund,
  type RequestRefundResult,
} from './refunds';
import { orders, refunds } from './schema';

type RetryRefundOutcome = RequestRefundResult['status'] | 'not_found';

/**
 * Asks again for the refund of an order that failed, for that refund's own ticket part, and takes the
 * order out of the refund-failed queue, in one transaction under the order's lock: the new refund,
 * the cleared flag, and the audit row commit together or not at all. A request the refund path
 * refuses (the refunds standing plus this one would pass what the card paid), a repeat of the same
 * retry, or any error leaves the flag set and writes nothing. If the new refund fails too, the
 * provider's event flags the order again.
 */
export async function retryFailedRefund(
  caller: Caller,
  orderId: string,
): Promise<RetryRefundOutcome> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  return db.transaction(async (tx) => {
    if (!(await lockOrderById(tx, id))) return 'not_found';
    const [order] = await tx
      .select({ kind: orders.kind, refundFailed: orders.refundFailed })
      .from(orders)
      .where(eq(orders.id, id));
    const failedRefunds = await tx
      .select({
        id: refunds.id,
        reason: refunds.reason,
        ticketMinor: refunds.ticketMinor,
      })
      .from(refunds)
      .where(and(eq(refunds.orderId, id), eq(refunds.status, 'failed')))
      .orderBy(desc(refunds.createdAt), desc(refunds.id))
      .limit(reconcileReadLimit);
    const standing = new Set(
      (
        await tx
          .select({ id: refunds.id })
          .from(refunds)
          .where(eq(refunds.orderId, id))
          .limit(reconcileReadLimit)
      ).map((row) => row.id),
    );
    const retryPlanFor = (failed: (typeof failedRefunds)[number] | null) =>
      retryPlan({ orderId: id, userId, order: order ?? null, failed });
    const failed =
      failedRefunds.find((candidate) => {
        const plan = retryPlanFor(candidate);
        return (
          plan.kind === 'stop' ||
          !standing.has(
            refundIdFromDigest(
              sha256Hex(
                refundRequestIdentity(RefundRequestSchema.parse(plan.request)),
              ),
            ),
          )
        );
      }) ?? null;
    const plan = retryPlanFor(failed);
    if (plan.kind === 'stop') return 'refused';
    const result = await requestAuditedRefund(tx, plan.request, (refundId) =>
      refundAuditEntry('booking.ops_refund_retried', userId, id, refundId),
    );
    if (result.status === 'requested') await clearRefundFailed(tx, id);
    return result.status;
  });
}
