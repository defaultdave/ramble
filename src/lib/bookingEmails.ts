import type {
  BookingCancellationData,
  BookingRefundData,
  GuestConfirmationData,
  HostBookingNoticeData,
  PaidAfterLapseData,
} from './email/bookingTemplates';
import { durationLabel } from './duration';
import { googleCalendarUrl, type CalendarEvent } from './ics';
import { formatMoney } from './money';
import {
  orderSummaryAmounts,
  guestsLabel,
  type TaxTreatment,
} from './orderSummary';
import { isCapabilityTokenShape } from './capabilityTokens';
import type { orderCancelledBys, OrderStatus } from './orders';
import { browsePath, managePath } from './routes';
import { oneLineClipped } from './text';
import {
  zonedDayLabel,
  zonedDeadlineLabel,
  zonedTimeLabel,
} from './zonedLabels';

// What each booking email says. The job handlers load an order and call these; the templates only
// lay the finished text out. Anything the stored data can make long is cut to the template's limit.

export type CancelledBy = (typeof orderCancelledBys)[number];

/** Everything the booking emails read from an order, its session, its experience, and its host. */
export type BookingEmailSource = {
  orderId: string;
  reference: string;
  kind: 'booking' | 'gift_purchase';
  status: OrderStatus;
  leadGuestName: string | null;
  experienceName: string;
  meetingPoint: string | null;
  durationMinutes: number | null;
  hostName: string;
  startsAt: Date;
  endsAt: Date;
  /** The session's own zone: every time in the email is the host's wall clock. */
  timeZone: string;
  items: readonly {
    label: string;
    quantity: number;
    lineTotalMinor: number;
    usesSpace: boolean;
  }[];
  taxTreatment: TaxTreatment;
  taxMinor: number;
  totalMinor: number;
  giftAppliedMinor: number;
  amountDueMinor: number;
  freeCancelUntil: Date | null;
  confirmedAt: Date | null;
};

/**
 * One key per email and order: the confirm step uses it to queue each job once, and the job uses it
 * so the provider delivers each message once however often the job runs.
 */
export function bookingEmailKey(
  kind: 'guest-confirmation' | 'host-booking-notice',
  orderId: string,
): string {
  return `${kind}:${orderId}`;
}

export type ConfirmationDecision = 'send' | 'skip' | 'refuse';

/**
 * Whether the confirmation and the host notice go out for an order. Only a booking that is
 * confirmed gets them. A cancelled one is skipped (its cancellation email says what happened, and a
 * confirmation now would offer a dead link); anything else is refused, because no job should exist for it.
 */
export function confirmationDecision(source: {
  kind: BookingEmailSource['kind'];
  status: OrderStatus;
}): ConfirmationDecision {
  if (source.kind !== 'booking') return 'refuse';
  if (source.status === 'confirmed') return 'send';
  return source.status === 'cancelled' ? 'skip' : 'refuse';
}

const nameMax = 120;

/** The name a message greets. An order with no name yet is greeted as "there". */
export function greetingName(name: string | null): string {
  const clipped = oneLineClipped(name ?? '', nameMax);
  return clipped === '' ? 'there' : clipped;
}

/** What a host's notice calls a guest who gave no name. */
function guestNameForHost(name: string | null): string {
  const clipped = oneLineClipped(name ?? '', nameMax);
  return clipped === '' ? 'A guest' : clipped;
}

/** The spaces the order takes: items that use a space, counted by quantity. */
export function partyLabel(items: BookingEmailSource['items']): string {
  return guestsLabel(
    items.reduce((sum, item) => sum + (item.usesSpace ? item.quantity : 0), 0),
  );
}

/**
 * The cancellation terms as they stood when the booking was confirmed, so a retry days later
 * reads the same. A deadline that had already passed at confirmation says so.
 */
export function cancellationTermsLabel(
  freeCancelUntil: Date | null,
  confirmedAt: Date,
  timeZone: string,
  deadlineLabel: (
    instant: Date,
    timeZone: string,
  ) => string = zonedDeadlineLabel,
): string {
  if (freeCancelUntil === null) {
    return 'The cancellation terms are on your booking page.';
  }
  return confirmedAt.getTime() <= freeCancelUntil.getTime()
    ? `Free cancellation until ${deadlineLabel(freeCancelUntil, timeZone)}.`
    : 'The free cancellation window has closed, so a cancellation now is not refunded.';
}

function requireConfirmedAt(source: BookingEmailSource): Date {
  if (source.confirmedAt === null) {
    throw new RangeError('A confirmation is sent for a confirmed order');
  }
  return source.confirmedAt;
}

function absolute(path: string, appUrl: string): string {
  return new URL(path, appUrl).toString();
}

const meetingPointMax = 600;
const nameOfExperienceMax = 200;
const calendarLocationMax = 300;

/** The event a booking adds to a calendar. Its UID is the order, so a second copy updates the first. */
export function bookingCalendarEvent(
  source: BookingEmailSource,
  appUrl: string,
): CalendarEvent {
  return {
    uid: `${source.orderId}@${new URL(appUrl).hostname}`,
    startsAt: source.startsAt,
    endsAt: source.endsAt,
    stampedAt: requireConfirmedAt(source),
    summary: oneLineClipped(source.experienceName, nameOfExperienceMax),
    location:
      source.meetingPoint === null
        ? null
        : oneLineClipped(source.meetingPoint, calendarLocationMax) || null,
    description: `Booking ${source.reference} with ${oneLineClipped(source.hostName, nameMax)}.`,
  };
}

/**
 * The link to the manage page. The token must have the shape of a capability token: anything else
 * is a bug in the caller, and a malformed link must never be sent.
 */
export function manageLink(token: string, appUrl: string): string {
  if (!isCapabilityTokenShape(token)) {
    throw new RangeError('That is not a capability token');
  }
  return absolute(managePath(token), appUrl);
}

export function guestConfirmationData(
  source: BookingEmailSource,
  input: { appUrl: string; manageToken: string },
): GuestConfirmationData {
  const confirmedAt = requireConfirmedAt(source);
  const amounts = orderSummaryAmounts({
    lines: source.items.map((item) => ({
      label: `${item.label} x ${String(item.quantity)}`,
      amountMinor: item.lineTotalMinor,
    })),
    taxTreatment: source.taxTreatment,
    taxMinor: source.taxMinor,
    totalMinor: source.totalMinor,
  });
  const event = bookingCalendarEvent(source, input.appUrl);
  const paidWithGift = source.giftAppliedMinor > 0;
  return {
    recipientName: greetingName(source.leadGuestName),
    reference: source.reference,
    experienceName: oneLineClipped(source.experienceName, nameOfExperienceMax),
    hostName: oneLineClipped(source.hostName, nameMax),
    dayLabel: zonedDayLabel(source.startsAt, source.timeZone),
    timeLabel: zonedTimeLabel(source.startsAt, source.timeZone),
    durationLabel:
      source.durationMinutes === null
        ? null
        : durationLabel(source.durationMinutes),
    meetingPoint:
      source.meetingPoint === null
        ? null
        : oneLineClipped(source.meetingPoint, meetingPointMax) || null,
    partyLabel: partyLabel(source.items),
    lines: amounts.lines,
    taxLine: amounts.tax,
    total: amounts.total,
    giftApplied: paidWithGift ? formatMoney(source.giftAppliedMinor) : null,
    charged: paidWithGift ? formatMoney(source.amountDueMinor) : null,
    cancellationTerms: cancellationTermsLabel(
      source.freeCancelUntil,
      confirmedAt,
      source.timeZone,
    ),
    manageUrl: manageLink(input.manageToken, input.appUrl),
    calendarUrl: googleCalendarUrl(event),
    calendar: {
      uid: event.uid,
      startsAt: event.startsAt.toISOString(),
      endsAt: event.endsAt.toISOString(),
      stampedAt: event.stampedAt.toISOString(),
      summary: event.summary,
      location: event.location,
      description: event.description,
    },
  };
}

export function hostBookingNoticeData(
  source: BookingEmailSource,
): HostBookingNoticeData {
  return {
    hostName: oneLineClipped(source.hostName, nameMax),
    reference: source.reference,
    experienceName: oneLineClipped(source.experienceName, nameOfExperienceMax),
    dayLabel: zonedDayLabel(source.startsAt, source.timeZone),
    timeLabel: zonedTimeLabel(source.startsAt, source.timeZone),
    guestName: guestNameForHost(source.leadGuestName),
    partyLabel: partyLabel(source.items),
  };
}

type Audience = BookingCancellationData['audience'];

const cancellationReasons: Record<Audience, Record<CancelledBy, string>> = {
  guest: {
    guest: 'You cancelled this booking.',
    host: 'The host cancelled this session.',
    weather: 'This session was cancelled because of the weather.',
    ramble: 'Ramble cancelled this session.',
  },
  host: {
    guest: 'The guest cancelled this booking.',
    host: 'You cancelled this session.',
    weather: 'This session was cancelled because of the weather.',
    ramble: 'Ramble cancelled this session.',
  },
};

/** One line saying who cancelled and why, worded for the person reading it. */
export function cancellationReasonLine(
  audience: Audience,
  cancelledBy: CancelledBy,
): string {
  return cancellationReasons[audience][cancelledBy];
}

/** What a guest is told about money when a booking is cancelled. */
export function cancellationRefundLine(refundMinor: number): string {
  return refundMinor > 0
    ? `Your refund of ${formatMoney(refundMinor)} goes back to your original payment method.`
    : 'No refund is due under the cancellation terms.';
}

type CancellationInput = {
  audience: Audience;
  recipientName: string | null;
  reference: string;
  experienceName: string;
  startsAt: Date;
  timeZone: string;
  items: BookingEmailSource['items'];
  cancelledBy: CancelledBy;
  /** What the guest gets back; read only for a guest's email. */
  refundMinor: number;
  /** Where to find other dates, for a cancellation the guest did not choose. */
  otherDatesPath: string | null;
  appUrl: string;
};

// TODO(U-055): first caller, the cancellation email job.
export function bookingCancellationData(
  input: CancellationInput,
): BookingCancellationData {
  const byGuest = input.cancelledBy === 'guest';
  return {
    audience: input.audience,
    recipientName: greetingName(input.recipientName),
    reference: input.reference,
    experienceName: oneLineClipped(input.experienceName, nameOfExperienceMax),
    dayLabel: zonedDayLabel(input.startsAt, input.timeZone),
    timeLabel: zonedTimeLabel(input.startsAt, input.timeZone),
    partyLabel: partyLabel(input.items),
    reasonLine: cancellationReasonLine(input.audience, input.cancelledBy),
    refundLine:
      input.audience === 'guest'
        ? cancellationRefundLine(input.refundMinor)
        : null,
    otherDatesUrl:
      input.audience === 'guest' && !byGuest && input.otherDatesPath !== null
        ? absolute(input.otherDatesPath, input.appUrl)
        : null,
  };
}

/** When a refund shows up, said once for every refund email. */
export const refundArrivalLine =
  'Your bank usually shows it within 5 to 10 business days.';

// TODO(U-056): first caller, the refund email job.
export function bookingRefundData(input: {
  recipientName: string | null;
  reference: string;
  experienceName: string;
  refundMinor: number;
}): BookingRefundData {
  return {
    recipientName: greetingName(input.recipientName),
    reference: input.reference,
    experienceName: oneLineClipped(input.experienceName, nameOfExperienceMax),
    amount: formatMoney(input.refundMinor),
    arrivalLine: refundArrivalLine,
  };
}

export type LapseReason = 'sold_out_after_lapse' | 'session_cancelled';

const lapseReasons: Record<LapseReason, string> = {
  sold_out_after_lapse:
    'Your hold ran out before your payment went through, and the spaces were taken.',
  session_cancelled:
    'The session was cancelled before your payment went through.',
};

/** Why a payment that arrived late was refunded (S10). */
export function lapseReasonLine(reason: LapseReason): string {
  return lapseReasons[reason];
}

// TODO(U-109): first caller, the refund path.
export function paidAfterLapseData(input: {
  recipientName: string | null;
  reference: string;
  experienceName: string;
  startsAt: Date;
  timeZone: string;
  amountMinor: number;
  reason: LapseReason;
  appUrl: string;
}): PaidAfterLapseData {
  return {
    recipientName: greetingName(input.recipientName),
    reference: input.reference,
    experienceName: oneLineClipped(input.experienceName, nameOfExperienceMax),
    dayLabel: zonedDayLabel(input.startsAt, input.timeZone),
    timeLabel: zonedTimeLabel(input.startsAt, input.timeZone),
    amount: formatMoney(input.amountMinor),
    reasonLine: lapseReasonLine(input.reason),
    browseUrl: absolute(browsePath, input.appUrl),
  };
}
