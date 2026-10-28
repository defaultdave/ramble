import { describe, expect, it } from 'vitest';
import {
  CancellationTierSchema,
  EntityIdSchema,
  GuestExperienceSchema,
  HostExperienceSchema,
  PriceOptionSchema,
  SlugSchema,
  isSlug,
  type PriceOption,
} from './catalog';

// Behaviours under test, one per decision:
// - a valid row parses for a guest and for a host
// - a guest parse drops host-only fields and unknown fields; a host parse keeps the host-only ones
// - a guest parse refuses a status guests cannot see
// - an unknown enum value is refused
// - each field tie the database CHECKs state is refused here too: age limits, weather policy, link-out
// - a negative or fractional price, a malformed slug and a malformed ID are refused

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const tier = {
  id: id(1),
  key: 'flexible',
  name: 'Flexible',
  fullRefundHoursBefore: 24,
  isDefault: true,
};

const adultOption: PriceOption = {
  id: id(6),
  experienceId: id(3),
  kind: 'adult',
  priceMinor: 4500,
  usesSpace: true,
};

const hostRow = {
  id: id(2),
  slug: 'clay-corner',
  name: 'Clay Corner',
  description: null,
  timeZone: 'America/New_York',
  createdAt: new Date('2026-10-24T00:00:00Z'),
};

const experienceRow = {
  id: id(3),
  hostId: id(2),
  categoryId: id(4),
  neighborhoodId: id(5),
  cancellationTierId: id(1),
  slug: 'pottery-night',
  name: 'Pottery night',
  description: null,
  meetingPoint: null,
  included: null,
  durationMinutes: 120,
  accessibilityNotes: null,
  status: 'live',
  outdoor: false,
  weatherPolicy: null,
  weatherDecisionHours: null,
  ageRule: 'all_ages',
  minAge: null,
  maxAge: null,
  taxTreatment: 'unknown',
  waiverRequired: false,
  waiverDocumentId: null,
  linkOutUrl: null,
  affiliateUrl: null,
  createdAt: new Date('2026-10-24T00:00:00Z'),
  priceOptions: [adultOption],
  cancellationTier: tier,
};

const guestRow = { ...experienceRow, host: hostRow };

describe('GuestExperienceSchema', () => {
  it('accepts a valid row and keeps the ids a cache tag needs', () => {
    const parsed = GuestExperienceSchema.parse(guestRow);

    expect(parsed).toMatchObject({
      id: id(3),
      hostId: id(2),
      categoryId: id(4),
      neighborhoodId: id(5),
    });
  });

  it('strips host-only fields, host internals and unknown fields', () => {
    const parsed = GuestExperienceSchema.parse({
      ...guestRow,
      payoutNote: 'wire on Fridays',
    });

    expect(parsed).not.toHaveProperty('taxTreatment');
    expect(parsed).not.toHaveProperty('waiverDocumentId');
    expect(parsed).not.toHaveProperty('createdAt');
    expect(parsed).not.toHaveProperty('payoutNote');
    expect(parsed.host).not.toHaveProperty('timeZone');
    expect(parsed.host).not.toHaveProperty('createdAt');
  });

  it.each(['draft', 'in_review', 'paused'])(
    'refuses the status %s, which guests cannot see',
    (status) => {
      expect(() =>
        GuestExperienceSchema.parse({ ...guestRow, status }),
      ).toThrow();
    },
  );

  it.each([
    ['status', { status: 'archived' }],
    ['age rule', { ageRule: 'teens_only' }],
    ['tax treatment', { taxTreatment: 'exempt' }],
    ['weather policy', { outdoor: true, weatherPolicy: 'drizzle_only' }],
  ])('refuses an unknown %s', (_name, change) => {
    expect(() =>
      HostExperienceSchema.parse({ ...experienceRow, ...change }),
    ).toThrow();
  });
});

describe('HostExperienceSchema', () => {
  it('keeps the fields guests do not get', () => {
    const parsed = HostExperienceSchema.parse({
      ...experienceRow,
      status: 'draft',
    });

    expect(parsed.taxTreatment).toBe('unknown');
    expect(parsed.status).toBe('draft');
    expect(parsed.createdAt).toEqual(experienceRow.createdAt);
  });

  it.each([
    ['all_ages with a minimum age', { ageRule: 'all_ages', minAge: 8 }],
    [
      '21+ with a maximum age',
      { ageRule: 'twenty_one_plus', minAge: null, maxAge: 40 },
    ],
    ['minimum_age without a minimum', { ageRule: 'minimum_age' }],
    [
      'minimum_age with a maximum',
      { ageRule: 'minimum_age', minAge: 8, maxAge: 12 },
    ],
    ['age_range without limits', { ageRule: 'age_range' }],
    [
      'age_range with the minimum above the maximum',
      { ageRule: 'age_range', minAge: 12, maxAge: 8 },
    ],
    ['an outdoor row with no weather policy', { outdoor: true }],
    [
      'decided_before_start with no deadline',
      { outdoor: true, weatherPolicy: 'decided_before_start' },
    ],
    [
      'rain_or_shine with a deadline',
      {
        outdoor: true,
        weatherPolicy: 'rain_or_shine',
        weatherDecisionHours: 3,
      },
    ],
    ['a guide-only row with no link-out', { status: 'guide_only' }],
    ['a link-out that is not http', { linkOutUrl: 'javascript:alert(1)' }],
    ['a link-out with no host', { linkOutUrl: 'http://' }],
    [
      'a link-out with an invalid punycode label',
      { linkOutUrl: 'http://xn--a.com' },
    ],
    [
      'an affiliate link with an xn-- label',
      { affiliateUrl: 'https://a.xn--zz' },
    ],
  ])('refuses %s', (_name, change) => {
    expect(() =>
      HostExperienceSchema.parse({ ...experienceRow, ...change }),
    ).toThrow();
  });

  it.each([
    ['an age range', { ageRule: 'age_range', minAge: 8, maxAge: 12 }],
    ['a minimum age', { ageRule: 'minimum_age', minAge: 16 }],
    ['21+', { ageRule: 'twenty_one_plus' }],
    [
      'an outdoor row that decides before the start',
      {
        outdoor: true,
        weatherPolicy: 'decided_before_start',
        weatherDecisionHours: 3,
      },
    ],
    [
      'a guide-only row with a link-out',
      { status: 'guide_only', linkOutUrl: 'https://example.com/class' },
    ],
    ['an affiliate link', { affiliateUrl: 'http://localhost:3000/a?b=1#c' }],
  ])('accepts %s', (_name, change) => {
    expect(() =>
      HostExperienceSchema.parse({ ...experienceRow, ...change }),
    ).not.toThrow();
  });
});

describe('PriceOptionSchema', () => {
  it.each([-1, 12.5])('refuses the price %s', (priceMinor) => {
    expect(() =>
      PriceOptionSchema.parse({ ...adultOption, priceMinor }),
    ).toThrow();
  });

  it('accepts a free option', () => {
    expect(
      PriceOptionSchema.parse({ ...adultOption, priceMinor: 0 }).priceMinor,
    ).toBe(0);
  });
});

describe('identifiers', () => {
  it.each(['clay-corner', 'a', 'cafe-2'])('accepts the slug %s', (slug) => {
    expect(SlugSchema.safeParse(slug).success).toBe(true);
  });

  it.each(['Clay-Corner', 'clay corner', 'clay--corner', '-clay', 'clay-', ''])(
    'refuses the slug %j',
    (slug) => {
      expect(SlugSchema.safeParse(slug).success).toBe(false);
    },
  );

  it.each([
    '11111111-1111-1111-1111-111111111111',
    '00000000-0000-0000-0000-000000000000',
  ])('accepts the uuid %s even outside the RFC variants', (value) => {
    expect(EntityIdSchema.safeParse(value).success).toBe(true);
  });

  it.each(['host-test', '', '123'])('refuses the id %j', (value) => {
    expect(EntityIdSchema.safeParse(value).success).toBe(false);
  });

  it('refuses a cancellation tier with negative notice', () => {
    expect(() =>
      CancellationTierSchema.parse({ ...tier, fullRefundHoursBefore: -1 }),
    ).toThrow();
  });
});

describe('isSlug', () => {
  const pattern = /^[a-z0-9]+(-[a-z0-9]+)*$/;

  it.each([
    'a',
    'summer',
    'red-hook',
    'a-b-c',
    '2026-guide',
    '',
    '-',
    '--',
    'a-',
    '-a',
    'a--b',
    'A',
    'a b',
    'a_b',
    'a\n',
    'é',
    'a-b-',
    'a-1-b2',
  ])('agrees with the database pattern on %j', (value) => {
    expect(isSlug(value)).toBe(pattern.test(value));
  });

  // The pattern's repeated group is matched by recursion, which overflows the stack on input
  // of a few million characters; isSlug must answer instead of throwing.
  it.each([
    ['a long run of letters', 'a'.repeat(6_000_000), true],
    ['a long run of hyphen-joined words', 'a-'.repeat(3_000_000) + 'a', true],
    ['a long run of hyphens', '-'.repeat(6_000_000), false],
  ])('answers for %s without throwing', (_name, value, expected) => {
    expect(SlugSchema.safeParse(value).success).toBe(expected);
  });
});
