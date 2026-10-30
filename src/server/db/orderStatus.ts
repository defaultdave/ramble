import 'server-only';
import { eq } from 'drizzle-orm';
import type { OrderStatus } from '@/lib/orders';
import { db } from './client';
import { orders } from './schema';

// The one column the S9 poller reads. It decides nothing; src/lib/orderStatus.ts folds it into the
// answer, and the caller has already checked the token that names the order.

export async function readOrderStatus(
  orderId: string,
): Promise<OrderStatus | null> {
  const [row] = await db
    .select({ status: orders.status })
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  return row?.status ?? null;
}
