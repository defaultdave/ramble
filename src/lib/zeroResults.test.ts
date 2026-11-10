import { describe, expect, it } from 'vitest';
import { browseParamNames, noFilters, type BrowseFilters } from './filters';
import {
  maxSuggestions,
  removals,
  suggestions,
  type FilterParam,
} from './zeroResults';

// Behaviours under test, one per decision, branch or risk:
// - a removal is made for every filter that is on, and only those, in the order of browseParamNames, whatever the filter
// - the removal drops that filter alone, and a list filter comes off whole
// - each removal is worded by the filter's value: names for lists, the date chip, the party, the band, the choice, the search in quotes
// - a filter with no name to show (a slug the catalog does not have) has no removal
// - suggestions are the removals with a count above zero, the largest count first, ties in param order
// - at most three are offered, and a filter with no count is not offered
// - a suggestion's address is browse without that filter and without a cursor

const options = {
  categories: [
    { slug: 'kayaking', name: 'Kayaking' },
    { slug: 'wine', name: 'Wine' },
  ],
  neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
};

const everything: BrowseFilters = {
  categories: ['kayaking', 'wine'],
  neighborhoods: ['dumbo'],
  date: '2026-11-07',
  guests: 4,
  price: 'under-50',
  age: 'kids',
  setting: 'outdoor',
  search: 'sunset',
};

const params = Object.keys(browseParamNames).filter(
  (name): name is FilterParam => name !== 'after',
);

describe('removals', () => {
  it('has none when no filter is on', () => {
    expect(removals(noFilters, options)).toEqual([]);
  });

  it('has one for each filter, in the order of the URL grammar, so a new filter is covered without being listed', () => {
    expect(removals(everything, options).map(({ param }) => param)).toEqual(
      params,
    );
  });

  it.each(params)('takes %s off and leaves the rest as they were', (param) => {
    const removal = removals(everything, options).find(
      (found) => found.param === param,
    );

    expect(removal?.filters).toEqual({
      ...everything,
      [param]: noFilters[param],
    });
  });

  it.each([
    ['categories', 'Kayaking and Wine'],
    ['neighborhoods', 'DUMBO'],
    ['date', 'Sat, Nov 7'],
    ['guests', '4 guests'],
    ['price', 'Under $50'],
    ['age', 'Kids welcome'],
    ['setting', 'Outdoor'],
    ['search', '“sunset”'],
  ])('calls %s by its value', (param, label) => {
    const removal = removals(everything, options).find(
      (found) => found.param === param,
    );

    expect(removal?.label).toBe(label);
  });

  it('has no removal for a list whose slugs the catalog has no name for', () => {
    const stray = { ...noFilters, categories: ['gone'], guests: 2 };

    expect(removals(stray, options).map(({ param }) => param)).toEqual([
      'guests',
    ]);
  });
});

describe('suggestions', () => {
  const counts = { categories: 12, neighborhoods: 4, guests: 4, price: 30 };

  it('puts the filter that brings back the most first, and ties in param order', () => {
    const offered = suggestions(everything, options, counts);

    expect(offered.map(({ param, count }) => [param, count])).toEqual([
      ['price', 30],
      ['categories', 12],
      ['neighborhoods', 4],
    ]);
  });

  it('offers no more than three', () => {
    const many = Object.fromEntries(params.map((param) => [param, 5]));

    expect(suggestions(everything, options, many)).toHaveLength(maxSuggestions);
    expect(maxSuggestions).toBe(3);
  });

  it('never offers a removal that brings back nothing, or one with no count', () => {
    const offered = suggestions(everything, options, {
      categories: 0,
      neighborhoods: 2,
    });

    expect(offered.map(({ param }) => param)).toEqual(['neighborhoods']);
  });

  it('has none for filters that are not on, whatever counts say', () => {
    expect(suggestions(noFilters, options, { price: 9 })).toEqual([]);
  });

  it('links to browse without that filter and without a cursor', () => {
    const [first] = suggestions(
      { ...noFilters, categories: ['kayaking'], price: 'under-50' },
      options,
      { price: 3 },
    );

    expect(first).toEqual({
      param: 'price',
      label: 'Under $50',
      count: 3,
      href: '/new-york/browse?category=kayaking',
    });
  });
});
