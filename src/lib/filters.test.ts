import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  BrowseQuerySchema,
  browseHref,
  browseParamNames,
  canAddFilterValue,
  chipState,
  hrefForFilters,
  isIndexable,
  knownFilters,
  maxFilterValues,
  noFilters,
  parseFilters,
  toQuery,
  toQueryEntries,
  toggleFilterValue,
  withDate,
  type BrowseQuery,
} from './filters';

// Behaviours under test, one per decision, branch or risk:
// - an address with no filters parses to no filters and no cursor
// - category, neighborhood, date, and after are read; lists come back sorted and without repeats
// - an unknown parameter is ignored, and a malformed value is dropped without touching its siblings
// - a list over the bound is dropped whole, one at the bound is kept, and the bound counts raw values
// - a date that is malformed, not a real day, or repeated is dropped
// - a cursor that is not a uuid or is repeated is dropped, and an upper-case one is lower-cased
// - a huge value is refused by length, not walked
// - toQuery writes a fixed order, and parsing what it wrote gives the same query back
// - toggling adds in order, removes a chosen value, and refuses a new value on a full list
// - the unfiltered first page is the only indexable one
// - slugs the catalog has no row for are dropped, and a list with slugs of which none is known matches nothing

const cursor = '0b1c2d3e-4f50-4a61-8b72-93a4b5c6d7e8';

describe('browseParamNames', () => {
  it('names the query parameters of the grammar', () => {
    expect(browseParamNames).toEqual({
      categories: 'category',
      neighborhoods: 'neighborhood',
      date: 'date',
      after: 'after',
    });
  });
});

describe('parseFilters', () => {
  it('parses an address with no filters to none', () => {
    expect(parseFilters({})).toEqual({ filters: noFilters, after: null });
  });

  it('reads every parameter', () => {
    expect(
      parseFilters({
        category: 'cooking',
        neighborhood: ['dumbo', 'bushwick'],
        date: '2026-11-07',
        after: cursor,
      }),
    ).toEqual({
      filters: {
        categories: ['cooking'],
        neighborhoods: ['bushwick', 'dumbo'],
        date: '2026-11-07',
      },
      after: cursor,
    });
  });

  it('sorts a list and drops a repeated value', () => {
    expect(
      parseFilters({ category: ['walking-tours', 'cooking', 'cooking'] })
        .filters.categories,
    ).toEqual(['cooking', 'walking-tours']);
  });

  it('ignores a parameter it does not know', () => {
    expect(
      parseFilters({
        utm_source: 'newsletter',
        page: '2',
        category: 'cooking',
      }),
    ).toEqual({
      filters: { ...noFilters, categories: ['cooking'] },
      after: null,
    });
  });

  it.each([
    ['upper case', 'Cooking'],
    ['a space', 'walking tours'],
    ['a trailing hyphen', 'cooking-'],
    ['a double hyphen', 'wine--bars'],
    ['an empty value', ''],
    ['markup', '<script>'],
    ['a SQL fragment', "x' OR '1'='1"],
    ['a value one over the length limit', 'a'.repeat(65)],
  ])('drops a slug with %s and keeps the others', (_name, bad) => {
    expect(
      parseFilters({ category: [bad, 'cooking'] }).filters.categories,
    ).toEqual(['cooking']);
  });

  it('keeps a list at the bound', () => {
    const values = Array.from(
      { length: maxFilterValues },
      (_, i) => `n${String(i)}`,
    );
    expect(
      parseFilters({ neighborhood: values }).filters.neighborhoods,
    ).toEqual(values);
  });

  it('drops a list over the bound whole instead of cutting it', () => {
    const values = Array.from(
      { length: maxFilterValues + 1 },
      (_, i) => `n${String(i)}`,
    );
    expect(
      parseFilters({ neighborhood: values }).filters.neighborhoods,
    ).toEqual([]);
  });

  it('counts raw values against the bound, so repeats cannot be used to make work', () => {
    const repeats = Array.from({ length: maxFilterValues + 1 }, () => 'dumbo');
    expect(
      parseFilters({ neighborhood: repeats }).filters.neighborhoods,
    ).toEqual([]);
  });

  it.each([
    ['a month that does not exist', '2026-13-01'],
    ['a day that does not exist', '2026-02-30'],
    ['words', 'tomorrow'],
    ['no zero padding', '2026-1-1'],
    ['no separators', '20261001'],
    ['an empty value', ''],
    ['a time on the end', '2026-11-07T10:00'],
  ])('drops a date with %s', (_name, date) => {
    expect(parseFilters({ date }).filters.date).toBeNull();
  });

  it('drops a date given twice instead of picking one', () => {
    expect(
      parseFilters({ date: ['2026-11-07', '2026-11-08'] }).filters.date,
    ).toBeNull();
  });

  it.each([
    ['not a uuid', 'abc'],
    ['an id with a stray character', `${cursor}x`],
    ['an empty value', ''],
  ])('drops a cursor that is %s', (_name, after) => {
    expect(parseFilters({ after }).after).toBeNull();
  });

  it('drops a cursor given twice', () => {
    expect(parseFilters({ after: [cursor, cursor] }).after).toBeNull();
  });

  it('lower-cases a cursor so it matches the stored id', () => {
    expect(parseFilters({ after: cursor.toUpperCase() }).after).toBe(cursor);
  });

  it('refuses a very long value by its length', () => {
    const huge = 'a-'.repeat(500_000);
    expect(
      parseFilters({
        category: huge,
        neighborhood: huge,
        date: huge,
        after: huge,
      }),
    ).toEqual({ filters: noFilters, after: null });
  });

  it('builds only queries the data layer schema takes', () => {
    const query = parseFilters({
      category: ['cooking', 'bad slug'],
      date: '2026-11-07',
      after: cursor,
    });
    expect(BrowseQuerySchema.parse(query)).toEqual(query);
  });
});

describe('toQuery', () => {
  const full: BrowseQuery = {
    filters: {
      categories: ['cooking', 'walking-tours'],
      neighborhoods: ['dumbo'],
      date: '2026-11-07',
    },
    after: cursor,
  };

  it('writes one fixed order', () => {
    expect(toQuery(full)).toBe(
      `category=cooking&category=walking-tours&neighborhood=dumbo&date=2026-11-07&after=${cursor}`,
    );
  });

  it('writes lists sorted whatever order they came in', () => {
    expect(
      toQuery({
        filters: { ...noFilters, categories: ['walking-tours', 'cooking'] },
        after: null,
      }),
    ).toBe('category=cooking&category=walking-tours');
  });

  it.each([
    ['everything', full],
    ['nothing', { filters: noFilters, after: null }],
    [
      'a date alone',
      { filters: { ...noFilters, date: '2026-12-31' }, after: null },
    ],
    [
      'a full list',
      {
        filters: {
          ...noFilters,
          neighborhoods: Array.from(
            { length: maxFilterValues },
            (_, i) => `n${String(i)}`,
          ),
        },
        after: cursor,
      },
    ],
  ])('round-trips %s through parse', (_name, query) => {
    const params = Object.fromEntries(
      Object.entries(
        Object.groupBy(toQueryEntries(query), ([name]) => name),
      ).map(([name, pairs]) => [name, (pairs ?? []).map(([, value]) => value)]),
    );
    expect(parseFilters(params)).toEqual(query);
  });

  it('writes an address with no query for no filters', () => {
    expect(browseHref({ filters: noFilters, after: null })).toBe(
      '/new-york/browse',
    );
  });

  it('writes an address with the query', () => {
    expect(browseHref(full)).toBe(`/new-york/browse?${toQuery(full)}`);
  });

  it('starts again from the first results when a filter changes', () => {
    expect(hrefForFilters({ ...noFilters, categories: ['cooking'] })).toBe(
      '/new-york/browse?category=cooking',
    );
  });

  it('escapes what it writes', () => {
    expect(
      toQuery({
        filters: { ...noFilters, categories: ['a&b=c'] },
        after: null,
      }),
    ).toBe('category=a%26b%3Dc');
  });
});

describe('changing filters', () => {
  const chosen = { ...noFilters, categories: ['cooking'] };

  it('adds a value in sorted order', () => {
    expect(toggleFilterValue(chosen, 'categories', 'arts').categories).toEqual([
      'arts',
      'cooking',
    ]);
  });

  it('removes a value that is already chosen', () => {
    expect(
      toggleFilterValue(chosen, 'categories', 'cooking').categories,
    ).toEqual([]);
  });

  it('leaves the other list and the date alone', () => {
    const next = toggleFilterValue(
      { ...chosen, date: '2026-11-07' },
      'neighborhoods',
      'dumbo',
    );
    expect(next).toEqual({
      categories: ['cooking'],
      neighborhoods: ['dumbo'],
      date: '2026-11-07',
    });
  });

  it('refuses a new value on a full list and still allows removing one', () => {
    const full = {
      ...noFilters,
      categories: Array.from(
        { length: maxFilterValues },
        (_, i) => `c${String(i)}`,
      ),
    };
    expect(canAddFilterValue(full, 'categories')).toBe(false);
    expect(canAddFilterValue(full, 'neighborhoods')).toBe(true);
    expect(toggleFilterValue(full, 'categories', 'extra')).toBe(full);
    expect(toggleFilterValue(full, 'categories', 'c0').categories).toHaveLength(
      maxFilterValues - 1,
    );
  });

  it.each([
    ['chosen on a list with room', ['cooking'], 'cooking', true, false],
    ['not chosen on a list with room', ['cooking'], 'arts', false, false],
  ])('reads a chip that is %s', (_name, chosen, slug, selected, disabled) => {
    expect(
      chipState({ ...noFilters, categories: chosen }, 'categories', slug),
    ).toEqual({ selected, disabled });
  });

  it('disables a chip that is not chosen on a full list and not one that is', () => {
    const full = {
      ...noFilters,
      categories: Array.from(
        { length: maxFilterValues },
        (_, i) => `c${String(i)}`,
      ),
    };
    expect(chipState(full, 'categories', 'extra')).toEqual({
      selected: false,
      disabled: true,
    });
    expect(chipState(full, 'categories', 'c3')).toEqual({
      selected: true,
      disabled: false,
    });
  });

  it('sets and clears the date', () => {
    expect(withDate(noFilters, '2026-11-07').date).toBe('2026-11-07');
    expect(
      withDate({ ...noFilters, date: '2026-11-07' }, null).date,
    ).toBeNull();
  });

  it.each([
    ['nothing', noFilters, 0],
    ['a date', { ...noFilters, date: '2026-11-07' }, 1],
    [
      'two values and a date',
      {
        categories: ['cooking'],
        neighborhoods: ['dumbo'],
        date: '2026-11-07',
      },
      3,
    ],
  ])('counts %s', (_name, filters, count) => {
    expect(activeFilterCount(filters)).toBe(count);
  });
});

describe('isIndexable', () => {
  it.each([
    ['the unfiltered first page', noFilters, null, true],
    ['one category', { ...noFilters, categories: ['cooking'] }, null, false],
    [
      'one neighborhood',
      { ...noFilters, neighborhoods: ['dumbo'] },
      null,
      false,
    ],
    ['a date', { ...noFilters, date: '2026-11-07' }, null, false],
    ['a later page of the unfiltered list', noFilters, cursor, false],
  ])('%s', (_name, filters, after, indexable) => {
    expect(isIndexable({ filters, after })).toBe(indexable);
  });
});

describe('knownFilters', () => {
  const options = {
    categories: [{ slug: 'cooking' }, { slug: 'outdoors' }],
    neighborhoods: [{ slug: 'dumbo' }],
  };
  const filters = (partial: Partial<BrowseQuery['filters']>) => ({
    ...noFilters,
    ...partial,
  });

  it.each([
    [
      'keeps known slugs and the date',
      filters({
        categories: ['cooking', 'outdoors'],
        neighborhoods: ['dumbo'],
        date: '2026-11-07',
      }),
      filters({
        categories: ['cooking', 'outdoors'],
        neighborhoods: ['dumbo'],
        date: '2026-11-07',
      }),
      false,
    ],
    ['has nothing to drop without filters', noFilters, noFilters, false],
    [
      'drops an unknown slug beside a known one, in order',
      filters({ categories: ['cooking', 'junk', 'outdoors'] }),
      filters({ categories: ['cooking', 'outdoors'] }),
      false,
    ],
    [
      'matches nothing when a list has only unknown slugs',
      filters({ categories: ['junk', 'more-junk'], date: '2026-11-07' }),
      filters({ date: '2026-11-07' }),
      true,
    ],
    [
      'matches nothing when one list is all unknown and the other is known',
      filters({ categories: ['cooking'], neighborhoods: ['junk'] }),
      filters({ categories: ['cooking'] }),
      true,
    ],
    [
      'does not read a category slug as a neighborhood',
      filters({ neighborhoods: ['cooking'] }),
      noFilters,
      true,
    ],
  ])('%s', (_name, input, expected, matchesNothing) => {
    expect(knownFilters(input, options)).toEqual({
      filters: expected,
      matchesNothing,
    });
  });
});
