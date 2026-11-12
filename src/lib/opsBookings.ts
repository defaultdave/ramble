import { z } from 'zod';
import type { AuditEntryInput } from './audit';
import { WriteIdSchema } from './catalog';
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
import { opsAreaIds, opsAreaListEntry, opsViewEntry } from './opsAudit';
import { type FormGetter, type NoticeText, formText } from './opsForm';
import {
  isOrderReference,
  orderCancelledBys,
  type OrderKind,
  type OrderStatus,
} from './orders';
import {
  orderRefundReasons,
  planRefund,
  RefundMinorSchema,
  type RefundStatus,
} from './refunds';
import { statusFilter, type StatusTone } from './statusBadge';
import { countLabel } from './text';
import { zonedDeadlineLabel } from './zonedLabels';

// The ops bookings area (PRD-51, lite cut): finding a booking, what ops may do to it, and what each
// answer says. The data layer reads and writes; every decision below is a plain function.

export const opsBookingsPath = '/ops/bookings';
export const opsBookingPath = (orderId: string) =>
  `${opsBookingsPath}/${orderId}`;

const bookingFilters = ['refund_failed'] as const;
export type BookingFilter = (typeof bookingFilters)[number];

const refundFailedLabel = 'Refund failed';

const bookingFilter = statusFilter(bookingFilters, {
  refund_failed: refundFailedLabel,
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
 * The search a term names (already read with `parseSearchTerm`): a term with an `@` is a guest's address, anything else must be a
 * booking reference (any case). A term that is neither is `invalid` and finds nothing: it is never
 * matched loosely, so the box cannot be used to browse every guest.
 */
export function parseBookingSearch(term: string): BookingSearch {
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
      ? { tone: 'danger', label: refundFailedLabel }
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
  status: RefundStatus;
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
  facts: CancelFacts;
  /** The confirmation email's source, or null when the order has none (it is not a booking). */
  emailSource: BookingEmailSource | null;
  refunds: readonly OpsRefundRecord[];
  history: readonly OpsHistoryRecord[];
  /** Names one send of the confirmation: the form carries it, so a double click queues one email. */
  resendId: string;
  now: Date;
};

/** One action ops may take: its words, and the fields its form carries beside the booking id. */
export type OpsActionView = {
  label: string;
  help: string;
  fields: readonly { name: string; value: string }[];
};

export type OpsBookingDetail = {
  row: OpsBookingRow;
  /** Each action the booking allows now, or null for one it does not. */
  actions: {
    cancel: OpsActionView | null;
    refund: OpsActionView | null;
    retryRefund: OpsActionView | null;
    resend: OpsActionView | null;
    voidLinks: OpsActionView;
  };
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

type RefundableBooking = {
  kind: OrderKind;
  status: OrderStatus;
  refundFailed: boolean;
};

/**
 * What an ops refund of the whole rest of the order would send back, or null when ops may not
 * refund it: the booking is cancelled (a refund of a live booking would leave the guest holding the
 * spaces), no refund failed that ops should retry instead, and something is left to give back.
 */
export function opsRefundQuote(
  order: RefundableBooking,
  facts: CancelFacts,
): { amountMinor: number } | null {
  if (
    order.kind !== 'booking' ||
    order.status !== 'cancelled' ||
    order.refundFailed
  ) {
    return null;
  }
  const plan = planRefund(facts, 'remaining');
  return plan.status === 'planned'
    ? { amountMinor: plan.split.amountMinor }
    : null;
}

/** The refund under the lock against the amount ops was shown: a different amount changes the terms and refunds nothing. */
export function opsRefundVerdict(
  order: RefundableBooking,
  facts: CancelFacts,
  expectedMinor: number,
): 'go' | 'refused' | 'terms_changed' {
  const quote = opsRefundQuote(order, facts);
  if (quote === null) return 'refused';
  return quote.amountMinor === expectedMinor ? 'go' : 'terms_changed';
}

const actionCopy = {
  cancel: 'Cancel booking',
  retryRefund: {
    label: 'Retry refund',
    help: 'The last refund failed. This asks the payment provider again for that refund.',
  },
  resend: {
    label: 'Resend confirmation',
    help: 'Queues the confirmation and calendar file for the address on the booking, with a working link.',
  },
  voidLinks: {
    label: 'Void earlier links',
    help: 'Stops every link already emailed from opening this booking. Resend the confirmation for a new one.',
  },
} as const;

const expectedRefundField = (amountMinor: number) => ({
  name: 'expectedRefundMinor',
  value: String(amountMinor),
});

const refundStatusLabels = {
  pending: 'Pending',
  succeeded: 'Sent',
  failed: 'Failed',
  gift_reinstated: 'Gift put back',
} satisfies Record<RefundStatus, string>;

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

/** The booking page: what ops sees and which actions it offers, each decided from the same facts the data layer re-judges under its lock. */
export function buildOpsBookingDetail(
  record: OpsBookingDetailRecord,
): OpsBookingDetail {
  const { booking, facts } = record;
  const quote = cancelQuote(facts, record.now);
  const refund = opsRefundQuote({ ...booking, kind: facts.kind }, facts);
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
    ...record.history.flatMap((entry) =>
      isHistoryAction(entry.action)
        ? [{ at: entry.recordedAt, label: historyActionLabels[entry.action] }]
        : [],
    ),
  ].toSorted((a, b) => a.at.getTime() - b.at.getTime());
  return {
    row: buildOpsBookingRow(booking),
    actions: {
      cancel:
        quote.kind === 'cancellable'
          ? {
              label: actionCopy.cancel,
              help: cancelBasisLines[quote.basis],
              fields: [expectedRefundField(quote.refundMinor)],
            }
          : null,
      refund:
        refund === null
          ? null
          : {
              label: `Refund ${formatMoney(refund.amountMinor)}`,
              help: `Sends ${formatMoney(refund.amountMinor)}, everything this booking still holds, back to the card it was paid with.`,
              fields: [expectedRefundField(refund.amountMinor)],
            },
      retryRefund: booking.refundFailed
        ? { ...actionCopy.retryRefund, fields: [] }
        : null,
      resend:
        record.emailSource !== null &&
        confirmationDecision(record.emailSource) === 'send'
          ? {
              ...actionCopy.resend,
              fields: [{ name: 'resendId', value: record.resendId }],
            }
          : null,
      voidLinks: { ...actionCopy.voidLinks, fields: [] },
    },
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

const cancelBasisLines = {
  full: 'Cancelling refunds the whole booking to the card.',
  window_closed:
    'The free cancellation window has closed: cancelling refunds nothing.',
  gift_paid: 'A gift paid for this booking: cancelling refunds nothing.',
  already_refunded: 'Nothing is left to refund.',
} satisfies Record<RefundBasis, string>;

/** What the cancel and refund data functions take: the booking and the refund ops was shown. */
export const ExpectedRefundInputSchema = z.strictObject({
  orderId: WriteIdSchema,
  expectedRefundMinor: RefundMinorSchema,
});

export type OpsCancelForm =
  { ok: true; expectedRefundMinor: number } | { ok: false };

/** The cancel and refund forms: the refund ops was shown, in digits, which the cancel checks against what the tier gives now. */
export function parseExpectedRefundForm(get: FormGetter): OpsCancelForm {
  const parsed = RefundMinorSchema.safeParse(
    refundMinorFromText(formText(get, 'expectedRefundMinor')),
  );
  return parsed.success
    ? { ok: true, expectedRefundMinor: parsed.data }
    : { ok: false };
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
  'try_again',
  'invalid',
] as const;
export type OpsNoticeCode = (typeof opsNoticeCodes)[number];

export const opsBookingNotices = {
  cancelled: { tone: 'success', title: 'Booking cancelled.' },
  terms_changed: {
    tone: 'warning',
    title:
      'The refund changed while this page was open. Nothing was done: check the amount and try again.',
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
    title: 'Confirmation email queued for the address on the booking.',
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
  try_again: {
    tone: 'warning',
    title:
      'The booking changed while this page was open. Reload it and try again.',
  },
  invalid: { tone: 'warning', title: 'That request could not be read.' },
} satisfies Record<OpsNoticeCode, NoticeText>;

/** The notice for what the guest-facing cancel answered. Ops spends no try of the guest's limit, so a limit answer is a bug. */
export function cancelNoticeCode(
  result: CancelBookingResult | { status: 'try_again' },
): OpsNoticeCode {
  switch (result.status) {
    case 'try_again':
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
  status:
    | 'requested'
    | 'already_requested'
    | 'refused'
    | 'not_found'
    | 'terms_changed',
): OpsNoticeCode {
  switch (status) {
    case 'not_found':
    case 'terms_changed':
      return status;
    case 'requested':
      return 'refund_requested';
    case 'already_requested':
      return 'refund_already_requested';
    case 'refused':
      return 'refund_refused';
  }
}

export function resendNoticeCode(
  outcome: 'queued' | 'not_found' | 'not_resendable',
): OpsNoticeCode {
  return outcome === 'queued' ? 'resent' : outcome;
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
export const bookingViewedEntry = (
  userId: string,
  orderId: string,
): AuditEntryInput => opsViewEntry(userId, 'booking.viewed', 'order', orderId);

export const linksVoidedEntry = (
  userId: string,
  orderId: string,
  tokenVersion: number,
) =>
  opsViewEntry(userId, 'booking.ops_links_voided', 'order', orderId, {
    token_version: tokenVersion,
  });

/** The resend id also keys the email, so the audit row and the message log name the same send. */
export const confirmationResentEntry = (
  userId: string,
  orderId: string,
  resendId: string,
) =>
  opsViewEntry(userId, 'booking.ops_confirmation_resent', 'order', orderId, {
    resend_id: resendId,
  });

export const resendJobKind = 'guest-confirmation-resend';

/** The job an ops resend queues: ids only, so a job row holds no address or name. */
export const GuestResendPayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  resendId: z.uuid(),
});
