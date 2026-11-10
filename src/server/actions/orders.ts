'use server';

import {
  CancelBookingInputSchema,
  type CancelBookingInput,
  type CancelBookingResult,
} from '@/lib/cancelBooking';
import {
  OrderStatusInputSchema,
  orderStatusResult,
  type OrderStatusInput,
  type OrderStatusResult,
} from '@/lib/orderStatus';
import { cancelBookingOrder } from '@/server/db/orderCancel';
import { readOrderState } from '@/server/orderConfirmation';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { resolveToken } from '@/server/tokens';

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

/**
 * Cancels the booking a manage link opens. The token is the caller's right, so it is parsed and
 * counted against the `manage` limit first, and a malformed, unknown, or stale token is answered
 * alike (`not_found`). The refund the guest was shown travels as `expectedRefundMinor`; if the tier
 * now gives another amount nothing is cancelled. A failed rate-limit store or lookup throws, so the
 * action fails closed.
 */
export async function cancelBooking(
  input: CancelBookingInput,
): Promise<CancelBookingResult> {
  const parsed = CancelBookingInputSchema.safeParse(input);
  if (!parsed.success) return { status: 'not_found' };
  const { manageToken, expectedRefundMinor } = parsed.data;
  const spent = await consumeRateLimit('manage', manageToken);
  if (!spent.allowed) {
    return {
      status: 'rate_limited',
      retryAfterSeconds: spent.retryAfterSeconds,
    };
  }
  const opened = await resolveToken('manage', manageToken);
  if (opened === null) return { status: 'not_found' };
  return cancelBookingOrder({
    orderId: opened.id,
    openedTokenVersion: opened.version,
    expectedRefundMinor,
  });
}
