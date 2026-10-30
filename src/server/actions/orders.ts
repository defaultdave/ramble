'use server';

import {
  OrderStatusInputSchema,
  orderStatusResult,
  type OrderStatusInput,
  type OrderStatusResult,
} from '@/lib/orderStatus';
import { readOrderState } from '@/server/orderConfirmation';

/**
 * Where an order stands, for the "checking your payment" state (S9). The order token is the
 * caller's proof, so a guest who lost the response to Pay can ask again from any tab; a malformed
 * input and a token that does not open the order are answered alike.
 */
export async function getOrderStatus(
  input: OrderStatusInput,
): Promise<OrderStatusResult> {
  const parsed = OrderStatusInputSchema.safeParse(input);
  if (!parsed.success) return orderStatusResult(null);
  return readOrderState(parsed.data.reference, parsed.data.token);
}
