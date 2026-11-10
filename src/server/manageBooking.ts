import 'server-only';
import { isCapabilityTokenShape } from '@/lib/capabilityTokens';
import { manageView, type ManageView } from '@/lib/manageBooking';
import { db } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { readCancelFacts } from '@/server/db/ordersCancelFacts';
import { readDatabaseTime } from '@/server/db/time';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { resolveToken } from '@/server/tokens';

// The booking behind a manage link: the token is the guest's right, so it is checked first, and a
// malformed token, an unknown one, and one from before a bump all end the same way, in `not_found`.

export type ManagePage =
  | { kind: 'ok'; view: ManageView }
  | { kind: 'not_found' }
  | { kind: 'rate_limited'; retryAfterSeconds: number };

/** The page for the booking a manage token opens. Each view spends one try of the `manage` count. */
export async function readManagePage(token: string): Promise<ManagePage> {
  if (!isCapabilityTokenShape(token)) return { kind: 'not_found' };
  const spent = await consumeRateLimit('manage', token);
  if (!spent.allowed) {
    return { kind: 'rate_limited', retryAfterSeconds: spent.retryAfterSeconds };
  }
  const opened = await resolveToken('manage', token);
  if (opened === null) return { kind: 'not_found' };
  const read = await db.transaction(async (tx) => ({
    order: await readBookingEmailOrder(tx, opened.id),
    booking: await readCancelFacts(tx, opened.id),
    now: await readDatabaseTime(tx),
  }));
  if (read.order === null || read.booking === null) {
    return { kind: 'not_found' };
  }
  return {
    kind: 'ok',
    view: manageView(read.order.source, read.booking.facts, read.now),
  };
}
