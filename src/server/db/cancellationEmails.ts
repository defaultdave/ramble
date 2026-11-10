import 'server-only';
import { eq } from 'drizzle-orm';
import type { Transaction } from './client';
import { refunds } from './schema';

// What the refund email job reads. Apart from ./orderCancel, which enqueues jobs: the job files
// import this, and `enqueue` imports the job registry that imports them.

export type RefundForEmail = {
  orderId: string;
  status: string;
  reason: string;
  amountMinor: number;
};

/** Null when there is no such refund. */
export async function readRefundForEmail(
  tx: Transaction,
  refundId: string,
): Promise<RefundForEmail | null> {
  const [row] = await tx
    .select({
      orderId: refunds.orderId,
      status: refunds.status,
      reason: refunds.reason,
      amountMinor: refunds.amountMinor,
    })
    .from(refunds)
    .where(eq(refunds.id, refundId));
  return row ?? null;
}
