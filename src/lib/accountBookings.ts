import { z } from 'zod';
import { bookingStatusLabels, whenLabel } from './hostDashboard';
import { BookingListRowSchema } from './hostGuestLists';
import { managePath } from './routes';

// A signed-in guest's own bookings (PRD-37): the confirmed and the since-cancelled, split into
// what is still ahead and what is behind them. Each links to the manage page, which is where a
// booking is changed or cancelled.

/** The most bookings the page reads; a guest has a handful, and a larger result is cut: upcoming bookings are kept first, soonest first, then past ones, latest first. */
export const accountBookingLimit = 100;

export const AccountBookingRowSchema = BookingListRowSchema.extend({
  manageTokenVersion: z.int().min(1),
});
export type AccountBookingData = z.infer<typeof AccountBookingRowSchema>;

/** A booking as the page reads it: the data layer's row with the manage token at the order's current version. */
export type AccountBookingRow = Omit<
  AccountBookingData,
  'manageTokenVersion'
> & {
  manageToken: string;
};

export type AccountBookingView = {
  id: string;
  reference: string;
  experienceName: string;
  /** "Sat, Nov 14 · 2:00 PM EST" on the session's own calendar and clock, then "Confirmed · RMB-K7QX2M". */
  details: readonly string[];
  manageHref: string;
};

export type AccountBookingsView = {
  upcoming: readonly AccountBookingView[];
  past: readonly AccountBookingView[];
  /** No booking at all, upcoming or past. */
  empty: boolean;
};

function bookingView(row: AccountBookingRow): AccountBookingView {
  return {
    id: row.id,
    reference: row.reference,
    experienceName: row.experienceName,
    details: [
      whenLabel(row.sessionStartsAt, row.timeZone),
      `${bookingStatusLabels[row.status]} · ${row.reference}`,
    ],
    manageHref: managePath(row.manageToken),
  };
}

const byStart = (a: AccountBookingRow, b: AccountBookingRow) =>
  a.sessionStartsAt.getTime() - b.sessionStartsAt.getTime();

/**
 * Upcoming is a confirmed booking whose session has not started, soonest first; everything else,
 * cancelled bookings included, is past, latest first.
 */
export function buildAccountBookings(
  rows: readonly AccountBookingRow[],
  now: Date,
): AccountBookingsView {
  const isUpcoming = (row: AccountBookingRow) =>
    row.status === 'confirmed' &&
    row.sessionStartsAt.getTime() >= now.getTime();
  return {
    upcoming: rows.filter(isUpcoming).sort(byStart).map(bookingView),
    past: rows
      .filter((row) => !isUpcoming(row))
      .sort((a, b) => byStart(b, a))
      .map(bookingView),
    empty: rows.length === 0,
  };
}

export type AccountBookingsResult =
  { status: 'signed_out' } | { status: 'ok'; view: AccountBookingsView };
