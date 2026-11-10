import 'server-only';
import { openManageGate, type GateRefusal } from '@/lib/cancelBooking';
import { manageView, type ManageView } from '@/lib/manageBooking';
import { db } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { readCancelFacts } from '@/server/db/ordersCancelFacts';
import { readDatabaseTime } from '@/server/db/time';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { resolveToken } from '@/server/tokens';

// The booking behind a manage link: the token is the guest's right, so it is checked first, and a
// malformed token, an unknown one, and one from before a bump all end the same way, in `not_found`.

/**
 * The gate in front of every manage link, for the page and the action alike: the shape check, one
 * try of the `manage` count, and the lookup, in that order (see `openManageGate`).
 */
export function openManageToken(token: unknown) {
  return openManageGate(token, {
    spendTry: (checked) => consumeRateLimit('manage', checked),
    open: (checked) => resolveToken('manage', checked),
  });
}

export type ManagePage =
  { kind: 'ok'; view: ManageView } | { kind: 'refused'; refusal: GateRefusal };

/** The page for the booking a manage token opens. Each view spends one try of the `manage` count. */
export async function readManagePage(token: string): Promise<ManagePage> {
  const gate = await openManageToken(token);
  if (gate.kind === 'refused') return gate;
  const { id } = gate.row;
  const read = await db.transaction(async (tx) => ({
    order: await readBookingEmailOrder(tx, id),
    booking: await readCancelFacts(tx, id),
    now: await readDatabaseTime(tx),
  }));
  if (read.order === null || read.booking === null) {
    return { kind: 'refused', refusal: { status: 'not_found' } };
  }
  return {
    kind: 'ok',
    view: manageView(read.order.source, read.booking.facts, read.now),
  };
}
