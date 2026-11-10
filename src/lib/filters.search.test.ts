import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  BrowseFiltersSchema,
  hrefForFilters,
  isIndexable,
  maxSearchLength,
  noFilters,
  parseFilters,
  toQuery,
  toQueryEntries,
} from './filters';

// Behaviours under test, one per decision, branch or risk:
// - the search is read from `q`, trimmed, with its inner words and punctuation kept for the database to read
// - an empty, blank, over-long, or repeated `q` is dropped without touching its siblings, and one at the bound is kept
// - it is written after the setting and before the cursor, encoded, and parsing what was written gives the same search
// - it counts as one active filter, and a searched page is not for search engines
// - the data layer schema refuses a search the parse never builds

describe('parsing the search', () => {
  it.each([
    ['kayak', 'kayak'],
    ['  kayak  ', 'kayak'],
    ['"wine tasting" -beer', '"wine tasting" -beer'],
    ['a'.repeat(maxSearchLength), 'a'.repeat(maxSearchLength)],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseFilters({ q: raw }).filters.search).toBe(expected);
  });

  it.each([
    [''],
    ['   '],
    ['a'.repeat(maxSearchLength + 1)],
    [['kayak', 'wine']],
    [undefined],
  ])('drops %j and keeps its siblings', (raw) => {
    const { filters } = parseFilters({ q: raw, guests: '3' });

    expect(filters).toMatchObject({ search: null, guests: 3 });
  });
});

describe('writing the search', () => {
  const searched = {
    ...noFilters,
    setting: 'indoor',
    search: 'wine & "a b"',
  } as const;

  it('writes it encoded, after the setting and before the cursor', () => {
    const after = '5f1b1e6c-1111-4222-8333-444455556666';

    expect(toQuery({ filters: searched, after })).toBe(
      `setting=indoor&q=wine+%26+%22a+b%22&after=${after}`,
    );
  });

  it('writes nothing when there is no search', () => {
    expect(toQueryEntries({ filters: noFilters, after: null })).toEqual([]);
  });

  it('reads back what it wrote', () => {
    const params = Object.fromEntries(
      toQueryEntries({ filters: searched, after: null }),
    );

    expect(parseFilters(params).filters).toEqual(searched);
  });

  it('links to the address with the search', () => {
    expect(hrefForFilters({ ...noFilters, search: 'kayak' })).toBe(
      '/new-york/browse?q=kayak',
    );
  });
});

describe('the search as a filter', () => {
  it('counts as one active filter beside the others', () => {
    expect(activeFilterCount(noFilters)).toBe(0);
    expect(activeFilterCount({ ...noFilters, search: 'kayak' })).toBe(1);
    expect(
      activeFilterCount({ ...noFilters, search: 'kayak', guests: 2 }),
    ).toBe(2);
  });

  it('is not indexable', () => {
    expect(isIndexable({ filters: noFilters, after: null })).toBe(true);
    expect(
      isIndexable({ filters: { ...noFilters, search: 'kayak' }, after: null }),
    ).toBe(false);
  });

  it.each([[''], ['   '], ['a'.repeat(maxSearchLength + 1)]])(
    'is refused by the data layer schema as %j',
    (search) => {
      expect(() =>
        BrowseFiltersSchema.parse({ ...noFilters, search }),
      ).toThrow();
    },
  );
});
