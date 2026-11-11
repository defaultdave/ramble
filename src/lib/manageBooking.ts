import type { AlertTone } from './alertTone';
import {
  bookingSummaryData,
  cancellationRefundLine,
  refundArrivalLine,
  type BookingEmailSource,
  type BookingSummaryData,
} from './bookingEmails';
import {
  cancelQuote,
  missingOrderResult,
  refundEtaLine,
  type CancelBookingResult,
  type GateRefusal,
  type CancelFacts,
  type CancelQuote,
  type RefundBasis,
} from './cancelBooking';
import { formatMoney } from './money';
import {
  rateLimitPolicies,
  retryAfterMinutes,
  waitMinutesLabel,
} from './rateLimits';
import { managePath } from './routes';
import { zonedDeadlineLabel } from './zonedLabels';

// What the manage page says for a booking, built from the same quote the cancel action checks, so
// the refund shown first is the refund `expectedRefundMinor` carries back. The page and its form
// render what these functions return: the booking's own wording, the refund sentences, the notices,
// and the labels live here; only the page's fixed chrome (heading, help line, links) is in the component.

export type ManageBooking = BookingSummaryData & {
  totalLabel: string;
  /** "Saturday, November 7, 2026 · 4:00 PM EST · 3 guests". */
  metaLine: string;
  /** "Confirmation RMB-A3K7MN · with Harbor Light Sailing". */
  referenceLine: string;
  /** "Meet at Pier 40"; null when the experience has no meeting point. */
  meetingLine: string | null;
};

type CancelPrompt = {
  /** What cancelling refunds now, in minor units: the value the form posts as `expectedRefundMinor`. */
  refundMinor: number;
  heading: string;
  body: string;
  buttonLabel: string;
  confirmTitle: string;
  confirmBody: string;
  keepLabel: string;
  /** When the refund shows up, under the button; null when nothing is refunded. */
  footnote: string | null;
};

export type ManageView =
  | { kind: 'active'; booking: ManageBooking; prompt: CancelPrompt }
  | {
      kind: 'cancelled';
      booking: ManageBooking;
      /** What the cancelled order gave back, ticket and tax. */
      refundedMinor: number;
    }
  /** Confirmed, but not cancellable now (the session has started). */
  | { kind: 'closed'; booking: ManageBooking };

function manageBooking(source: BookingEmailSource): ManageBooking {
  const summary = bookingSummaryData(source);
  return {
    ...summary,
    totalLabel: 'Total charged',
    metaLine: `${summary.dayLabel} · ${summary.timeLabel} · ${summary.partyLabel}`,
    referenceLine: `Confirmation ${summary.reference} · with ${summary.hostName}`,
    meetingLine:
      summary.meetingPoint === null ? null : `Meet at ${summary.meetingPoint}`,
  };
}

/** The sentence above the cancel button: what cancelling refunds now, and why. */
function promptBody(
  basis: RefundBasis,
  refundMinor: number,
  deadline: string | null,
): string {
  switch (basis) {
    case 'full':
      return `Cancel by ${deadline ?? 'the deadline'} for a full refund of ${formatMoney(refundMinor)}. After that, the booking can't be refunded.`;
    case 'window_closed':
      return deadline === null
        ? "The free cancellation window has closed, so cancelling now isn't refunded."
        : `The free cancellation window closed on ${deadline}, so cancelling now isn't refunded.`;
    case 'gift_paid':
      return "This booking was paid with a gift, so cancelling it doesn't refund your card.";
    case 'already_refunded':
      return 'Everything on this booking has already been refunded.';
  }
}

function cancelPrompt(
  quote: Extract<CancelQuote, { kind: 'cancellable' }>,
  source: BookingEmailSource,
): CancelPrompt {
  const { refundMinor, basis } = quote;
  const deadline =
    source.freeCancelUntil === null
      ? null
      : zonedDeadlineLabel(source.freeCancelUntil, source.timeZone);
  const refunded = refundMinor > 0;
  return {
    refundMinor,
    heading: 'Change of plans',
    body: promptBody(basis, refundMinor, deadline),
    buttonLabel: refunded
      ? `Cancel and refund ${formatMoney(refundMinor)}`
      : 'Cancel without a refund',
    confirmTitle: 'Cancel this booking?',
    confirmBody: refunded
      ? `Your booking will be cancelled and ${formatMoney(refundMinor)} goes back to your card. This cannot be undone.`
      : 'Your booking will be cancelled and nothing will be refunded. This cannot be undone.',
    keepLabel: 'Keep my booking',
    footnote: refunded ? refundArrivalLine : null,
  };
}

/** The page for a booking, judged at `now` (the database's clock). */
export function manageView(
  source: BookingEmailSource,
  facts: CancelFacts,
  now: Date,
): ManageView {
  const booking = manageBooking(source);
  const quote = cancelQuote(facts, now);
  switch (quote.kind) {
    case 'cancellable':
      return { kind: 'active', booking, prompt: cancelPrompt(quote, source) };
    case 'already_cancelled':
      return {
        kind: 'cancelled',
        booking,
        refundedMinor: facts.refundedTicketMinor + facts.refundedTaxMinor,
      };
    case 'not_cancellable':
      return { kind: 'closed', booking };
  }
}

export type CancelNotice = {
  tone: AlertTone;
  title: string;
  body: string;
};

/** What a cancel answered, as the short code the redirect carries: the same words as the action's statuses. */
const cancelNoticeCodes = [
  'cancelled',
  'terms_changed',
  'not_refundable',
  'already_cancelled',
  'refund_unavailable',
  'not_found',
  'rate_limited',
] as const satisfies readonly CancelBookingResult['status'][];
export type CancelNoticeCode = (typeof cancelNoticeCodes)[number];

/** "Try again in 3 minutes". */
function retryAfterLine(retryAfterSeconds: number): string {
  return `Try again in ${waitMinutesLabel(retryAfterMinutes(retryAfterSeconds))}.`;
}

/**
 * What the page says for an answer of the cancel action. `refundMinor` is what a cancelled order
 * gave back; `retryAfterSeconds` is the wait a limit gave (the whole window when the page only has
 * the code).
 */
export function cancelNotice(
  code: CancelNoticeCode,
  context: {
    refundMinor?: number | undefined;
    retryAfterSeconds?: number | undefined;
  } = {},
): CancelNotice {
  switch (code) {
    case 'cancelled':
      return {
        tone: 'success',
        title: 'Your booking is cancelled',
        body: [
          cancellationRefundLine(context.refundMinor ?? 0),
          refundEtaLine(context.refundMinor ?? 0),
        ]
          .filter((line) => line !== null)
          .join(' '),
      };
    case 'terms_changed':
      return {
        tone: 'warning',
        title: 'The refund has changed',
        body: 'Nothing was cancelled. Check the refund below, then cancel again if you still want to.',
      };
    case 'not_refundable':
      return {
        tone: 'info',
        title: "This booking can't be cancelled here",
        body: "It isn't an active booking, or its session has started. Contact us if you need help.",
      };
    case 'already_cancelled':
      return {
        tone: 'info',
        title: 'This booking is already cancelled',
        body: 'There is nothing more to do.',
      };
    case 'refund_unavailable':
      return {
        tone: 'danger',
        title: "We couldn't start your refund",
        body: 'Nothing was cancelled. Try again in a moment, or contact us.',
      };
    case 'not_found':
      return {
        tone: 'danger',
        title: 'This link no longer works',
        body: 'Use the link in the latest email we sent you.',
      };
    case 'rate_limited':
      return {
        tone: 'warning',
        title: 'Too many tries',
        body: retryAfterLine(
          context.retryAfterSeconds ?? rateLimitPolicies.manage.windowSeconds,
        ),
      };
  }
}

function isNoticeCode(value: string): value is CancelNoticeCode {
  return (cancelNoticeCodes as readonly string[]).includes(value);
}

/** The first value of a query key, only when it is one string: an array or nothing is nothing. */
function single(value: string | string[] | undefined): string | null {
  return typeof value === 'string' ? value : null;
}

export type ManageQuery = {
  confirm?: string | string[];
  result?: string | string[];
};

/** `?confirm=1` is the second step; `?result=` is a cancel's answer. Neither is trusted as data: a value that is not exactly one of these is nothing. */
function parseManageQuery(query: ManageQuery): {
  confirming: boolean;
  code: CancelNoticeCode | null;
} {
  const result = single(query.result);
  return {
    confirming: single(query.confirm) === '1',
    code: result !== null && isNoticeCode(result) ? result : null,
  };
}

const everyView = ['active', 'cancelled', 'closed'] as const;

/** The booking states each answer can be about: a changed refund only of one that can still be cancelled, "cancelled" only of one that is. */
const answerFitsView: Record<CancelNoticeCode, readonly ManageView['kind'][]> =
  {
    cancelled: ['cancelled'],
    already_cancelled: ['cancelled'],
    terms_changed: ['active'],
    refund_unavailable: ['active'],
    not_refundable: ['closed'],
    not_found: everyView,
    rate_limited: everyView,
  };

/** What the page shows for a view and a query: the one notice, and whether the second step is open. */
export function managePageState(
  view: ManageView,
  query: ManageQuery,
): { notice: CancelNotice | null; confirming: boolean } {
  const { confirming, code } = parseManageQuery(query);
  const refundMinor = view.kind === 'cancelled' ? view.refundedMinor : 0;
  // A query can say anything, so an answer is shown only for a booking it could be the answer about.
  const shown =
    code !== null && answerFitsView[code].includes(view.kind) ? code : null;
  const standing =
    view.kind === 'cancelled'
      ? cancelNotice('already_cancelled')
      : view.kind === 'closed'
        ? cancelNotice('not_refundable')
        : null;
  return {
    notice: shown === null ? standing : cancelNotice(shown, { refundMinor }),
    confirming: confirming && view.kind === 'active',
  };
}

/** Where the second step is: the same page, with the step in the query. */
export function confirmPath(token: string): string {
  return `${managePath(token)}?confirm=1`;
}

/** Where a cancel lands the guest: the same page, with its answer in the query. */
export function cancelResultPath(
  token: string,
  result: CancelBookingResult,
): string {
  return `${managePath(token)}?result=${result.status}`;
}

/** What reading the manage page found: the page for the booking, or the refusal that says no more than "not found". */
export type ManageReadOutcome =
  { kind: 'ok'; view: ManageView } | { kind: 'refused'; refusal: GateRefusal };

/**
 * The page for what the data layer read: an order and a booking behind it, judged at `now`. Either
 * one missing is the refusal every other bad link gets.
 */
export function manageReadOutcome(read: {
  order: BookingEmailSource | null;
  facts: CancelFacts | null;
  now: Date;
}): ManageReadOutcome {
  if (read.order === null || read.facts === null) {
    return { kind: 'refused', refusal: missingOrderResult };
  }
  return { kind: 'ok', view: manageView(read.order, read.facts, read.now) };
}
