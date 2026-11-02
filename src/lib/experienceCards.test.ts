import { describe, expect, it } from 'vitest';
import {
  CardExperienceSchema,
  CardPriceOptionSchema,
  cardsInOrder,
  toExperienceCard,
  withPriceOptions,
  type CardExperience,
} from './experienceCards';

// Behaviours under test, one per decision, branch or risk:
// - prices are grouped under their experience, lowest first; a price of an unlisted experience is ignored
// - a card carries neighborhood, duration and price of a bookable experience, and links a guide entry out
// - a card price comes only from options that take a space, so a kids class with a free accompanying adult reads the child price
// - a price of nothing reads "Free", never "From Free" or "From $0"
// - a card is left out when it cannot be shown: no price to book, or no link out
// - cards follow the order given, skip what is missing, and stop at the limit
// - the row schema keeps what a card needs and refuses a negative or fractional price
// - the lookup limit is the one bound the home read and the cover read share

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function experience(
  n: number,
  overrides: Partial<CardExperience> = {},
): CardExperience {
  return {
    id: id(n),
    slug: `thing-${String(n)}`,
    name: `Thing ${String(n)}`,
    status: 'live',
    neighborhoodName: 'Greenpoint',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 7000, usesSpace: true }],
    ...overrides,
  };
}

describe('withPriceOptions', () => {
  it('gives each row its own prices, lowest first, and ignores prices of unlisted rows', () => {
    expect(
      withPriceOptions(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [
          { experienceId: 'a', priceMinor: 7000, usesSpace: true },
          { experienceId: 'b', priceMinor: 500, usesSpace: false },
          { experienceId: 'a', priceMinor: 3500, usesSpace: true },
          { experienceId: 'zzz', priceMinor: 1, usesSpace: true },
        ],
      ),
    ).toEqual([
      {
        id: 'a',
        priceOptions: [
          { priceMinor: 3500, usesSpace: true },
          { priceMinor: 7000, usesSpace: true },
        ],
      },
      { id: 'b', priceOptions: [{ priceMinor: 500, usesSpace: false }] },
      { id: 'c', priceOptions: [] },
    ]);
  });

  it('keeps the other fields of a row', () => {
    expect(withPriceOptions([{ id: 'a', name: 'Thing' }], [])).toEqual([
      { id: 'a', name: 'Thing', priceOptions: [] },
    ]);
  });
});

describe('toExperienceCard', () => {
  it('shows a bookable experience with its neighborhood, length, and price', () => {
    expect(toExperienceCard(experience(1))).toEqual({
      id: id(1),
      title: 'Thing 1',
      meta: 'Greenpoint · 2 hr',
      href: `/experiences/thing-1-${id(1)}`,
      image: null,
      kind: 'bookable',
      price: '$70',
    });
  });

  it.each([
    [
      'a kids class priced from the child, not the free accompanying adult',
      [
        { priceMinor: 0, usesSpace: false },
        { priceMinor: 4500, usesSpace: true },
      ],
      '$45',
    ],
    [
      'an adult and a child price',
      [
        { priceMinor: 8500, usesSpace: true },
        { priceMinor: 4500, usesSpace: true },
      ],
      'From $45',
    ],
    ['a free experience', [{ priceMinor: 0, usesSpace: true }], 'Free'],
    [
      'a free option beside a paid one that both take a space',
      [
        { priceMinor: 0, usesSpace: true },
        { priceMinor: 2000, usesSpace: true },
      ],
      'Free',
    ],
  ])('reads %s', (_name, priceOptions, price) => {
    expect(toExperienceCard(experience(1, { priceOptions }))).toMatchObject({
      kind: 'bookable',
      price,
    });
  });

  it('leaves the length out of the meta when there is none', () => {
    expect(
      toExperienceCard(experience(1, { durationMinutes: null }))?.meta,
    ).toBe('Greenpoint');
  });

  it('shows a guide entry with its link out and no price', () => {
    expect(
      toExperienceCard(
        experience(1, {
          status: 'guide_only',
          linkOutUrl: 'https://host.example/kayak',
          priceOptions: [],
        }),
      ),
    ).toEqual({
      id: id(1),
      title: 'Thing 1',
      meta: 'Greenpoint · 2 hr',
      href: `/guide/thing-1-${id(1)}`,
      image: null,
      kind: 'guide-only',
      hostHref: 'https://host.example/kayak',
    });
  });

  it.each([
    ['a bookable experience with no price', { priceOptions: [] }],
    [
      'a bookable experience whose only option takes no space',
      { priceOptions: [{ priceMinor: 0, usesSpace: false }] },
    ],
    ['a guide entry with no link out', { status: 'guide_only' as const }],
  ])('leaves out %s', (_name, overrides) => {
    expect(toExperienceCard(experience(1, overrides))).toBeNull();
  });
});

describe('cardsInOrder', () => {
  const all = [experience(1), experience(2), experience(3), experience(4)];
  const noPrice = experience(5, { priceOptions: [] });

  it('follows the order of the IDs, not of the experiences', () => {
    expect(
      cardsInOrder([id(3), id(1), id(2)], all, 10).map((card) => card.id),
    ).toEqual([id(3), id(1), id(2)]);
  });

  it('skips an ID with no experience and one that cannot be a card', () => {
    expect(
      cardsInOrder([id(9), id(5), id(2)], [...all, noPrice], 10).map(
        (card) => card.id,
      ),
    ).toEqual([id(2)]);
  });

  it('stops at the limit', () => {
    expect(
      cardsInOrder(
        all.map((e) => e.id),
        all,
        2,
      ),
    ).toHaveLength(2);
  });

  it('takes cards past one that is skipped, to fill the limit', () => {
    expect(
      cardsInOrder([id(5), id(1), id(2)], [...all, noPrice], 2).map(
        (card) => card.id,
      ),
    ).toEqual([id(1), id(2)]);
  });
});

describe('the card schemas', () => {
  it('accepts a row as the data layer reads it', () => {
    expect(CardExperienceSchema.parse(experience(1))).toEqual(experience(1));
  });

  it('drops a field a card does not read', () => {
    expect(
      CardPriceOptionSchema.parse({
        kind: 'adult',
        priceMinor: 100,
        usesSpace: true,
      }),
    ).toEqual({ priceMinor: 100, usesSpace: true });
  });

  it.each([
    ['a negative price', { priceMinor: -1, usesSpace: true }],
    ['a fractional price', { priceMinor: 10.5, usesSpace: true }],
    ['a missing usesSpace', { priceMinor: 100 }],
  ])('refuses %s', (_name, option) => {
    expect(CardPriceOptionSchema.safeParse(option).success).toBe(false);
  });

  it('refuses a status a guest may not see', () => {
    expect(
      CardExperienceSchema.safeParse({ ...experience(1), status: 'draft' })
        .success,
    ).toBe(false);
  });
});
