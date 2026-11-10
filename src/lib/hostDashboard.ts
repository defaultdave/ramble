import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { formatMoney } from './money';
import { TimeZoneSchema } from './sessions';
import {
  spacesLeft as seatsLeft,
  spacesStatus,
  type SpacesStatus,
} from './spaces';
import { zonedShortDayLabel, zonedTimeLabel } from './zonedLabels';

/** How much of a host's schedule and bookings the dashboard reads: the next ten sessions and the ten latest bookings. */
export const hostDashboardLimits = { sessions: 10, bookings: 10 } as const;

/** The bookings a host sees: the ones that were paid for, and the ones since cancelled. */
export const hostDashboardBookingStatuses = ['confirmed', 'cancelled'] as const;

/** What the data layer hands over for one upcoming session of the host. */
export const HostDashboardSessionSchema = z.object({
  id: EntityIdSchema,
  experienceName: z.string().min(1),
  startsAt: z.date(),
  timeZone: TimeZoneSchema,
  allocation: z.int().min(0),
  seatsSold: z.int().min(0),
});
export type HostDashboardSession = z.infer<typeof HostDashboardSessionSchema>;

/** What the data layer hands over for one booking on the host's sessions. */
export const HostDashboardBookingSchema = z.object({
  id: EntityIdSchema,
  reference: z.string().min(1),
  leadGuestName: z.string().min(1),
  experienceName: z.string().min(1),
  sessionStartsAt: z.date(),
  timeZone: TimeZoneSchema,
  seats: z.int().min(0),
  totalMinor: z.int().min(0),
  status: z.enum(hostDashboardBookingStatuses),
});
export type HostDashboardBooking = z.infer<typeof HostDashboardBookingSchema>;

export type HostDashboardData = {
  hostName: string;
  sessions: readonly HostDashboardSession[];
  bookings: readonly HostDashboardBooking[];
};

export type HostSessionRowView = {
  id: string;
  experienceName: string;
  /** "Sat, Nov 14 · 2:00 PM EST", on the session's own calendar and clock. */
  whenLabel: string;
  /** "6 of 10 seats sold". */
  soldLabel: string;
  /** How full the session is, 0 to 100, for the bar; the label carries the meaning. */
  soldPercent: number;
  status: SpacesStatus;
};

export type HostBookingRowView = {
  id: string;
  reference: string;
  guestName: string;
  experienceName: string;
  whenLabel: string;
  /** "3 seats". */
  seatsLabel: string;
  totalLabel: string;
  statusLabel: string;
};

export type HostDashboardView = {
  hostName: string;
  sessions: readonly HostSessionRowView[];
  bookings: readonly HostBookingRowView[];
};

const bookingStatusLabels = {
  confirmed: 'Confirmed',
  cancelled: 'Cancelled',
} as const satisfies Record<HostDashboardBooking['status'], string>;

const whenLabel = (instant: Date, timeZone: string) =>
  `${zonedShortDayLabel(instant, timeZone)} · ${zonedTimeLabel(instant, timeZone)}`;

/** How much of the allocation is sold, as a whole percent. 100 means full: a session one seat short never reads as full, and an allocation of 0 is full. */
export function soldPercent(seatsSold: number, allocation: number): number {
  if (allocation <= 0 || seatsSold >= allocation) return 100;
  return Math.min(99, Math.floor((seatsSold / allocation) * 100));
}

function sessionRow(session: HostDashboardSession): HostSessionRowView {
  return {
    id: session.id,
    experienceName: session.experienceName,
    whenLabel: whenLabel(session.startsAt, session.timeZone),
    soldLabel: `${String(session.seatsSold)} of ${String(session.allocation)} seats sold`,
    soldPercent: soldPercent(session.seatsSold, session.allocation),
    status: spacesStatus(seatsLeft(session)),
  };
}

function bookingRow(booking: HostDashboardBooking): HostBookingRowView {
  return {
    id: booking.id,
    reference: booking.reference,
    guestName: booking.leadGuestName,
    experienceName: booking.experienceName,
    whenLabel: whenLabel(booking.sessionStartsAt, booking.timeZone),
    seatsLabel:
      booking.seats === 1 ? '1 seat' : `${String(booking.seats)} seats`,
    totalLabel: formatMoney(booking.totalMinor),
    statusLabel: bookingStatusLabels[booking.status],
  };
}

/** The rows the dashboard draws, in the order handed over and never more than the limits, whatever the data layer returns. */
export function buildHostDashboard(data: HostDashboardData): HostDashboardView {
  return {
    hostName: data.hostName,
    sessions: data.sessions
      .slice(0, hostDashboardLimits.sessions)
      .map(sessionRow),
    bookings: data.bookings
      .slice(0, hostDashboardLimits.bookings)
      .map(bookingRow),
  };
}
