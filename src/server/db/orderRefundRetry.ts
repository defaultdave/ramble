import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import { refundRetriedEntry, retryPlan } from '@/lib/refundRetry';
import type { Caller } from '@/server/auth/caller';
import { requireOpsUserId, writeAudit } from './audit';
import { db } from './client';
import { lockOrderById } from './locks';
import { requestRefund, type RequestRefundResult } from './refunds';
import { orders, refunds } from './schema';

type RetryRefundOutcome = RequestRefundResult['status'] | 'not_found';

/**
 * Asks again for an order whose refund failed, and takes it out of the refund-failed queue, in one
 * transaction: a new refund of the rest of the order, the cleared `refund_failed` flag, and the
 * audit row commit together or not at all. A request the refund path refuses, or any error, leaves
 * the flag set. If the new refund fails too, the provider's event flags the order again. The only
 * write to `orders` outside the refund path is the flag, and it is here.
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
    const [failed] = await tx
      .select({ id: refunds.id, reason: refunds.reason })
      .from(refunds)
      .where(and(eq(refunds.orderId, id), eq(refunds.status, 'failed')))
      .orderBy(desc(refunds.createdAt), desc(refunds.id))
      .limit(1);
    const plan = retryPlan({
      orderId: id,
      userId,
      order: order ?? null,
      failed: failed ?? null,
    });
    if (plan.kind === 'stop') return 'refused';
    const result = await requestRefund(tx, plan.request);
    if (result.status === 'refused') return 'refused';
    await tx
      .update(orders)
      .set({ refundFailed: false })
      .where(eq(orders.id, id));
    if (result.status === 'requested') {
      await writeAudit(
        tx,
        refundRetriedEntry(userId, id, result.refund.refundId),
      );
    }
    return result.status;
  });
}
