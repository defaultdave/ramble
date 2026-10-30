import { cancellationTermsLabel } from '../bookingEmails';
import type { taxTreatments } from '../catalog';
import { cancellationWindow } from '../cancellation';
import {
  childCount,
  priceHold,
  type AgeSubject,
  type HeldItem,
} from '../checkout';
import { formatPrice } from '../money';
import {
  holdDeadline,
  isCheckoutHold,
  isHoldOfDevice,
  type HoldTimes,
} from '../holds';
import { legalDocPath } from '../routes';
import {
  zonedClockLabel,
  zonedDeadlineNoZoneLabel,
  zonedShortDayLabel,
} from '../zonedLabels';

// What the checkout page shows for one hold, and the rules that decide what it asks for. The data
// layer reads rows; everything it shows or asks is decided here.

/** The line under the first child's age box: the ages the form takes. */
export function ageRangeHint(range: { min: number; max: number }): string {
  return `Ages ${String(range.min)} to ${String(range.max)}.`;
}

type PublishedDocument = { id: string; doc: string };

export type CheckoutSource = {
  hold: HoldTimes & {
    id: string;
    sessionId: string;
    deviceKey: string;
    seats: number;
    purpose: 'booking' | 'gift_redemption';
  };
  session: { id: string; startsAt: Date; timeZone: string };
  experience: {
    id: string;
    slug: string;
    title: string;
    meetingPoint: string | null;
    neighborhoodName: string;
    hostName: string;
    taxTreatment: (typeof taxTreatments)[number];
    waiverRequired: boolean;
    cancellationHoursBefore: number;
  } & AgeSubject;
  items: readonly HeldItem[];
  taxRatePpm: number;
  holdMinutes: number;
  terms: PublishedDocument | null;
  waiver: PublishedDocument | null;
  /** The database clock. */
  at: Date;
};

type SummaryLine = { label: string; amountMinor: number };

/** What the page needs, as plain values that cross to the browser. */
export type CheckoutView = {
  holdId: string;
  sessionId: string;
  experience: { id: string; slug: string; title: string; hostName: string };
  /** The deadline as an ISO instant, and the database clock it was read against. */
  expiresAt: string;
  serverNow: string;
  /** How long a hold lasts, for "We released your spaces after 10 minutes". */
  holdMinutes: number;
  startsAt: string;
  timeZone: string;
  dateLabel: string;
  timeLabel: string;
  guests: number;
  where: string;
  lines: SummaryLine[];
  taxTreatment: (typeof taxTreatments)[number];
  taxMinor: number;
  totalMinor: number;
  cancellationLine: string;
  ageSubject: AgeSubject;
  children: number;
  /** The held lines by option, which a new hold for the same party repeats. */
  party: { priceOptionId: string; quantity: number }[];
  termsDocument: { id: string; href: string };
  waiverDocument: { id: string; href: string } | null;
};

export type CheckoutRead = { status: 'ok'; view: CheckoutView } | null;

/** How one price line reads in the summary: "$65 × 2 guests". */
export function lineLabel(
  item: Pick<HeldItem, 'kind' | 'quantity' | 'unitPriceMinor'>,
  mixedParty: boolean,
): string {
  const { kind, quantity } = item;
  let noun: string;
  if (!mixedParty) noun = quantity === 1 ? 'guest' : 'guests';
  else if (kind === 'child') noun = quantity === 1 ? 'child' : 'children';
  else noun = quantity === 1 ? 'adult' : 'adults';
  return `${formatPrice(item.unitPriceMinor)} × ${String(quantity)} ${noun}`;
}

/** The cancellation line under the total (PRD-10), from the deadline for this session. */
export function cancellationLine(
  hoursBefore: number,
  startsAt: Date,
  now: Date,
  zone: string,
): string {
  const window = cancellationWindow(
    { fullRefundHoursBefore: hoursBefore },
    startsAt,
    now,
    zone,
  );
  return cancellationTermsLabel(
    window.freeCancelUntil,
    now,
    zone,
    zonedDeadlineNoZoneLabel,
  );
}

/**
 * The page for a hold, or null when it is not the caller's, is not a booking, or is gone: all
 * three read the same, so a guessed id learns nothing (design doc 4.2.3). A published document the
 * page must show but cannot find is an error, not a page that skips the acceptance.
 */
export function buildCheckoutView(
  source: CheckoutSource,
  deviceKey: string,
): CheckoutRead {
  const { hold, session, experience, items, at } = source;
  if (
    !isHoldOfDevice(hold, deviceKey) ||
    hold.purpose !== 'booking' ||
    !isCheckoutHold(hold)
  ) {
    return null;
  }
  if (source.terms === null) {
    throw new Error('There is no published version of the terms');
  }
  if (experience.waiverRequired && source.waiver === null) {
    throw new Error('The experience needs a waiver that is not published');
  }
  const priced = priceHold(items, experience.taxTreatment, source.taxRatePpm);
  const children = childCount(items);
  const mixedParty =
    children > 0 && items.some((item) => item.kind === 'adult');
  return {
    status: 'ok',
    view: {
      holdId: hold.id,
      sessionId: session.id,
      experience: {
        id: experience.id,
        slug: experience.slug,
        title: experience.title,
        hostName: experience.hostName,
      },
      expiresAt: holdDeadline(hold).toISOString(),
      serverNow: at.toISOString(),
      holdMinutes: source.holdMinutes,
      startsAt: session.startsAt.toISOString(),
      timeZone: session.timeZone,
      dateLabel: zonedShortDayLabel(session.startsAt, session.timeZone),
      timeLabel: zonedClockLabel(session.startsAt, session.timeZone),
      guests: hold.seats,
      where: experience.meetingPoint ?? experience.neighborhoodName,
      lines: priced.lines.map((line) => ({
        label: lineLabel(line, mixedParty),
        amountMinor: line.lineTotalMinor,
      })),
      taxTreatment: experience.taxTreatment,
      taxMinor: priced.taxMinor,
      totalMinor: priced.totalMinor,
      cancellationLine: cancellationLine(
        experience.cancellationHoursBefore,
        session.startsAt,
        at,
        session.timeZone,
      ),
      ageSubject: {
        ageRule: experience.ageRule,
        minAge: experience.minAge,
        maxAge: experience.maxAge,
      },
      children,
      party: items.map(({ priceOptionId, quantity }) => ({
        priceOptionId,
        quantity,
      })),
      termsDocument: {
        id: source.terms.id,
        href: legalDocPath(source.terms.doc),
      },
      waiverDocument: source.waiver
        ? { id: source.waiver.id, href: legalDocPath(source.waiver.doc) }
        : null,
    },
  };
}
