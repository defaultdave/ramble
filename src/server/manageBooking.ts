import 'server-only';
import { openManageGate } from '@/lib/cancelBooking';
import { manageReadOutcome, type ManageReadOutcome } from '@/lib/manageBooking';
import { db } from '@/server/db/client';
import { readBookingEmailOrder } from '@/server/db/bookingEmails';
import { readCancelFacts } from '@/server/db/ordersCancelFacts';
import {
  readMoveCandidates,
  readMoveSubject,
} from '@/server/db/ordersMoveFacts';
import { readDatabaseTime } from '@/server/db/time';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { resolveManageToken } from '@/server/tokens';

// The booking behind a manage link: the token is the guest's right, so it is checked first, and a
// malformed token, an unknown one, and one from before a bump all end the same way, in `not_found`.

/**
 * The gate in front of every manage link, for the page and the action alike: the shape check, one
 * try of the `manage` count, and the lookup, in that order (see `openManageGate`).
 */
export function openManageToken(token: unknown) {
  return openManageGate(token, {
    spendTry: (checked) => consumeRateLimit('manage', checked),
    open: (checked) => resolveManageToken(checked),
  });
}

/**
 * The page for the booking a manage token opens. Each view spends one try of the `manage` count.
 * With `picker`, the other dates of the booking's experience are read in the same snapshot.
 */
export async function readManagePage(
  token: string,
  options: { picker: boolean } = { picker: false },
): Promise<ManageReadOutcome> {
  const gate = await openManageToken(token);
  if (gate.kind === 'refused') return gate;
  const { id } = gate.row;
  const read = await db.transaction(async (tx) => {
    const now = await readDatabaseTime(tx);
    const subject = options.picker ? await readMoveSubject(tx, id) : null;
    return {
      order: await readBookingEmailOrder(tx, id),
      booking: await readCancelFacts(tx, id),
      now,
      picker:
        subject === null
          ? null
          : {
              subject,
              candidates: await readMoveCandidates(tx, subject, now),
            },
    };
  });
  return manageReadOutcome({
    order: read.order?.source ?? null,
    facts: read.booking?.facts ?? null,
    now: read.now,
    picker: read.picker,
  });
}
