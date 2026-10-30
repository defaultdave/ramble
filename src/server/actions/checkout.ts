'use server';

import {
  StartPaymentInputSchema,
  invalidStartPayment,
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import { startCheckoutPayment } from '@/server/checkout';
import { getDevice } from '@/server/device';

/**
 * Turns the caller's open hold into an order and a live payment attempt, and hands back the
 * client secret to pay it with. Safe to call again: a second tab, a refresh, or a retry after a
 * decline reaches the same order and the same attempt (PRD-22).
 */
export async function startPayment(
  input: StartPaymentInput,
): Promise<StartPaymentResult> {
  const parsed = StartPaymentInputSchema.safeParse(input);
  if (!parsed.success) return invalidStartPayment(parsed.error.issues);
  return startCheckoutPayment(await getDevice(), parsed.data);
}
