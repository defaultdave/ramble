import type { AlertTone } from './alertTone';
import {
  greetingName,
  partyLabel,
  refundArrivalLine,
  type BookingEmailSource,
} from './bookingEmails';
import {
  cancelQuote,
  type CancelBookingResult,
  type CancelFacts,
  type CancelQuote,
  type RefundBasis,
} from './cancelBooking';
import { formatMoney } from './money';
import { orderSummaryAmounts } from './orderSummary';
import { oneLineClipped } from './text';
import {
  zonedDayLabel,
  zonedDeadlineLabel,
  zonedTimeLabel,
} from './zonedLabels';

// What the manage page says for a booking, built from the same quote the cancel action checks, so
// the refund shown first is the refund `expectedRefundMinor` carries back.

type Line = { label: string; amount: string };

export type ManageBooking = {
  reference: string;
  greeting: string;
  experienceName: string;
  hostName: string;
  dayLabel: string;
  timeLabel: string;
  partyLabel: string;
  meetingPoint: string | null;
  lines: Line[];
  taxLine: Line | null;
  total: string;
  giftApplied: string | null;
  charged: string | null;
};

export type CancelPrompt = {
  /** What cancelling refunds now, in minor units: the value `cancelBooking` is called with. */
  refundMinor: number;
  heading: string;
  body: string;
  buttonLabel: string;
  confirmTitle: string;
  confirmBody: string;
  arrivalLine: string | null;
};

export type ManageView =
  | { kind: 'active'; booking: ManageBooking; prompt: CancelPrompt }
  | { kind: 'cancelled'; booking: ManageBooking }
  /** Confirmed, but not cancellable now (the session has started). */
  | { kind: 'closed'; booking: ManageBooking };

function manageBooking(source: BookingEmailSource): ManageBooking {
  const amounts = orderSummaryAmounts({
    lines: source.items.map((item) => ({
      label: `${item.label} x ${String(item.quantity)}`,
      amountMinor: item.lineTotalMinor,
    })),
    taxTreatment: source.taxTreatment,
    taxMinor: source.taxMinor,
    totalMinor: source.totalMinor,
  });
  const paidWithGift = source.giftAppliedMinor > 0;
  return {
    reference: source.reference,
    greeting: greetingName(source.leadGuestName),
    experienceName: oneLineClipped(source.experienceName, 200),
    hostName: oneLineClipped(source.hostName, 120),
    dayLabel: zonedDayLabel(source.startsAt, source.timeZone),
    timeLabel: zonedTimeLabel(source.startsAt, source.timeZone),
    partyLabel: partyLabel(source.items),
    meetingPoint:
      source.meetingPoint === null
        ? null
        : oneLineClipped(source.meetingPoint, 600) || null,
    lines: amounts.lines,
    taxLine: amounts.tax,
    total: amounts.total,
    giftApplied: paidWithGift ? formatMoney(source.giftAppliedMinor) : null,
    charged: paidWithGift ? formatMoney(source.amountDueMinor) : null,
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
    arrivalLine: refunded ? refundArrivalLine : null,
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
      return { kind: 'cancelled', booking };
    case 'not_cancellable':
      return { kind: 'closed', booking };
  }
}

export type CancelNotice = {
  tone: AlertTone;
  title: string;
  body: string;
  /** True when nothing more can be done from this page, so the cancel controls go away. */
  settled: boolean;
};

const secondsPerMinute = 60;

/** "Try again in 3 minutes", rounded up so a guest is never told to retry too early. */
export function retryAfterLine(retryAfterSeconds: number): string {
  const minutes = Math.max(1, Math.ceil(retryAfterSeconds / secondsPerMinute));
  return `Try again in ${String(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}.`;
}

function cancelledBody(
  result: Extract<CancelBookingResult, { status: 'cancelled' }>,
): string {
  if (result.giftReinstated)
    return 'Your gift is back, so you can use it again.';
  if (result.refundMinor === 0) {
    return 'No refund is due under the cancellation terms.';
  }
  return `Your refund of ${formatMoney(result.refundMinor)} goes back to your original payment method. ${result.refundEta ?? refundArrivalLine}`;
}

/** What the page says after the guest asks to cancel, for every answer the action can give. */
export function cancelNotice(result: CancelBookingResult): CancelNotice {
  switch (result.status) {
    case 'cancelled':
      return {
        tone: 'success',
        title: 'Your booking is cancelled',
        body: cancelledBody(result),
        settled: true,
      };
    case 'terms_changed':
      return {
        tone: 'warning',
        title: 'The refund has changed',
        body: `Cancelling now refunds ${formatMoney(result.refundMinor)}. Nothing was cancelled. Check the amount below, then cancel again if you still want to.`,
        settled: false,
      };
    case 'not_refundable':
      return {
        tone: 'info',
        title: "This booking can't be cancelled here",
        body: "It isn't an active booking, or its session has started. Contact us if you need help.",
        settled: true,
      };
    case 'already_cancelled':
      return {
        tone: 'info',
        title: 'This booking is already cancelled',
        body: 'There is nothing more to do.',
        settled: true,
      };
    case 'refund_unavailable':
      return {
        tone: 'danger',
        title: "We couldn't start your refund",
        body: 'Nothing was cancelled. Try again in a moment, or contact us.',
        settled: false,
      };
    case 'not_found':
      return {
        tone: 'danger',
        title: 'This link no longer works',
        body: 'Use the link in the latest email we sent you.',
        settled: true,
      };
    case 'rate_limited':
      return {
        tone: 'warning',
        title: 'Too many tries',
        body: retryAfterLine(result.retryAfterSeconds),
        settled: false,
      };
  }
}
