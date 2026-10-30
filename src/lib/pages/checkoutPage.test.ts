import { describe, expect, it } from 'vitest';
import type { HeldItem } from '../checkout';
import {
  ageRangeHint,
  buildCheckoutView,
  cancellationLine,
  lineLabel,
  type CheckoutSource,
} from './checkoutPage';

// Behaviours under test:
// - lineLabel and cancellationLine: the summary words, a lapsed free window
// - buildCheckoutView: refuses another device's, a gift's and a gone hold alike; throws on a missing
//   document; prices the hold and words the summary

const at = new Date('2026-10-23T14:00:00Z');
const startsAt = new Date('2026-10-24T21:30:00Z');

const adult: HeldItem = {
  priceOptionId: 'a',
  kind: 'adult',
  quantity: 2,
  unitPriceMinor: 6500,
  usesSpace: true,
};
const child: HeldItem = {
  priceOptionId: 'c',
  kind: 'child',
  quantity: 1,
  unitPriceMinor: 3000,
  usesSpace: true,
};

function source(overrides: Partial<CheckoutSource> = {}): CheckoutSource {
  return {
    hold: {
      id: 'h1',
      sessionId: 's1',
      deviceKey: 'device-a',
      seats: 2,
      purpose: 'booking',
      status: 'active',
      expiresAt: new Date('2026-10-23T14:10:00Z'),
      payingUntil: null,
    },
    session: { id: 's1', startsAt, timeZone: 'America/New_York' },
    experience: {
      id: 'e1',
      slug: 'sunset-kayak',
      title: 'Sunset kayak on the Hudson',
      meetingPoint: 'Pier 26 boathouse, Tribeca.',
      neighborhoodName: 'Tribeca',
      hostName: 'Hudson Paddle Club',
      taxTreatment: 'not_taxable',
      waiverRequired: true,
      cancellationHoursBefore: 24,
      ageRule: 'minimum_age',
      minAge: 14,
      maxAge: null,
    },
    items: [adult],
    taxRatePpm: 88_750,
    holdMinutes: 10,
    terms: { id: 't1', doc: 'terms' },
    waiver: { id: 'w1', doc: 'waiver-hudson' },
    at,
    ...overrides,
  };
}

describe('ageRangeHint', () => {
  it('names the ages the form takes', () => {
    expect(ageRangeHint({ min: 6, max: 12 })).toBe('Ages 6 to 12.');
  });
});

describe('summary words', () => {
  it.each([
    [
      { kind: 'adult', quantity: 2, unitPriceMinor: 6500 },
      false,
      '$65 × 2 guests',
    ],
    [
      { kind: 'adult', quantity: 1, unitPriceMinor: 6500 },
      false,
      '$65 × 1 guest',
    ],
    [
      { kind: 'adult', quantity: 2, unitPriceMinor: 6500 },
      true,
      '$65 × 2 adults',
    ],
    [
      { kind: 'child', quantity: 1, unitPriceMinor: 3050 },
      true,
      '$30.50 × 1 child',
    ],
    [
      { kind: 'child', quantity: 3, unitPriceMinor: 0 },
      true,
      '$0 × 3 children',
    ],
  ] as const)('words %j (mixed %s) as %s', (item, mixed, label) => {
    expect(lineLabel(item, mixed)).toBe(label);
  });

  it('names the free-cancellation deadline in the session zone', () => {
    expect(cancellationLine(24, startsAt, at, 'America/New_York')).toBe(
      'Free cancellation until Fri, Oct 23, 5:30 PM.',
    );
  });

  it('says there is no refund once the window has passed', () => {
    expect(
      cancellationLine(
        24,
        startsAt,
        new Date('2026-10-24T20:00:00Z'),
        'America/New_York',
      ),
    ).toMatch(/^The free cancellation window has closed/);
  });
});

describe('buildCheckoutView', () => {
  it('words the page for the hold of the calling device', () => {
    const read = buildCheckoutView(source(), 'device-a');
    expect(read?.view).toMatchObject({
      holdId: 'h1',
      dateLabel: 'Sat, Oct 24',
      timeLabel: '5:30 PM',
      guests: 2,
      where: 'Pier 26 boathouse, Tribeca.',
      lines: [{ label: '$65 × 2 guests', amountMinor: 13_000 }],
      taxMinor: 0,
      totalMinor: 13_000,
      expiresAt: '2026-10-23T14:10:00.000Z',
      serverNow: at.toISOString(),
      holdMinutes: 10,
      termsDocument: { id: 't1', href: '/legal/terms' },
      waiverDocument: { id: 'w1', href: '/legal/waiver-hudson' },
      children: 0,
    });
  });

  it('falls back to the neighborhood without a meeting point', () => {
    const read = buildCheckoutView(
      source({
        experience: { ...source().experience, meetingPoint: null },
      }),
      'device-a',
    );
    expect(read?.view.where).toBe('Tribeca');
  });

  it('adds the tax of a taxable experience to the total', () => {
    const read = buildCheckoutView(
      source({
        experience: { ...source().experience, taxTreatment: 'taxable' },
      }),
      'device-a',
    );
    expect(read?.view.taxMinor).toBe(1154);
    expect(read?.view.totalMinor).toBe(14_154);
  });

  it('counts the children and words each line for a mixed party', () => {
    const read = buildCheckoutView(
      source({ items: [adult, child] }),
      'device-a',
    );
    expect(read?.view.children).toBe(1);
    expect(read?.view.lines.map((line) => line.label)).toEqual([
      '$65 × 2 adults',
      '$30 × 1 child',
    ]);
    expect(read?.view.party).toEqual([
      { priceOptionId: 'a', quantity: 2 },
      { priceOptionId: 'c', quantity: 1 },
    ]);
  });

  it.each([
    ['another device', 'device-b', {}],
    ['a gift hold', 'device-a', { purpose: 'gift_redemption' as const }],
    ['a converted hold', 'device-a', { status: 'converted' as const }],
    ['a released hold', 'device-a', { status: 'released' as const }],
  ])('reads %s as no hold at all', (_name, device, hold) => {
    expect(
      buildCheckoutView(
        source({ hold: { ...source().hold, ...hold } }),
        device,
      ),
    ).toBeNull();
  });

  it('shows a lapsed hold, so the page can say so', () => {
    const read = buildCheckoutView(
      source({
        hold: { ...source().hold, expiresAt: new Date('2026-10-23T13:00:00Z') },
      }),
      'device-a',
    );
    expect(read?.view.expiresAt).toBe('2026-10-23T13:00:00.000Z');
  });

  it('refuses a page with no published terms', () => {
    expect(() =>
      buildCheckoutView(source({ terms: null }), 'device-a'),
    ).toThrow(/terms/);
  });

  it('refuses a waiver-required experience whose waiver is not published', () => {
    expect(() =>
      buildCheckoutView(source({ waiver: null }), 'device-a'),
    ).toThrow(/waiver/);
  });

  it('shows no waiver for an experience that needs none', () => {
    const read = buildCheckoutView(
      source({
        experience: { ...source().experience, waiverRequired: false },
        waiver: null,
      }),
      'device-a',
    );
    expect(read?.view.waiverDocument).toBeNull();
  });
});
