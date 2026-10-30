import {
  bookingCalendarEvent,
  greetingName,
  guestConfirmationData,
  type BookingEmailSource,
} from './bookingEmails';
import { calendarFilename } from './email/bookingTemplates';
import { buildIcs } from './ics';
import { orderStatusState, type OrderStatusState } from './orderStatus';
import { browsePath, managePath } from './routes';
import { oneLineClipped } from './text';

// What the confirmation page says for an order in each state. The receipt reuses the booking
// email's data, so the page and the email never disagree about the date, the party, or the total.

type ReceiptLine = { label: string; amount: string };

export type OrderReceipt = {
  heading: string;
  reference: string;
  experienceName: string;
  hostName: string;
  dayLabel: string;
  timeLabel: string;
  durationLabel: string | null;
  meetingPoint: string | null;
  partyLabel: string;
  lines: ReceiptLine[];
  taxLine: ReceiptLine | null;
  total: string;
  giftApplied: string | null;
  charged: string | null;
  cancellationTerms: string;
  sellerOfRecord: string;
  calendarUrl: string;
  /** The same event as a `.ics` file, as a data link the browser saves, so no download route is needed. */
  icsHref: string;
  icsFileName: string;
  mapsUrl: string | null;
  manageHref: string;
};

type OrderNotice = {
  tone: 'info' | 'warning' | 'danger';
  title: string;
  body: string;
  /** Where the one action goes; null when there is nothing for the guest to do here. */
  action: { label: string; href: string } | null;
};

export type OrderPageView =
  | { kind: 'confirmed'; receipt: OrderReceipt }
  | { kind: 'pending'; reference: string; experienceName: string }
  | { kind: 'notice'; reference: string; notice: OrderNotice };

/**
 * Ramble collects the payment as the host's agent and the host is the seller (PRD Q-01, option c;
 * ADR 0003), so the receipt says so in the guest's words.
 */
export function sellerOfRecordLine(hostName: string): string {
  return `${oneLineClipped(hostName, 120)} is the seller of this experience. Ramble collected your payment as ${oneLineClipped(hostName, 120)}'s agent.`;
}

/** "You're booked, Alex": the first word of the name, or no name when there is none. */
export function confirmationHeading(leadGuestName: string | null): string {
  const name = greetingName(leadGuestName);
  return name === 'there'
    ? "You're booked"
    : `You're booked, ${name.split(' ')[0] ?? name}`;
}

/** A map search for the meeting point, which opens the guest's maps app on a phone. */
export function mapsSearchUrl(meetingPoint: string | null): string | null {
  const text = oneLineClipped(meetingPoint ?? '', 300);
  if (text === '') return null;
  const url = new URL('https://www.google.com/maps/search/');
  url.searchParams.set('api', '1');
  url.searchParams.set('query', text);
  return url.toString();
}

function icsDataHref(ics: string): string {
  return `data:text/calendar;charset=utf-8,${encodeURIComponent(ics)}`;
}

const notices = {
  failed: {
    tone: 'danger',
    title: "Your payment didn't go through",
    body: 'Nothing was charged and no spaces are booked.',
    action: { label: 'Browse experiences', href: browsePath },
  },
  refunded_after_lapse: {
    tone: 'warning',
    title: "We couldn't keep your spaces, so we refunded you",
    body: 'Your payment arrived after the hold ended and the spaces were gone. The full amount is on its way back to your card.',
    action: { label: 'Find another date', href: browsePath },
  },
  closed: {
    tone: 'info',
    title: 'This booking is no longer active',
    body: 'It was cancelled or never completed, so there is nothing to add to a calendar.',
    action: { label: 'Browse experiences', href: browsePath },
  },
} satisfies Record<
  Exclude<OrderStatusState, 'pending' | 'confirmed'>,
  OrderNotice
>;

/**
 * The page for an order. The manage link and the calendar file exist only for a confirmed order,
 * so a pending or failed one cannot offer a link to a booking that is not there. `manageToken` is
 * the order's `manage` capability token, made by the server for this order.
 */
export function orderPageView(
  source: BookingEmailSource,
  input: { manageToken: string; appUrl: string },
): OrderPageView {
  const state = orderStatusState(source.status);
  if (state === 'pending') {
    return {
      kind: 'pending',
      reference: source.reference,
      experienceName: oneLineClipped(source.experienceName, 200),
    };
  }
  if (state !== 'confirmed') {
    return {
      kind: 'notice',
      reference: source.reference,
      notice: notices[state],
    };
  }
  const data = guestConfirmationData(source, {
    appUrl: input.appUrl,
    manageToken: input.manageToken,
  });
  return {
    kind: 'confirmed',
    receipt: {
      heading: confirmationHeading(source.leadGuestName),
      reference: data.reference,
      experienceName: data.experienceName,
      hostName: data.hostName,
      dayLabel: data.dayLabel,
      timeLabel: data.timeLabel,
      durationLabel: data.durationLabel,
      meetingPoint: data.meetingPoint,
      partyLabel: data.partyLabel,
      lines: data.lines,
      taxLine: data.taxLine,
      total: data.total,
      giftApplied: data.giftApplied,
      charged: data.charged,
      cancellationTerms: data.cancellationTerms,
      sellerOfRecord: sellerOfRecordLine(data.hostName),
      calendarUrl: data.calendarUrl,
      icsHref: icsDataHref(
        buildIcs(bookingCalendarEvent(source, input.appUrl)),
      ),
      icsFileName: calendarFilename,
      mapsUrl: mapsSearchUrl(source.meetingPoint),
      manageHref: managePath(input.manageToken),
    },
  };
}
