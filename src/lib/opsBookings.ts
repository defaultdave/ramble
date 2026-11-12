import type { AuditEntryInput } from './audit';
import { GuestEmailSchema } from './guests';
import { defaultHostTimeZone } from './hostSetup';
import { bookingStatusLabels, whenLabel } from './hostDashboard';
import { formatMoney } from './money';
import { opsAreaIds, opsAreaListEntry, opsViewEntry } from './opsAudit';
import {
  isOrderReference,
  orderCancelledBys,
  type OrderStatus,
} from './orders';
import { orderRefundReasons } from './refunds';
import { statusFilter, type StatusTone } from './statusBadge';
import { parseSearchTerm } from './tableQuery';
import { countLabel } from './text';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops bookings area (PRD-51, lite cut), read side: finding a booking and what its page shows.
// The data layer reads; every decision below is a plain function.

export const opsBookingsPath = '/ops/bookings';
export const opsBookingPath = (orderId: string) =>
  `${opsBookingsPath}/${orderId}`;

const bookingFilters = ['refund_failed'] as const;
export type BookingFilter = (typeof bookingFilters)[number];

const bookingFilter = statusFilter(bookingFilters, {
  refund_failed: 'Refund failed',
});
export const bookingFilterOptions = bookingFilter.options;

/** The filter the address names, or null (every booking) for none, a repeated one, or one the list does not have. */
export const parseBookingFilter = bookingFilter.parse;

export type BookingSearch =
  | { kind: 'none' }
  | { kind: 'email'; email: string }
  | { kind: 'reference'; reference: string }
  | { kind: 'invalid' };

/**
 * The search the address names: a term with an `@` is a guest's address, anything else must be a
 * booking reference (any case). A term that is neither is `invalid` and finds nothing: it is never
 * matched loosely, so the box cannot be used to browse every guest.
 */
export function parseBookingSearch(
  raw: string | readonly string[] | undefined,
): BookingSearch {
  const term = parseSearchTerm(raw);
  if (term === '') return { kind: 'none' };
  if (term.includes('@')) {
    const email = GuestEmailSchema.safeParse(term);
    return email.success
      ? { kind: 'email', email: email.data }
      : { kind: 'invalid' };
  }
  const reference = term.toUpperCase();
  return isOrderReference(reference)
    ? { kind: 'reference', reference }
    : { kind: 'invalid' };
}

/** What the list says under the search box, so a search that found nothing is told apart from a bad term. */
export function searchSummary(search: BookingSearch, count: number): string {
  if (search.kind === 'invalid') {
    return 'Search by a booking reference such as RMB-ABC234, or by a guest’s full email address.';
  }
  if (search.kind === 'none') return '';
  const found = countLabel(count, 'booking');
  return `${found} for ${search.kind === 'email' ? search.email : search.reference}.`;
}

export const orderStatusLabels = {
  ...bookingStatusLabels,
  pending_payment: 'Awaiting payment',
  payment_failed: 'Payment failed',
  void: 'Void',
  refunded_after_lapse: 'Refunded after lapse',
} satisfies Record<OrderStatus, string>;

export const orderStatusTones = {
  pending_payment: 'info',
  confirmed: 'success',
  payment_failed: 'danger',
  void: 'neutral',
  cancelled: 'warning',
  refunded_after_lapse: 'warning',
} satisfies Record<OrderStatus, StatusTone>;

export type OpsBookingRecord = {
  id: string;
  reference: string;
  status: OrderStatus;
  refundFailed: boolean;
  leadGuestName: string | null;
  contactEmail: string;
  experienceName: string;
  sessionStartsAt: Date;
  timeZone: string;
  totalMinor: number;
};

export type OpsBookingRow = {
  id: string;
  reference: string;
  status: OrderStatus;
  /** The flag shown on a booking whose refund failed, or null. */
  refundFailedBadge: { tone: StatusTone; label: string } | null;
  guestName: string;
  email: string;
  experienceName: string;
  whenLabel: string;
  totalLabel: string;
  href: string;
};

/** A booking as the list shows it: the session on its own clock, the total in dollars. */
export function buildOpsBookingRow(record: OpsBookingRecord): OpsBookingRow {
  return {
    id: record.id,
    reference: record.reference,
    status: record.status,
    refundFailedBadge: record.refundFailed
      ? { tone: 'danger', label: 'Refund failed' }
      : null,
    guestName: record.leadGuestName ?? '—',
    email: record.contactEmail,
    experienceName: record.experienceName,
    whenLabel: whenLabel(record.sessionStartsAt, record.timeZone),
    totalLabel: formatMoney(record.totalMinor),
    href: opsBookingPath(record.id),
  };
}

const refundReasonLabels = {
  guest_cancel: 'Guest cancelled',
  host_cancel: 'Host cancelled',
  weather: 'Weather',
  ramble_cancel: 'Ramble cancelled',
  session_cancelled: 'Session cancelled',
  lapse_after_payment: 'Paid after the hold lapsed',
  goodwill: 'Goodwill',
  ops_adjustment: 'Ops refund',
} satisfies Record<(typeof orderRefundReasons)[number], string>;

type OpsRefundRecord = {
  id: string;
  amountMinor: number;
  reason: string;
  status: 'pending' | 'succeeded' | 'failed' | 'gift_reinstated';
  createdAt: Date;
};

export type OpsBookingDetailRecord = {
  booking: OpsBookingRecord & {
    cancelledBy: (typeof orderCancelledBys)[number] | null;
    createdAt: Date;
    confirmedAt: Date | null;
    cancelledAt: Date | null;
    refundedTicketMinor: number;
    refundedTaxMinor: number;
  };
  refunds: readonly OpsRefundRecord[];
};

export type OpsBookingDetail = {
  row: OpsBookingRow;
  refundedLabel: string;
  refunds: readonly {
    id: string;
    amountLabel: string;
    reasonLabel: string;
    statusLabel: string;
    whenLabel: string;
  }[];
  events: readonly { label: string; whenLabel: string }[];
};

const refundStatusLabels = {
  pending: 'Pending',
  succeeded: 'Sent',
  failed: 'Failed',
  gift_reinstated: 'Gift put back',
} satisfies Record<OpsRefundRecord['status'], string>;

const cancelledByLabels = {
  guest: 'Cancelled by guest',
  host: 'Cancelled by host',
  weather: 'Cancelled for weather',
  ramble: 'Cancelled by Ramble',
} satisfies Record<(typeof orderCancelledBys)[number], string>;

const at = (instant: Date) => zonedDeadlineLabel(instant, defaultHostTimeZone);

function isKnownReason(
  reason: string,
): reason is keyof typeof refundReasonLabels {
  return reason in refundReasonLabels;
}

/** The booking page: the booking, what it has had refunded, each refund in words, and its dates oldest first. */
export function buildOpsBookingDetail(
  record: OpsBookingDetailRecord,
): OpsBookingDetail {
  const { booking } = record;
  const events = [
    { at: booking.createdAt, label: 'Booking placed' },
    ...(booking.confirmedAt === null
      ? []
      : [{ at: booking.confirmedAt, label: 'Booking confirmed' }]),
    ...(booking.cancelledAt === null
      ? []
      : [
          {
            at: booking.cancelledAt,
            label:
              booking.cancelledBy === null
                ? 'Cancelled'
                : cancelledByLabels[booking.cancelledBy],
          },
        ]),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime());
  return {
    row: buildOpsBookingRow(booking),
    refundedLabel: formatMoney(
      booking.refundedTicketMinor + booking.refundedTaxMinor,
    ),
    refunds: record.refunds.map((refund) => ({
      id: refund.id,
      amountLabel: formatMoney(refund.amountMinor),
      reasonLabel: isKnownReason(refund.reason)
        ? refundReasonLabels[refund.reason]
        : refund.reason,
      statusLabel: refundStatusLabels[refund.status],
      whenLabel: at(refund.createdAt),
    })),
    events: events.map((event) => ({
      label: event.label,
      whenLabel: at(event.at),
    })),
  };
}

/** The bookings list was read: it shows guests' names and addresses. */
export const bookingsListEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'booking.list_viewed', opsAreaIds.bookings);

/** One booking was opened. */
export const bookingViewedEntry = (
  userId: string,
  orderId: string,
): AuditEntryInput => opsViewEntry(userId, 'booking.viewed', 'order', orderId);
