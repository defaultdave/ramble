import { describe, expect, it } from 'vitest';
import { cacheTagBudget } from './cacheTagBudget';
import {
  collectionFallbackTitle,
  collectionHead,
  collectionPath,
  collectionView,
  inCollectionOrder,
} from './picks';
import { editorialLimits } from '../editorial';
import type { CardExperience } from '../experienceCards';
import { id } from '../../../tests/support/ids';

// Behaviours under test, one per decision, branch or risk:
// - the experiences come out in the collection's order, not the order they were read in
// - an entry with no experience to show is left out, and an experience that is not an entry is not shown
// - the results are one list: the count over every card, no further page, no way back
// - a card that cannot be shown (a bookable experience with no price to take a space) is left out, not repaired
// - a collection with nothing to show is worded for a page with no filters
// - the address is the Pick's slug, and the gift guide has no slug
// - the head is the title with the summary as description, absent when none is written
// - a page that cannot name itself falls back to its kind's plain title
// - a full collection keeps the cached entry inside the cache tag budget: a tag per entry, the collection, and the catalog

function experience(
  n: number,
  overrides: Partial<CardExperience> = {},
): CardExperience {
  return {
    id: id(n),
    slug: `thing-${String(n)}`,
    name: `Thing ${String(n)}`,
    status: 'live',
    neighborhoodName: 'DUMBO',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 8500, usesSpace: true }],
    ...overrides,
  };
}

const entries = (...numbers: number[]) =>
  numbers.map((n) => ({ experienceId: id(n) }));

describe('inCollectionOrder', () => {
  it('follows the entries, whatever order the experiences were read in', () => {
    const read = [experience(1), experience(2), experience(3)];

    expect(
      inCollectionOrder(entries(3, 1, 2), read).map(({ id: found }) => found),
    ).toEqual([id(3), id(1), id(2)]);
  });

  it('leaves out an entry with no experience, and an experience that is no entry', () => {
    const read = [experience(1), experience(2), experience(9)];

    expect(
      inCollectionOrder(entries(2, 5, 1), read).map(({ id: found }) => found),
    ).toEqual([id(2), id(1)]);
  });
});

describe('collectionView', () => {
  it('is one list in collection order with the count and no further page', () => {
    const view = collectionView(entries(2, 1), [experience(1), experience(2)]);

    expect(view).toMatchObject({
      state: 'results',
      summary: '2 experiences',
      showMore: null,
      startHref: null,
    });
    expect(view.state === 'results' && view.cards.map((c) => c.title)).toEqual([
      'Thing 2',
      'Thing 1',
    ]);
  });

  it('leaves out a card that cannot be shown', () => {
    const view = collectionView(entries(1, 2), [
      experience(1),
      experience(2, { priceOptions: [] }),
    ]);

    expect(view).toMatchObject({ state: 'results', summary: '1 experience' });
  });

  it.each([
    ['no entries', [], []],
    ['no experience for any entry', entries(1), []],
    [
      'only cards that cannot be shown',
      entries(1),
      [experience(1, { priceOptions: [] })],
    ],
  ])(
    'words the empty state for a page with no filters when there are %s',
    (_case, items, read) => {
      expect(collectionView(items, read)).toEqual({
        state: 'empty',
        filtered: false,
        dated: null,
        wording: 'landing',
      });
    },
  );
});

describe('collectionPath', () => {
  it.each([
    ['pick', 'holiday-weekends', '/picks/holiday-weekends'],
    ['gift_guide', null, '/gifts'],
  ] as const)('the %s page is at %s', (kind, slug, path) => {
    expect(collectionPath(kind, slug)).toBe(path);
  });
});

describe('collectionHead', () => {
  it('is the title with the summary as its description', () => {
    expect(
      collectionHead({ title: 'Rainy days', summary: 'Indoors.' }),
    ).toEqual({ title: 'Rainy days', description: 'Indoors.' });
  });

  it('has no description until a summary is written', () => {
    expect(collectionHead({ title: 'Rainy days', summary: null })).toEqual({
      title: 'Rainy days',
      description: null,
    });
  });
});

describe('collectionFallbackTitle', () => {
  it.each([
    ['pick', 'Ramble Picks'],
    ['gift_guide', 'Gift guide'],
  ] as const)('names a %s page %s', (kind, title) => {
    expect(collectionFallbackTitle(kind)).toBe(title);
  });
});

describe('the collection cache entry', () => {
  it('stays inside the tag budget with a full collection, its own tag, and the catalog', () => {
    expect(2 + editorialLimits.collectionItems).toBeLessThanOrEqual(
      cacheTagBudget,
    );
  });
});
