import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - the bar has a search form: a GET to the browse address with a `q` field, outside the <noscript>, so it works with scripting on or off
// - the field shows the words in the address, and is empty when there are none
// - the form keeps the other filters as hidden fields and never repeats the search or the cursor

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

function renderBar(filters: BrowseFilters) {
  return render(
    <FilterBar
      categories={[{ slug: 'cooking', name: 'Cooking' }]}
      neighborhoods={[]}
      filters={filters}
      today="2026-11-01"
      availableDates={[]}
      onPickDate={() => undefined}
    />,
  );
}

describe('the keyword search in the filter bar', () => {
  it('is a GET form to the browse address with a search field', () => {
    renderBar(noFilters);

    const field = screen.getByRole('searchbox', { name: 'Search' });
    expect(field).toHaveAttribute('name', 'q');
    const form = field.closest('form');
    expect(form).toHaveAttribute('method', 'get');
    expect(form).toHaveAttribute('action', '/new-york/browse');
  });

  it('is not inside the noscript, so it needs no script either way', () => {
    const markup = renderToStaticMarkup(
      <FilterBar
        categories={[]}
        neighborhoods={[]}
        filters={noFilters}
        today="2026-11-01"
        availableDates={[]}
        onPickDate={() => undefined}
      />,
    );

    expect(markup.replace(/<noscript>.*<\/noscript>/s, '')).toContain(
      'type="search"',
    );
  });

  it.each([
    [null, ''],
    ['wine tasting', 'wine tasting'],
  ])('shows %j as %j', (search, shown) => {
    renderBar({ ...noFilters, search });

    expect(screen.getByRole('searchbox')).toHaveValue(shown);
  });

  it('keeps the other filters and leaves out the search', () => {
    renderBar({
      ...noFilters,
      categories: ['cooking'],
      guests: 3,
      search: 'wine',
    });

    const hidden = Array.from(
      screen
        .getByRole('searchbox', { name: 'Search' })
        .closest('form')
        ?.querySelectorAll<HTMLInputElement>('input[type="hidden"]') ?? [],
    ).map((input) => [input.name, input.value]);
    expect(hidden).toEqual([
      ['category', 'cooking'],
      ['guests', '3'],
    ]);
  });
});
