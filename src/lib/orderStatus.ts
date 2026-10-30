import { z } from 'zod';
import { isCapabilityTokenShape } from './capabilityTokens';
import { isOrderReference, type OrderStatus } from './orders';

/** What the S9 poller sends: the order's reference and the order token that opens it. */
export const OrderStatusInputSchema = z.strictObject({
  reference: z.string().refine(isOrderReference),
  token: z.string().refine(isCapabilityTokenShape),
});
export type OrderStatusInput = z.input<typeof OrderStatusInputSchema>;

/** `unknown` is every refusal alike: a malformed input, a wrong token, another order's token, no such order. */
export type OrderStatusResult =
  { state: OrderStatusState } | { state: 'unknown' };

const unknownOrderStatus: OrderStatusResult = { state: 'unknown' };

// What a guest waiting on a payment is told, and how often the page asks. The status itself is the
// order's; this folds it into the answers design doc 4.2 gives the S9 poller.

export type OrderStatusState =
  'pending' | 'confirmed' | 'failed' | 'refunded_after_lapse' | 'closed';

export function orderStatusState(status: OrderStatus): OrderStatusState {
  switch (status) {
    case 'pending_payment':
      return 'pending';
    case 'confirmed':
      return 'confirmed';
    case 'payment_failed':
      return 'failed';
    case 'refunded_after_lapse':
      return 'refunded_after_lapse';
    case 'void':
    case 'cancelled':
      return 'closed';
    default:
      throw new RangeError(
        `Unknown order status: ${String(status satisfies never)}`,
      );
  }
}

/** The answer for an order's status, or for no order the token opens (null): the same `unknown` as every other refusal. */
export function orderStatusResult(
  status: OrderStatus | null,
): OrderStatusResult {
  return status === null
    ? unknownOrderStatus
    : { state: orderStatusState(status) };
}

/**
 * What the poller does with an answer. A pending order, or an answer that never arrived (a dropped
 * connection is why the guest is here), is asked about again; anything else is for the page to
 * show, so the poller stops and has the page re-render, which checks the token again itself.
 */
export function pollStep(
  result: OrderStatusResult | 'error',
): 'again' | 'show' {
  return result !== 'error' && result.state !== 'pending' ? 'show' : 'again';
}

/**
 * What the status region says once an answer settles the order, until the page re-renders and
 * replaces the region, so a screen reader hears the outcome rather than the region vanishing.
 * Null while the order is still pending or the answer was lost.
 */
export function settledMessage(
  result: OrderStatusResult | 'error',
): string | null {
  if (pollStep(result) === 'again' || result === 'error') return null;
  switch (result.state) {
    case 'confirmed':
      return 'Payment confirmed. Loading your receipt.';
    case 'failed':
      return 'The payment did not go through. Loading the details.';
    default:
      return 'Your order has been updated. Loading the details.';
  }
}

const delaysMs = [2_000, 3_000, 5_000, 8_000, 13_000, 20_000] as const;

/** About three minutes of asking in all (171 s of waiting), then the guest is handed a button instead of a loop. */
export const maxPollAttempts = 12;

/** The wait before poll number `attempt` (0 is the first), growing to a ceiling; null once the cap is reached. */
export function pollDelayMs(attempt: number): number | null {
  if (!Number.isInteger(attempt) || attempt < 0 || attempt >= maxPollAttempts) {
    return null;
  }
  return delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? null;
}
