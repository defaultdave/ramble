'use server';

import { notFound, redirect } from 'next/navigation';
import {
  cancelInputFromForm,
  parseCancelInput,
  type CancelBookingInput,
  type CancelBookingResult,
} from '@/lib/cancelBooking';
import { cancelResultPath } from '@/lib/manageBooking';
import {
  OrderStatusInputSchema,
  orderStatusResult,
  type OrderStatusInput,
  type OrderStatusResult,
} from '@/lib/orderStatus';
import { cancelBookingOrder } from '@/server/db/orderCancel';
import { openManageToken } from '@/server/manageBooking';
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
  const parsed = parseCancelInput(input);
  if (parsed.kind === 'refused') return parsed.result;
  const gate = await openManageToken(parsed.input.manageToken);
  if (gate.kind === 'refused') return gate.refusal;
  return cancelBookingOrder({
    orderId: gate.row.id,
    openedTokenVersion: gate.row.version,
    expectedRefundMinor: parsed.input.expectedRefundMinor,
  });
}

/**
 * The manage page's cancel form: it posts the token and the refund the guest was shown, runs
 * `cancelBooking`, and sends the guest back to the same page with the answer in the address. It
 * works with scripting off. A form with no usable token is the not-found page.
 */
export async function cancelBookingForm(formData: FormData): Promise<void> {
  const parsed = parseCancelInput(
    cancelInputFromForm({
      manageToken: formData.get('manageToken'),
      expectedRefundMinor: formData.get('expectedRefundMinor'),
    }),
  );
  if (parsed.kind === 'refused') notFound();
  const result = await cancelBooking(parsed.input);
  redirect(cancelResultPath(parsed.input.manageToken, result));
}
