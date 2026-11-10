import { describe, expect, it } from 'vitest';
import {
  calendarLoadFailedMessage,
  calendarLoadingMessage,
  drawerLoadFailedMessage,
  selectedChips,
} from './filterBar';
import { noFilters } from './filters';

const options = {
  categories: [
    { slug: 'cooking', name: 'Cooking' },
    { slug: 'wine', name: 'Wine' },
  ],
  neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
};

describe('selectedChips', () => {
  it('is empty when nothing is chosen', () => {
    expect(selectedChips(noFilters, options)).toEqual([]);
  });

  it('lists categories, then neighborhoods, then the party, each linking to the address without it', () => {
    const chips = selectedChips(
      {
        categories: ['cooking'],
        neighborhoods: ['dumbo'],
        date: null,
        guests: 4,
        price: null,
        age: null,
        setting: null,
      },
      options,
    );
    expect(chips.map(({ hint }) => hint)).toEqual([
      ', remove filter',
      ', remove filter',
      ', remove filter',
    ]);
    expect(chips.map(({ label, href }) => [label, href])).toEqual([
      ['Cooking', '/new-york/browse?neighborhood=dumbo&guests=4'],
      ['DUMBO', '/new-york/browse?category=cooking&guests=4'],
      ['4 guests', '/new-york/browse?category=cooking&neighborhood=dumbo'],
    ]);
  });

  it('lists price, age, and setting after the party, keyed by their group', () => {
    const chips = selectedChips(
      {
        ...noFilters,
        guests: 2,
        price: '100-plus',
        age: 'kids',
        setting: 'outdoor',
      },
      options,
    );
    expect(chips.map(({ key, label }) => [key, label])).toEqual([
      ['guests:2', '2 guests'],
      ['price:100-plus', '$100 and up'],
      ['age:kids', 'Kids welcome'],
      ['setting:outdoor', 'Outdoor'],
    ]);
    expect(chips[3]?.href).toBe(
      '/new-york/browse?guests=2&price=100-plus&age=kids',
    );
  });

  it('gives a category and a neighborhood with one slug different keys', () => {
    const chips = selectedChips(
      { ...noFilters, categories: ['kids'], neighborhoods: ['kids'] },
      {
        categories: [{ slug: 'kids', name: 'Kids' }],
        neighborhoods: [{ slug: 'kids', name: 'Kids Park' }],
      },
    );
    expect(new Set(chips.map(({ key }) => key)).size).toBe(2);
  });

  it('leaves out a slug the catalog has no option for', () => {
    expect(
      selectedChips({ ...noFilters, categories: ['gone'] }, options),
    ).toEqual([]);
  });
});

describe('drawerLoadFailedMessage', () => {
  it('says the filters could not load and that trying again is possible', () => {
    expect(drawerLoadFailedMessage()).toBe(
      'Filters could not load. Try again.',
    );
  });
});

describe('the calendar messages', () => {
  it('says the calendar is loading', () => {
    expect(calendarLoadingMessage()).toBe('Loading calendar');
  });

  it('says the calendar could not load and that closing and opening it tries again', () => {
    expect(calendarLoadFailedMessage()).toBe(
      'The calendar could not load. Close it and try again.',
    );
  });
});
