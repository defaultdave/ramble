import { describe, expect, it } from 'vitest';
import { isSlug } from '../catalog';
import type { CardExperience } from '../experienceCards';
import {
  landingBrowseHref,
  landingErrorView,
  landingFilters,
  landingHead,
  landingHeading,
  landingPath,
  landingPlaceholderSlug,
  landingQuery,
  landingTag,
  landingTarget,
  landingView,
  type LandingKind,
} from './landing';
import type { BrowsePage } from './browse';

// Behaviours under test, one per decision, branch or risk:
// - the build's placeholder is not a slug, so the page refuses it before any read
// - the address, the cache tag, and the browse query follow the kind: a category page filters by category, a neighborhood page by neighborhood, and nothing else
// - the target is found by kind and slug: a slug of the other kind, or none, finds nothing
// - the heading is the editor's when there is one, otherwise made from the name for the kind; the head adds the meta description only when written
// - the results are browse's first page for that query, with Show more going to browse and an empty page worded for a page with no filters
// - Try again returns to the page itself

const options = {
  categories: [{ slug: 'cooking', name: 'Cooking' }],
  neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
};

const kinds: LandingKind[] = ['category', 'neighborhood'];

function experience(n: number): CardExperience {
  return {
    id: `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    slug: `thing-${String(n)}`,
    name: `Thing ${String(n)}`,
    status: 'live',
    neighborhoodName: 'DUMBO',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 8500, usesSpace: true }],
  };
}

describe('landingPlaceholderSlug', () => {
  it('is not a slug', () => {
    expect(isSlug(landingPlaceholderSlug)).toBe(false);
  });
});

describe('the kind of page', () => {
  it.each([
    ['category', '/new-york/things-to-do/cooking', 'category:cooking'],
    ['neighborhood', '/new-york/neighborhoods/cooking', 'neighborhood:cooking'],
  ] as const)('a %s page has its own address and tag', (kind, path, tag) => {
    expect(landingPath(kind, 'cooking')).toBe(path);
    expect(landingTag(kind, 'cooking')).toBe(tag);
  });

  it.each([
    [
      'category',
      '/new-york/browse?category=cooking',
      { categories: ['cooking'], neighborhoods: [] },
    ],
    [
      'neighborhood',
      '/new-york/browse?neighborhood=cooking',
      { categories: [], neighborhoods: ['cooking'] },
    ],
  ] as const)(
    'a %s page reads the first page of browse for that one value',
    (kind, href, lists) => {
      expect(landingFilters(kind, 'cooking')).toEqual({
        ...lists,
        date: null,
        guests: null,
      });
      expect(landingQuery(kind, 'cooking').after).toBeNull();
      expect(landingBrowseHref(kind, 'cooking')).toBe(href);
    },
  );
});

describe('landingTarget', () => {
  it.each([
    ['category', 'cooking', { slug: 'cooking', name: 'Cooking' }],
    ['neighborhood', 'dumbo', { slug: 'dumbo', name: 'DUMBO' }],
    ['category', 'dumbo', null],
    ['neighborhood', 'cooking', null],
    ['category', 'nothing-here', null],
  ] as const)('%s %s finds %j', (kind, slug, found) => {
    expect(landingTarget(kind, slug, options)).toEqual(found);
  });
});

describe('landingHeading and landingHead', () => {
  it('uses the editor heading', () => {
    expect(
      landingHeading('category', 'Cooking', { heading: 'Cooking in Brooklyn' }),
    ).toBe('Cooking in Brooklyn');
  });

  it.each([
    ['category', null, 'Cooking experiences in New York'],
    ['category', { heading: null }, 'Cooking experiences in New York'],
    ['neighborhood', null, 'Things to do in Cooking'],
  ] as const)(
    'makes a %s heading from the name when the copy gives %j',
    (kind, copy, expected) => {
      expect(landingHeading(kind, 'Cooking', copy)).toBe(expected);
    },
  );

  it('takes the meta description from the copy, and has none without it', () => {
    expect(
      landingHead('category', 'Cooking', {
        heading: null,
        metaDescription: 'Roll pasta.',
      }),
    ).toEqual({
      title: 'Cooking experiences in New York',
      description: 'Roll pasta.',
    });
    expect(landingHead('neighborhood', 'DUMBO', null)).toEqual({
      title: 'Things to do in DUMBO',
      description: null,
    });
  });
});

describe('landingView', () => {
  it('shows the cards, and sends Show more to browse with the filter kept', () => {
    const page: BrowsePage = {
      ok: true,
      items: [experience(1)],
      nextCursor: experience(1).id,
    };

    const view = landingView('category', 'cooking', page);

    expect(view).toMatchObject({
      state: 'results',
      cards: [{ title: 'Thing 1' }],
      showMore: {
        action: '/new-york/browse',
        fields: [
          ['category', 'cooking'],
          ['after', experience(1).id],
        ],
      },
      startHref: null,
    });
  });

  it('words a page with nothing on it for a page with no filters to take off', () => {
    expect(
      landingView('neighborhood', 'dumbo', {
        ok: true,
        items: [],
        nextCursor: null,
      }),
    ).toEqual({
      state: 'empty',
      filtered: false,
      dated: null,
      wording: 'landing',
    });
  });
});

describe('landingErrorView', () => {
  it.each(kinds)('sends Try again of a %s page back to the page', (kind) => {
    expect(landingErrorView(kind, 'cooking')).toEqual({
      state: 'error',
      retry: { action: landingPath(kind, 'cooking'), fields: [] },
      wording: 'landing',
    });
  });
});
