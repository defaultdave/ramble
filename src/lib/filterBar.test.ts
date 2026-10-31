import { describe, expect, it } from 'vitest';
import { selectedChips } from './filterBar';
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
      },
      options,
    );
    expect(chips.map(({ label, href }) => [label, href])).toEqual([
      ['Cooking', '/new-york/browse?neighborhood=dumbo&guests=4'],
      ['DUMBO', '/new-york/browse?category=cooking&guests=4'],
      ['4 guests', '/new-york/browse?category=cooking&neighborhood=dumbo'],
    ]);
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
