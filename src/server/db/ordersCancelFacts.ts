import 'server-only';
import { eq } from 'drizzle-orm';
import { isBookingRow, type CancelFacts } from '@/lib/cancelBooking';
import { WriteIdSchema } from '@/lib/catalog';
import type { Transaction } from './client';
import { holds, orders, sessions } from './schema';

// Apart from ./orderCancel, which enqueues jobs: the manage page reads these facts too, and the
// checkout route group must not reach the job registry (and the monitoring SDK its handlers use).

/** The booking as the cancel judges it, with the ids the locks and writes need. */
export type BookingRows = {
  facts: CancelFacts;
  sessionId: string;
};

/** Null when the order has no session and hold (it is not a booking) or does not exist. */
export async function readCancelFacts(
  tx: Transaction,
  orderId: string,
): Promise<BookingRows | null> {
  const id = WriteIdSchema.parse(orderId);
  const [row] = await tx
    .select({
      kind: orders.kind,
      status: orders.status,
      sessionId: orders.sessionId,
      holdId: orders.holdId,
      giftAppliedMinor: orders.giftAppliedMinor,
      freeCancelUntil: orders.freeCancelUntil,
      manageTokenVersion: orders.manageTokenVersion,
      ticketSubtotalMinor: orders.ticketSubtotalMinor,
      taxMinor: orders.taxMinor,
      totalMinor: orders.totalMinor,
      amountDueMinor: orders.amountDueMinor,
      commissionMinor: orders.commissionMinor,
      commissionRateBps: orders.commissionRateBps,
      refundedTicketMinor: orders.refundedTicketMinor,
      refundedTaxMinor: orders.refundedTaxMinor,
      commissionReturnedMinor: orders.commissionReturnedMinor,
      sessionStartsAt: sessions.startsAt,
      seats: holds.seats,
    })
    .from(orders)
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .innerJoin(holds, eq(holds.id, orders.holdId))
    .where(eq(orders.id, id));
  if (!row || !isBookingRow(row)) return null;
  const { sessionId, ...facts } = row;
  return { facts, sessionId };
}
