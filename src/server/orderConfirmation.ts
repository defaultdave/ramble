import 'server-only';
import { orderPageView, type OrderPageView } from '@/lib/orderReceipt';
import { orderStatusState, type OrderStatusState } from '@/lib/orderStatus';
import { db } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { readOrderStatus } from '@/server/db/orderStatus';
import { env } from '@/server/env';
import { capabilityToken, resolveToken } from '@/server/tokens';

// The order behind a confirmation URL (design doc 4.2.3): the token is recomputed for the order
// found by reference and compared in constant time, so a wrong token, an unknown reference, and
// another order's token all end the same way, with null.

/** The page for an order the token opens, or null for every refusal alike. */
export async function readOrderPage(
  reference: string,
  token: string,
): Promise<OrderPageView | null> {
  const opened = await resolveToken('order', token, reference);
  if (opened === null) return null;
  const order = await db.transaction((tx) =>
    readBookingEmailOrder(tx, opened.id),
  );
  if (order === null) return null;
  return orderPageView(order.source, {
    manageToken: capabilityToken('manage', opened.id, opened.version),
    appUrl: env.APP_URL,
  });
}

/** Where the order stands for the S9 poller, or null when the token does not open it. */
export async function readOrderState(
  reference: string,
  token: string,
): Promise<OrderStatusState | null> {
  const opened = await resolveToken('order', token, reference);
  if (opened === null) return null;
  const status = await readOrderStatus(opened.id);
  return status === null ? null : orderStatusState(status);
}
