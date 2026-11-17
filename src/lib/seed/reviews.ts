import { commissionMinor, defaultCommissionRateBps } from '../pricing';
import { newOrderReference } from '../checkout';
import { priceKindLabel, type priceKinds } from '../catalog';
import { holdExpiresAt, scrubbedHash } from '../holds';
import { msPerDay, msPerHour, msPerMinute } from '../time';
import { venueTimeZone } from '../venue';
import { experienceId } from './rows';
import { seedId } from './ids';

// The past bookings and reviews the seed writes so the review flow has something to show and the
// guest persona has finished sessions to review. Everything here is a plain function of the fixture
// and the clock: the seed's writer only inserts what these return.

export type ReviewFixture = {
  /** Names the rows: the ids come from it, so a rerun writes the same ones. */
  key: string;
  experienceSlug: string;
  bookerEmail: string;
  bookerName: string;
  /** Whole days before the seed's day that the session took place; at least 1. */
  daysAgo: number;
  seats: number;
  /** The review the booker left, or null for a finished session still waiting for one. */
  review: { rating: number; body: string } | null;
};

/** The price option a booking is made on: the experience's own, read by the writer. */
export type ReviewSeedPrice = {
  id: string;
  kind: (typeof priceKinds)[number];
  priceMinor: number;
  usesSpace: boolean;
};

const sessionHourUtc = 22;
const sessionHours = 2;
const sessionAllocation = 12;
const reviewLagDays = 1;
const bookedDaysBefore = 5;
const holdMinutes = 10;

const dayStartUtc = (now: Date) =>
  Math.floor(now.getTime() / msPerDay) * msPerDay;

/** What the price pick reads of each price: which experience it belongs to, with what a booking is made on. */
export type ReviewSeedPriceRow = ReviewSeedPrice & { experienceId: string };

/** The first price of an experience, in the order given, which is the order the writer reads them in. */
export function pickSeedPrice(
  prices: readonly ReviewSeedPriceRow[],
  experienceId: string,
): ReviewSeedPriceRow | undefined {
  return prices.find((price) => price.experienceId === experienceId);
}

/** `RMB-` and six Crockford characters taken from the key, so the same fixture always gets the same reference. */
function seedOrderReference(key: string): string {
  const digits = seedId('order-reference', key).replaceAll('-', '');
  let position = 0;
  return newOrderReference((exclusiveMax) => {
    const pair = digits.slice(position * 2, position * 2 + 2);
    position += 1;
    return parseInt(pair, 16) % exclusiveMax;
  });
}

export function reviewSeedRows(
  fixture: ReviewFixture,
  price: ReviewSeedPrice,
  now: Date,
) {
  const startsAt = new Date(
    dayStartUtc(now) - fixture.daysAgo * msPerDay + sessionHourUtc * msPerHour,
  );
  const endsAt = new Date(startsAt.getTime() + sessionHours * msPerHour);
  const holdCreatedAt = new Date(
    startsAt.getTime() - bookedDaysBefore * msPerDay,
  );
  const confirmedAt = new Date(holdCreatedAt.getTime() + 5 * msPerMinute);
  const subtotal = price.priceMinor * fixture.seats;
  const commission = commissionMinor(subtotal, defaultCommissionRateBps);
  const sessionId = seedId('review-session', fixture.key);
  const holdId = seedId('review-hold', fixture.key);
  const orderId = seedId('review-order', fixture.key);
  return {
    session: {
      id: sessionId,
      startsAt,
      endsAt,
      timeZone: venueTimeZone,
      allocation: sessionAllocation,
      seatsSold: fixture.seats,
      source: 'ramble' as const,
    },
    hold: {
      id: holdId,
      sessionId,
      purpose: 'booking' as const,
      status: 'converted' as const,
      seats: fixture.seats,
      deviceKey: scrubbedHash,
      ipHash: scrubbedHash,
      createdAt: holdCreatedAt,
      updatedAt: confirmedAt,
      expiresAt: holdExpiresAt(holdCreatedAt, holdMinutes),
    },
    holdItem: {
      holdId,
      priceOptionId: price.id,
      quantity: fixture.seats,
      unitPriceMinor: price.priceMinor,
      usesSpace: price.usesSpace,
    },
    order: {
      id: orderId,
      reference: seedOrderReference(fixture.key),
      kind: 'booking' as const,
      status: 'confirmed' as const,
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId,
      experienceId: experienceId(fixture.experienceSlug),
      contactEmail: fixture.bookerEmail,
      leadGuestName: fixture.bookerName,
      taxTreatment: 'not_taxable' as const,
      taxRatePpm: 0,
      taxMinor: 0,
      ticketSubtotalMinor: subtotal,
      totalMinor: subtotal,
      amountDueMinor: subtotal,
      commissionRateBps: defaultCommissionRateBps,
      commissionMinor: commission,
      createdAt: holdCreatedAt,
      confirmedAt,
    },
    orderItem: {
      orderId,
      priceOptionId: price.id,
      label: priceKindLabel(price.kind),
      quantity: fixture.seats,
      unitPriceMinor: price.priceMinor,
      usesSpace: price.usesSpace,
      lineTotalMinor: subtotal,
    },
    review:
      fixture.review === null
        ? null
        : {
            id: seedId('review', fixture.key),
            orderId,
            experienceId: experienceId(fixture.experienceSlug),
            rating: fixture.review.rating,
            body: fixture.review.body,
            createdAt: new Date(endsAt.getTime() + reviewLagDays * msPerDay),
            updatedAt: new Date(endsAt.getTime() + reviewLagDays * msPerDay),
          },
  };
}
