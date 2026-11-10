import { describe, expect, it } from 'vitest';
import {
  activeFilterCount,
  ageChips,
  BrowseFiltersSchema,
  hrefForFilters,
  noFilters,
  parseFilters,
  priceChips,
  settingChips,
  toQuery,
  toQueryEntries,
} from './filters';

// Behaviours under test, one per decision, branch or risk:
// - price, age, and setting are read from the address when they name a choice the filter offers
// - a value no one offers, in another case, repeated, or empty is dropped without touching its siblings
// - they are written after the party and before the cursor, and parsing what was written gives the same filters
// - each counts as one active filter
// - a chip per choice links to the address with it chosen, the chosen one links to the address without it, and the rest of the filters stay
// - the data layer schema refuses a choice the parse never builds

describe('parsing the choice filters', () => {
  it('reads price, age, and setting', () => {
    expect(
      parseFilters({ price: '50-to-100', age: 'kids', setting: 'outdoor' })
        .filters,
    ).toMatchObject({ price: '50-to-100', age: 'kids', setting: 'outdoor' });
  });

  it.each([
    ['price', 'free'],
    ['price', 'UNDER-50'],
    ['price', ''],
    ['age', 'all'],
    ['age', '21+'],
    ['setting', 'both'],
  ])('drops %s=%s and keeps its siblings', (name, value) => {
    const { filters } = parseFilters({ [name]: value, guests: '3' });

    expect(filters).toMatchObject({ [name]: null, guests: 3 });
  });

  it.each([
    ['price', ['under-50', '100-plus']],
    ['age', ['kids', 'twenty-one-plus']],
    ['setting', ['indoor', 'outdoor']],
  ])('drops %s given twice', (name, twice) => {
    expect(parseFilters({ [name]: twice }).filters).toMatchObject({
      [name]: null,
    });
  });
});

describe('writing the choice filters', () => {
  const chosen = {
    ...noFilters,
    guests: 2,
    price: '100-plus',
    age: 'twenty-one-plus',
    setting: 'indoor',
  } as const;

  it('writes them after the party in a fixed order', () => {
    expect(toQuery({ filters: chosen, after: null })).toBe(
      'guests=2&price=100-plus&age=twenty-one-plus&setting=indoor',
    );
  });

  it('writes nothing for a choice not made', () => {
    expect(toQueryEntries({ filters: noFilters, after: null })).toEqual([]);
  });

  it('parses back what it wrote', () => {
    const entries = Object.fromEntries(
      toQueryEntries({ filters: chosen, after: null }),
    );

    expect(parseFilters(entries).filters).toEqual(chosen);
  });

  it('counts each as one active filter', () => {
    expect(activeFilterCount({ ...noFilters, price: 'under-50' })).toBe(1);
    expect(activeFilterCount(chosen)).toBe(4);
  });

  it('is refused by the data layer schema when it names a choice no one offers', () => {
    expect(
      BrowseFiltersSchema.safeParse({ ...noFilters, price: 'free' }).success,
    ).toBe(false);
  });
});

describe('chips for the choice filters', () => {
  it.each([
    ['price', priceChips, ['Under $50', '$50 to $100', '$100 and up']],
    ['age', ageChips, ['Kids welcome', '21 and over']],
    ['setting', settingChips, ['Indoor', 'Outdoor']],
  ] as const)(
    'offers one chip per %s choice, none chosen',
    (_name, chips, labels) => {
      const views = chips(noFilters);

      expect(views.map(({ label }) => label)).toEqual(labels);
      expect(
        views.every(({ selected, disabled }) => !selected && !disabled),
      ).toBe(true);
    },
  );

  it('links a chip to the address with it chosen, keeping the other filters', () => {
    const filters = { ...noFilters, guests: 4, setting: 'indoor' } as const;

    const [under, mid] = priceChips(filters);

    expect(under?.href).toBe(hrefForFilters({ ...filters, price: 'under-50' }));
    expect(mid?.href).toBe(
      '/new-york/browse?guests=4&price=50-to-100&setting=indoor',
    );
  });

  it('replaces the chosen choice when another is picked', () => {
    const chips = ageChips({ ...noFilters, age: 'kids' });

    expect(chips[1]?.href).toBe('/new-york/browse?age=twenty-one-plus');
  });

  it('links the chosen chip to the address without it, so choosing it again clears it', () => {
    const [chosen] = settingChips({ ...noFilters, setting: 'indoor' }).filter(
      ({ selected }) => selected,
    );

    expect(chosen).toMatchObject({ key: 'indoor', label: 'Indoor' });
    expect(chosen?.href).toBe('/new-york/browse');
  });
});
