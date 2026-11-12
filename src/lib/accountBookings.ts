import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import {
  bookingStatusLabels,
  hostDashboardBookingStatuses,
  whenLabel,
} from './hostDashboard';
import { managePath } from './routes';
import { TimeZoneSchema } from './sessions';

// A signed-in guest's own bookings (PRD-37): the confirmed and the since-cancelled, split into
// what is still ahead and what is behind them. Each links to the manage page, which is where a
// booking is changed or cancelled.

/** The most bookings the page reads; a guest has a handful, and a larger result is cut, latest first. */
export const accountBookingLimit = 100;

export const AccountBookingRowSchema = z.object({
  id: EntityIdSchema,
  reference: z.string().min(1),
  experienceName: z.string().min(1),
  startsAt: z.date(),
  timeZone: TimeZoneSchema,
  status: z.enum(hostDashboardBookingStatuses),
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
  /** "Sat, Nov 14 · 2:00 PM EST", on the session's own calendar and clock. */
  whenLabel: string;
  statusLabel: string;
  manageHref: string;
};

export type AccountBookingsView = {
  upcoming: readonly AccountBookingView[];
  past: readonly AccountBookingView[];
};

function bookingView(row: AccountBookingRow): AccountBookingView {
  return {
    id: row.id,
    reference: row.reference,
    experienceName: row.experienceName,
    whenLabel: whenLabel(row.startsAt, row.timeZone),
    statusLabel: bookingStatusLabels[row.status],
    manageHref: managePath(row.manageToken),
  };
}

const byStart = (a: AccountBookingRow, b: AccountBookingRow) =>
  a.startsAt.getTime() - b.startsAt.getTime();

/**
 * Upcoming is a confirmed booking whose session has not started, soonest first; everything else,
 * cancelled bookings included, is past, latest first.
 */
export function buildAccountBookings(
  rows: readonly AccountBookingRow[],
  now: Date,
): AccountBookingsView {
  const isUpcoming = (row: AccountBookingRow) =>
    row.status === 'confirmed' && row.startsAt.getTime() >= now.getTime();
  return {
    upcoming: rows.filter(isUpcoming).sort(byStart).map(bookingView),
    past: rows
      .filter((row) => !isUpcoming(row))
      .sort((a, b) => byStart(b, a))
      .map(bookingView),
  };
}

export type AccountBookingsResult =
  { status: 'signed_out' } | { status: 'ok'; view: AccountBookingsView };
