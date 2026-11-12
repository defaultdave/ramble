import { userOrderEntry, type AuditEntryInput } from './audit';
import { confirmationDecision, type BookingEmailSource } from './bookingEmails';
import {
  cancelQuote,
  refundMinorFromText,
  type CancelBookingResult,
  type CancelFacts,
  type RefundBasis,
} from './cancelBooking';
import { GuestEmailSchema } from './guests';
import { defaultHostTimeZone } from './hostSetup';
import { bookingStatusLabels, whenLabel } from './hostDashboard';
import { formatMoney } from './money';
import { opsAreaIds, opsAreaListEntry } from './opsAudit';
import { type FormGetter, type NoticeText, formText } from './opsForm';
import { isOrderReference, type OrderKind, type OrderStatus } from './orders';
import {
  orderRefundReasons,
  planRefund,
  type RefundRequestInput,
} from './refunds';
import { opsRefundReason } from './refundRetry';
import { parseStatusParam, type StatusTone } from './statusBadge';
import { parseSearchTerm } from './tableQuery';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops bookings area (PRD-51, lite cut): finding a booking, what ops may do to it, and what each
// answer says. The data layer reads and writes; every decision below is a plain function.

export const opsBookingsPath = '/ops/bookings';
export const opsBookingPath = (orderId: string) =>
  `${opsBookingsPath}/${orderId}`;
export const opsBookingsPageSize = 25;

const bookingFilters = ['refund_failed'] as const;
export type BookingFilter = (typeof bookingFilters)[number];

export const bookingFilterOptions = [
  { value: 'refund_failed', label: 'Refund failed' },
] as const;

/** The filter the address names, or null (every booking) for none, a repeated one, or one the list does not have. */
export function parseBookingFilter(
  raw: string | readonly string[] | undefined,
): BookingFilter | null {
  return parseStatusParam(raw, bookingFilters, bookingFilterOptions);
}

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
  const found = count === 1 ? '1 booking' : `${String(count)} bookings`;
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
  refundFailed: boolean;
  guestName: string;
  email: string;
  experienceName: string;
  whenLabel: string;
  totalLabel: string;
  href: string;
};

/** A booking as the list shows it: the session on its own clock, the total in dollars. */
export function buildOpsBookingRows(
  records: readonly OpsBookingRecord[],
): OpsBookingRow[] {
  return records.map((record) => ({
    id: record.id,
    reference: record.reference,
    status: record.status,
    refundFailed: record.refundFailed,
    guestName: record.leadGuestName ?? '—',
    email: record.contactEmail,
    experienceName: record.experienceName,
    whenLabel: whenLabel(record.sessionStartsAt, record.timeZone),
    totalLabel: formatMoney(record.totalMinor),
    href: opsBookingPath(record.id),
  }));
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
    cancelledBy: string | null;
    createdAt: Date;
    confirmedAt: Date | null;
    cancelledAt: Date | null;
    refundedTicketMinor: number;
    refundedTaxMinor: number;
  };
  facts: CancelFacts;
  /** The confirmation email's source, or null when the order has none (it is not a booking). */
  emailSource: BookingEmailSource | null;
  refunds: readonly OpsRefundRecord[];
  history: readonly OpsHistoryRecord[];
  now: Date;
};

export type OpsBookingDetail = {
  row: OpsBookingRow;
  /** What cancelling refunds now (the amount the form carries back), or null when it cannot be cancelled. */
  cancel: { refundMinor: number; basis: RefundBasis } | null;
  canRefund: boolean;
  canRetryRefund: boolean;
  canResend: boolean;
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

type OpsHistoryRecord = { action: string; recordedAt: Date };

const historyActionLabels = {
  'booking.ops_cancel_requested': 'Cancelled by ops',
  'booking.ops_refund_requested': 'Refund requested by ops',
  'booking.ops_refund_retried': 'Failed refund retried by ops',
  'booking.ops_links_voided': 'Earlier links voided by ops',
  'booking.ops_confirmation_resent': 'Confirmation email resent by ops',
} as const;

/** The audit actions the booking's history lists: what ops did to it, not the reads. */
export const opsHistoryActions = Object.keys(historyActionLabels);

function isHistoryAction(
  action: string,
): action is keyof typeof historyActionLabels {
  return action in historyActionLabels;
}

/**
 * Whether ops may refund the order: the booking is cancelled (a refund of a live booking would
 * leave the guest holding the spaces) and no refund failed that ops should retry instead.
 */
export function opsRefundDecision(order: {
  kind: OrderKind;
  status: OrderStatus;
  refundFailed: boolean;
}): 'go' | 'refused' {
  return order.kind === 'booking' &&
    order.status === 'cancelled' &&
    !order.refundFailed
    ? 'go'
    : 'refused';
}

const refundStatusLabels = {
  pending: 'Pending',
  succeeded: 'Sent',
  failed: 'Failed',
  gift_reinstated: 'Gift put back',
} satisfies Record<OpsRefundRecord['status'], string>;

const at = (instant: Date) => zonedDeadlineLabel(instant, defaultHostTimeZone);

function isKnownReason(
  reason: string,
): reason is keyof typeof refundReasonLabels {
  return reason in refundReasonLabels;
}

/** The booking page: what ops sees and which actions it offers, each decided from the same facts the data layer re-judges under its lock. */
export function buildOpsBookingDetail(
  record: OpsBookingDetailRecord,
): OpsBookingDetail {
  const { booking, facts } = record;
  const quote = cancelQuote(facts, record.now);
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
            label: `Cancelled by ${booking.cancelledBy ?? 'the system'}`,
          },
        ]),
    ...record.history.flatMap((entry) =>
      isHistoryAction(entry.action)
        ? [{ at: entry.recordedAt, label: historyActionLabels[entry.action] }]
        : [],
    ),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime());
  return {
    row: buildOpsBookingRows([booking])[0] as OpsBookingRow,
    cancel:
      quote.kind === 'cancellable'
        ? { refundMinor: quote.refundMinor, basis: quote.basis }
        : null,
    canRefund:
      opsRefundDecision({ ...booking, kind: facts.kind }) === 'go' &&
      planRefund(facts, 'remaining').status === 'planned',
    canRetryRefund: booking.refundFailed,
    canResend:
      record.emailSource !== null &&
      confirmationDecision(record.emailSource) === 'send',
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

export const cancelBasisLines = {
  full: 'Cancelling refunds the whole booking to the card.',
  window_closed:
    'The free cancellation window has closed: cancelling refunds nothing.',
  gift_paid: 'A gift paid for this booking: cancelling refunds nothing.',
  already_refunded: 'Nothing is left to refund.',
} satisfies Record<RefundBasis, string>;

export type OpsCancelForm =
  { ok: true; expectedRefundMinor: number } | { ok: false };

/** The cancel form: the refund ops was shown, in digits, which the cancel checks against what the tier gives now. */
export function parseCancelForm(get: FormGetter): OpsCancelForm {
  const expectedRefundMinor = refundMinorFromText(
    formText(get, 'expectedRefundMinor'),
  );
  return expectedRefundMinor < 0
    ? { ok: false }
    : { ok: true, expectedRefundMinor };
}

/** One ops refund of the whole rest of an order: the same key asks again and changes nothing. */
export function opsRefundRequest(
  orderId: string,
  userId: string,
): RefundRequestInput {
  return {
    orderId,
    reason: opsRefundReason,
    key: 'ops-refund',
    ticketMinor: 'remaining',
    initiatedBy: userId,
  };
}

export const opsNoticeCodes = [
  'cancelled',
  'terms_changed',
  'not_cancellable',
  'already_cancelled',
  'refund_unavailable',
  'not_found',
  'refund_requested',
  'refund_already_requested',
  'refund_refused',
  'resent',
  'not_resendable',
  'links_voided',
  'invalid',
] as const;
export type OpsNoticeCode = (typeof opsNoticeCodes)[number];

export const opsBookingNotices = {
  cancelled: { tone: 'success', title: 'Booking cancelled.' },
  terms_changed: {
    tone: 'warning',
    title:
      'The refund changed while this page was open. Nothing was cancelled: check the refund and try again.',
  },
  not_cancellable: {
    tone: 'info',
    title:
      'That booking cannot be cancelled: it is not confirmed, or its session has started.',
  },
  already_cancelled: {
    tone: 'info',
    title: 'That booking was already cancelled.',
  },
  refund_unavailable: {
    tone: 'danger',
    title: 'The refund could not be started, so nothing was cancelled.',
  },
  not_found: { tone: 'warning', title: 'That booking could not be found.' },
  refund_requested: { tone: 'success', title: 'Refund requested.' },
  refund_already_requested: {
    tone: 'info',
    title: 'That refund was already requested.',
  },
  refund_refused: {
    tone: 'warning',
    title: 'No refund was made: the booking cannot be refunded as it stands.',
  },
  resent: {
    tone: 'success',
    title: 'Confirmation email sent to the address on the booking.',
  },
  not_resendable: {
    tone: 'info',
    title: 'Only a confirmed booking has a confirmation to resend.',
  },
  links_voided: {
    tone: 'success',
    title:
      'Earlier links voided. Resend the confirmation to give the guest a new one.',
  },
  invalid: { tone: 'warning', title: 'That request could not be read.' },
} satisfies Record<OpsNoticeCode, NoticeText>;

/** The notice for what the guest-facing cancel answered. Ops spends no try of the guest's limit, so a limit answer is a bug. */
export function cancelNoticeCode(result: CancelBookingResult): OpsNoticeCode {
  switch (result.status) {
    case 'cancelled':
    case 'terms_changed':
    case 'already_cancelled':
    case 'refund_unavailable':
    case 'not_found':
      return result.status;
    case 'not_refundable':
      return 'not_cancellable';
    case 'rate_limited':
      throw new RangeError('An ops cancel spends no try of the manage limit');
  }
}

/** The notice for what a refund or a retry answered. */
export function refundNoticeCode(
  status: 'requested' | 'already_requested' | 'refused' | 'not_found',
): OpsNoticeCode {
  switch (status) {
    case 'not_found':
      return 'not_found';
    case 'requested':
      return 'refund_requested';
    case 'already_requested':
      return 'refund_already_requested';
    case 'refused':
      return 'refund_refused';
  }
}

export function resendNoticeCode(
  outcome: 'sent' | 'not_found' | 'not_resendable',
): OpsNoticeCode {
  return outcome === 'sent' ? 'resent' : outcome;
}

/** The notice for voiding the links: no result means there was no such booking. */
export function voidNoticeCode(
  voided: { version: number } | null,
): OpsNoticeCode {
  return voided === null ? 'not_found' : 'links_voided';
}

/** The bookings list was read: it shows guests' names and addresses. */
export const bookingsListEntry = (userId: string): AuditEntryInput =>
  opsAreaListEntry(userId, 'booking.list_viewed', opsAreaIds.bookings);

/** One booking was opened. */
export const bookingViewedEntry = (userId: string, orderId: string) =>
  userOrderEntry(userId, 'booking.viewed', orderId);

export const refundRequestedEntry = (
  userId: string,
  orderId: string,
  refundId: string,
) =>
  userOrderEntry(userId, 'booking.ops_refund_requested', orderId, {
    refund_id: refundId,
  });

export const linksVoidedEntry = (
  userId: string,
  orderId: string,
  tokenVersion: number,
) =>
  userOrderEntry(userId, 'booking.ops_links_voided', orderId, {
    token_version: tokenVersion,
  });

/** The resend id also keys the email, so the audit row and the message log name the same send. */
export const confirmationResentEntry = (
  userId: string,
  orderId: string,
  resendId: string,
) =>
  userOrderEntry(userId, 'booking.ops_confirmation_resent', orderId, {
    resend_id: resendId,
  });
