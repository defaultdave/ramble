import '@testing-library/jest-dom/vitest';
import { cleanup, screen } from '@testing-library/react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - the server markup carries a day form and every chip group inside <noscript>, so a browser with scripting off can use them
// - the price, age, and indoor or outdoor groups are there too, and the day form keeps what is chosen in them
// - the day form is a GET form to the browse address that carries the other filters and not the day
// - the form offers the chosen day, and none when no day is chosen
// - the chip groups link to the address with that chip turned on, and a chosen chip links to the address without it

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const options = {
  categories: [
    { slug: 'cooking', name: 'Cooking' },
    { slug: 'wine', name: 'Wine' },
  ],
  neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
};

function renderNoScript(filters: BrowseFilters) {
  const markup = renderToStaticMarkup(
    <FilterBar
      {...options}
      filters={filters}
      today="2026-11-01"
      availableDates={[]}
      onPickDate={() => undefined}
    />,
  );
  const inner = /<noscript>(.*)<\/noscript>/s.exec(markup)?.[1];
  document.body.innerHTML = inner ?? '';
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = '';
});

describe('the filters shown with scripting off', () => {
  it('holds a day form and every chip group', () => {
    renderNoScript(noFilters);

    expect(screen.getByRole('form', { name: 'Choose a day' })).toBeVisible();
    for (const name of [
      'Guests',
      'Neighborhood',
      'Category',
      'Price',
      'Age',
      'Indoor or outdoor',
    ]) {
      expect(screen.getByRole('group', { name })).toBeVisible();
    }
  });

  it('sends the day to the browse address by GET, with the other filters kept and the day left to the field', () => {
    renderNoScript({
      ...noFilters,
      categories: ['cooking'],
      neighborhoods: ['dumbo'],
      guests: 3,
      price: 'under-50',
      age: 'kids',
      setting: 'indoor',
      date: '2026-11-07',
    });

    const form = screen.getByRole('form', { name: 'Choose a day' });
    expect(form).toHaveAttribute('action', '/new-york/browse');
    expect(form).toHaveAttribute('method', 'get');
    const sent = Array.from(form.querySelectorAll('input')).map((input) => [
      input.name,
      input.value,
    ]);
    expect(sent).toEqual([
      ['category', 'cooking'],
      ['neighborhood', 'dumbo'],
      ['guests', '3'],
      ['price', 'under-50'],
      ['age', 'kids'],
      ['setting', 'indoor'],
      ['date', '2026-11-07'],
    ]);
  });

  it('leaves the day empty when none is chosen', () => {
    renderNoScript(noFilters);

    expect(screen.getByLabelText('When')).toHaveValue('');
  });

  it('links each chip to the address with that chip turned on, or off when it is chosen', () => {
    renderNoScript({ ...noFilters, categories: ['cooking'] });

    expect(screen.getByRole('link', { name: 'Wine' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking&category=wine',
    );
    expect(screen.getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'href',
      '/new-york/browse',
    );
  });
});
