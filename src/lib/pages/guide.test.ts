import { describe, expect, it } from 'vitest';
import {
  experience,
  id,
  place,
} from '../../../tests/support/fixtures/experience';
import type { CardExperience } from '../experienceCards';
import type { GuestPhoto } from '../photos';
import {
  buildGuideEntry,
  chooseOutbound,
  guideHead,
  relatedBookableCards,
  relatedBookableLimit,
  relatedQuery,
} from './guide';

// Behaviours under test, one per decision, branch or risk:
// - the affiliate link wins over the plain link out and is the only one marked sponsored; neither means no link
// - a guide-only entry becomes a view with the host, place, duration, and the way out; a live experience is null
// - the cover is the photo with the lowest position, whatever order they arrive in; none is null
// - a description with no text gives no paragraphs, and no duration gives no label
// - the head is the entry's name, with no description; a missing or live experience is the not-found title
// - the module reads browse's first page for the category and nothing else
// - the module keeps bookable cards only, never the entry, at most three, and skips one that cannot be a card

const guide = (overrides: Parameters<typeof experience>[0] = {}) =>
  experience({
    status: 'guide_only',
    name: 'Sourdough mornings at Rise Bakery',
    linkOutUrl: 'https://rise.example/classes',
    durationMinutes: 150,
    priceOptions: [],
    ...overrides,
  });

const photo = (position: number, url: string): GuestPhoto => ({
  id: id(50 + position),
  experienceId: id(1),
  position,
  url,
  width: 1600,
  height: 1200,
  decorative: false,
  altText: `Photo ${String(position)}`,
  blurDataUrl: 'data:image/jpeg;base64,AAAA',
});

describe('chooseOutbound', () => {
  it.each([
    [
      'both',
      'https://rise.example/',
      'https://aff.example/x',
      'https://aff.example/x',
      true,
    ],
    [
      'only the link out',
      'https://rise.example/',
      null,
      'https://rise.example/',
      false,
    ],
    [
      'only the affiliate link',
      null,
      'https://aff.example/x',
      'https://aff.example/x',
      true,
    ],
  ])('with %s', (_name, linkOut, affiliate, href, sponsored) => {
    expect(chooseOutbound(linkOut, affiliate)).toEqual({ href, sponsored });
  });

  it('is null with neither', () => {
    expect(chooseOutbound(null, null)).toBeNull();
  });
});

describe('buildGuideEntry', () => {
  it('says what the entry is, where, and how to reach the host', () => {
    const view = buildGuideEntry({
      experience: guide({
        description: 'Knead and shape.\n\nTake a loaf home.',
      }),
      photos: [],
      place,
    });

    expect(view).toEqual({
      title: 'Sourdough mornings at Rise Bakery',
      about: ['Knead and shape.', 'Take a loaf home.'],
      hostName: 'Hudson Paddle Club',
      neighborhoodName: 'Tribeca',
      categoryName: 'Outdoors',
      duration: '2.5 hr',
      outbound: { href: 'https://rise.example/classes', sponsored: false },
      cover: null,
    });
  });

  it('is null for a live experience, which has its own page', () => {
    expect(
      buildGuideEntry({ experience: experience(), photos: [], place }),
    ).toBeNull();
  });

  it('covers with the photo of the lowest position, whatever order they arrive in', () => {
    const view = buildGuideEntry({
      experience: guide(),
      photos: [
        photo(2, 'https://img.example/b.jpg'),
        photo(0, 'https://img.example/a.jpg'),
      ],
      place,
    });

    expect(view?.cover?.src).toBe('https://img.example/a.jpg');
  });

  it('has no paragraphs without a description and no duration label without minutes', () => {
    const view = buildGuideEntry({
      experience: guide({ description: null, durationMinutes: null }),
      photos: [],
      place,
    });

    expect(view).toMatchObject({ about: [], duration: null });
  });
});

describe('guideHead', () => {
  it('names the entry and gives no description', () => {
    expect(guideHead({ experience: guide() })).toEqual({
      title: 'Sourdough mornings at Rise Bakery',
    });
  });

  it.each([
    ['nothing', null],
    ['a live experience', { experience: experience() }],
  ])('is the not-found title for %s', (_name, data) => {
    expect(guideHead(data)).toEqual({ title: 'Guide entry not found' });
  });
});

describe('relatedQuery', () => {
  it('is the first page of browse with the category and nothing else', () => {
    expect(relatedQuery('cooking')).toEqual({
      filters: {
        categories: ['cooking'],
        neighborhoods: [],
        date: null,
        guests: null,
        price: null,
        age: null,
        setting: null,
      },
      after: null,
    });
  });
});

const card = (
  n: number,
  overrides: Partial<CardExperience> = {},
): CardExperience => ({
  id: id(n),
  slug: `class-${String(n)}`,
  name: `Class ${String(n)}`,
  status: 'live',
  neighborhoodName: 'Park Slope',
  durationMinutes: 120,
  linkOutUrl: null,
  priceOptions: [{ priceMinor: 6000, usesSpace: true }],
  ...overrides,
});

describe('relatedBookableCards', () => {
  it('keeps bookable cards in order, never the entry itself', () => {
    const cards = relatedBookableCards([card(1), card(2), card(3)], id(1));

    expect(cards.map((c) => c.id)).toEqual([id(2), id(3)]);
    expect(cards[0]).toMatchObject({
      kind: 'bookable',
      href: `/experiences/class-2-${id(2)}`,
    });
  });

  it('leaves out other guide entries', () => {
    const guideCard = card(2, {
      status: 'guide_only',
      linkOutUrl: 'https://host.example/',
    });

    const cards = relatedBookableCards([guideCard, card(3)], id(1));

    expect(cards.map((c) => c.id)).toEqual([id(3)]);
  });

  it('stops at the limit', () => {
    const items = [2, 3, 4, 5, 6].map((n) => card(n));

    expect(relatedBookableCards(items, id(1))).toHaveLength(
      relatedBookableLimit,
    );
  });

  it('skips a card that cannot be shown, without losing a place to it', () => {
    const unpriced = card(2, { priceOptions: [] });

    const cards = relatedBookableCards([unpriced, card(3)], id(1));

    expect(cards.map((c) => c.id)).toEqual([id(3)]);
  });

  it('is empty when nothing qualifies', () => {
    expect(relatedBookableCards([card(1)], id(1))).toEqual([]);
  });
});
