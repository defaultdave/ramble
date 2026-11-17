import { describe, expect, it } from 'vitest';
import { emailAddressPattern } from '@/lib/email/address';
import { isOrderReference } from '@/lib/orders';
import { reviewEligibility, reviewLimits, reviewWindowMs } from '@/lib/reviews';
import { curated } from './fixtures';
import { reviewFixtures } from './fixtures/reviews';
import { personas } from './personas';
import { pickSeedPrice, reviewSeedRows } from './reviews';
import { experienceId } from './rows';

// Behaviours under test, one per decision, branch, or risk.
// the fixtures
// - at least five reviews, on at least four experiences, and every review is a rating in range with a body inside the limit
// - every fixture names a live curated experience and a valid address on the reserved .test domain; keys are unique
// - the guest persona has at least two finished sessions with no review, so there is something to write
// - every session is old enough to be invited and young enough to be inside the review window
// the rows
// - a session ends before the seed's day began, after a fixed hour in UTC, so a rerun on the same day writes the same row
// - the booking is confirmed, for the seats it names, with money that adds up and a commission at the standing rate
// - the hold is converted, scrubbed of device data, and expires ten minutes after it was made, before the session
// - a booking with a review is not eligible again; one without is, at the seed's clock
// - the review is written after the session ended and not after the seed ran, for the order's own experience
// - ids and references come from the key alone, so a rerun is the same rows
// - references have the shape an order reference has, no two fixtures share one, and one is the same on every run
// - the price a fixture books on is the first of its experience's prices, or none when it has none

const now = new Date('2026-11-17T09:30:00Z');
const price = {
  id: 'b0000000-0000-4000-8000-000000000001',
  kind: 'adult' as const,
  priceMinor: 8500,
  usesSpace: true,
};

describe('the review fixtures', () => {
  const reviewed = reviewFixtures.filter((fixture) => fixture.review !== null);

  it('has at least five reviews on at least four experiences', () => {
    expect(reviewed.length).toBeGreaterThanOrEqual(5);
    expect(
      new Set(reviewed.map((f) => f.experienceSlug)).size,
    ).toBeGreaterThanOrEqual(4);
  });

  it('keeps every rating and body inside the limits', () => {
    for (const { review } of reviewed) {
      expect(review).not.toBeNull();
      expect(review?.rating).toBeGreaterThanOrEqual(reviewLimits.minRating);
      expect(review?.rating).toBeLessThanOrEqual(reviewLimits.maxRating);
      expect(review?.body.trim().length).toBeGreaterThan(0);
      expect(review?.body.length).toBeLessThanOrEqual(
        reviewLimits.bodyMaxChars,
      );
    }
  });

  it('names live curated experiences and valid reserved-domain addresses, with unique keys', () => {
    const live = new Set(
      curated.experiences
        .filter((experience) => experience.status === 'live')
        .map((experience) => experience.slug),
    );
    for (const fixture of reviewFixtures) {
      expect(live.has(fixture.experienceSlug)).toBe(true);
      expect(fixture.bookerEmail).toMatch(new RegExp(emailAddressPattern));
      expect(fixture.bookerEmail.endsWith('.test')).toBe(true);
    }
    const keys = reviewFixtures.map((fixture) => fixture.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('leaves the guest persona at least two finished sessions to review', () => {
    const waiting = reviewFixtures.filter(
      (fixture) =>
        fixture.bookerEmail === personas.guest.email && fixture.review === null,
    );
    expect(waiting.length).toBeGreaterThanOrEqual(2);
  });

  it('puts every session where it can be invited and still reviewed', () => {
    for (const fixture of reviewFixtures) {
      const { session } = reviewSeedRows(fixture, price, now);
      expect(
        reviewEligibility(
          {
            kind: 'booking',
            status: 'confirmed',
            refundedTicketMinor: 0,
            refundedTaxMinor: 0,
            endsAt: session.endsAt,
            reviewed: false,
          },
          now,
        ),
      ).toEqual({ ok: true });
      expect(now.getTime() - session.endsAt.getTime()).toBeLessThan(
        reviewWindowMs,
      );
    }
  });

  it('gives every fixture its own order reference, in the shape of one', () => {
    const references = reviewFixtures.map(
      (fixture) => reviewSeedRows(fixture, price, now).order.reference,
    );
    expect(new Set(references).size).toBe(references.length);
    for (const reference of references) {
      expect(isOrderReference(reference)).toBe(true);
    }
  });
});

describe('reviewSeedRows', () => {
  const fixture = reviewFixtures[0];
  if (!fixture) throw new Error('no fixtures');

  it('starts the session at a fixed hour on a day counted back from the seed day, so a rerun that day is the same row', () => {
    const { session } = reviewSeedRows(fixture, price, now);
    const later = reviewSeedRows(
      fixture,
      price,
      new Date('2026-11-17T23:59:59Z'),
    );
    expect(session.startsAt).toEqual(new Date('2026-11-08T22:00:00Z'));
    expect(session.endsAt).toEqual(new Date('2026-11-09T00:00:00Z'));
    expect(later.session).toEqual(session);
  });

  it('writes a confirmed booking for the seats it names, with money that adds up at the standing commission', () => {
    const { order, orderItem, session } = reviewSeedRows(fixture, price, now);
    expect(order).toMatchObject({
      kind: 'booking',
      status: 'confirmed',
      contactEmail: fixture.bookerEmail,
      ticketSubtotalMinor: 8500 * fixture.seats,
      taxMinor: 0,
      totalMinor: 8500 * fixture.seats,
      amountDueMinor: 8500 * fixture.seats,
      commissionRateBps: 1500,
      commissionMinor: Math.round((8500 * fixture.seats * 1500) / 10_000),
    });
    expect(orderItem).toMatchObject({
      quantity: fixture.seats,
      label: 'Adult',
      lineTotalMinor: 8500 * fixture.seats,
    });
    expect(session.seatsSold).toBe(fixture.seats);
    expect(order.confirmedAt.getTime()).toBeGreaterThanOrEqual(
      order.createdAt.getTime(),
    );
  });

  it('converts the hold, scrubs its device data, and expires it ten minutes after it was made and before the session', () => {
    const { hold, order, session } = reviewSeedRows(fixture, price, now);
    expect(hold.status).toBe('converted');
    expect(hold.deviceKey).toBe('0'.repeat(64));
    expect(hold.ipHash).toBe('0'.repeat(64));
    expect(hold.expiresAt.getTime() - hold.createdAt.getTime()).toBe(600_000);
    expect(hold.expiresAt.getTime()).toBeLessThan(session.startsAt.getTime());
    expect(order.idempotencyKey).toBe(`book:${hold.id}`);
    expect(order.holdId).toBe(hold.id);
  });

  it('writes a review after the session ended and not after the seed ran, for the order and its experience', () => {
    const { review, order, session } = reviewSeedRows(fixture, price, now);
    expect(review).not.toBeNull();
    expect(review?.orderId).toBe(order.id);
    expect(review?.experienceId).toBe(experienceId(fixture.experienceSlug));
    expect(review?.createdAt.getTime()).toBeGreaterThan(
      session.endsAt.getTime(),
    );
    expect(review?.createdAt.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it('writes no review for a finished session that is waiting for one', () => {
    const waiting = reviewFixtures.find((f) => f.review === null);
    if (!waiting) throw new Error('no waiting fixture');
    expect(reviewSeedRows(waiting, price, now).review).toBeNull();
  });

  it('takes every id and the reference from the key alone', () => {
    const a = reviewSeedRows(fixture, price, now);
    const b = reviewSeedRows(fixture, { ...price, priceMinor: 100 }, now);
    expect(b.order.id).toBe(a.order.id);
    expect(b.order.reference).toBe(a.order.reference);
    expect(b.hold.id).toBe(a.hold.id);
    expect(b.session.id).toBe(a.session.id);
    const other = reviewFixtures[1];
    if (!other) throw new Error('no second fixture');
    expect(reviewSeedRows(other, price, now).order.id).not.toBe(a.order.id);
  });
});

describe('the seeded order reference', () => {
  it('is the same value on every run, so a rerun writes the same order', () => {
    const fixture = reviewFixtures[0];
    if (!fixture) throw new Error('no fixtures');
    expect(reviewSeedRows(fixture, price, now).order.reference).toBe(
      'RMB-CYGQF7',
    );
    expect(
      reviewSeedRows(fixture, price, new Date('2026-12-01T00:00:00Z')).order
        .reference,
    ).toBe('RMB-CYGQF7');
  });
});

describe('pickSeedPrice', () => {
  const prices = [
    { ...price, id: 'p1', experienceId: 'e1' },
    { ...price, id: 'p2', experienceId: 'e2' },
    { ...price, id: 'p3', experienceId: 'e2' },
  ];

  it.each([
    ['the first price of the experience', 'e2', 'p2'],
    ['the only price of another', 'e1', 'p1'],
  ])('picks %s', (_name, experience, expected) => {
    expect(pickSeedPrice(prices, experience)?.id).toBe(expected);
  });

  it('picks nothing for an experience with no price', () => {
    expect(pickSeedPrice(prices, 'e9')).toBeUndefined();
  });
});
