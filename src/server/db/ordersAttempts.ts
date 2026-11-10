import 'server-only';
import { desc, eq } from 'drizzle-orm';
import { PaymentAttemptSchema } from '@/lib/payments';
import type { Transaction } from './client';
import { paymentAttempts } from './schema';

/** The order's attempt with the highest number, read with no lock, or null when it has none. */
export async function readLatestAttempt(tx: Transaction, orderId: string) {
  const [row] = await tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(desc(paymentAttempts.attemptNo))
    .limit(1);
  return row ? PaymentAttemptSchema.parse(row) : null;
}
