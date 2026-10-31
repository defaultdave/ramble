import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { maxFilterValues, noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar, type FilterBarProps } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - a party chip links to that party, and the chosen one links to the address without it
// - the three groups are labelled and each chip says whether it is chosen
// - a chip links to the address with it added, keeping what else is chosen; a chosen chip links to the address without it
// - a full list disables the chips that are not chosen, without an address, and keeps the chosen ones linked
// - the date chip shows the chosen day and is marked chosen; with no day it says "Pick a date"
// - the calendar is closed until the date chip is opened
// - a day in the address that has passed does not break the calendar
// - when the chosen day changes the calendar closes and focus returns to the date chip, without remounting it; the same day changes nothing
// - picking a day hands it to the route's action
// - Clear date is there only when a day is chosen, and links to the address without it
// - Clear all filters is there only when a filter is on, and links to the bare address

const categories = [
  { slug: 'cooking', name: 'Cooking' },
  { slug: 'walking-tours', name: 'Walking tours' },
];
const neighborhoods = [
  { slug: 'dumbo', name: 'DUMBO' },
  { slug: 'bushwick', name: 'Bushwick' },
];

function setup(
  filters: BrowseFilters = noFilters,
  overrides: Partial<FilterBarProps> = {},
) {
  const onPickDate = vi.fn();
  const { container } = render(
    <FilterBar
      categories={categories}
      neighborhoods={neighborhoods}
      filters={filters}
      today="2026-10-26"
      availableDates={['2026-10-26', '2026-11-07', '2026-11-08']}
      onPickDate={onPickDate}
      {...overrides}
    />,
  );
  const details = container.querySelector('details');
  if (!details) throw new Error('No calendar disclosure');
  return { onPickDate, details };
}

describe('FilterBar', () => {
  it('labels the three groups', () => {
    setup();
    for (const name of ['When', 'Guests', 'Neighborhood', 'Category']) {
      expect(screen.getByRole('group', { name })).toBeVisible();
    }
  });

  it('marks the chosen chips as current', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    expect(screen.getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'aria-current',
      'true',
    );
    expect(
      screen.getByRole('link', { name: 'Walking tours' }),
    ).not.toHaveAttribute('aria-current');
  });

  it('offers a chip for each party, marks the chosen one, and links it off', () => {
    setup({ ...noFilters, guests: 4 });
    const group = screen.getByRole('group', { name: 'Guests' });
    const chips = within(group).getAllByRole('link');
    expect(chips.map((chip) => chip.textContent)).toEqual([
      '1 guest',
      '2 guests',
      '3 guests',
      '4 guests',
      '5 guests',
      '6 guests',
    ]);
    expect(
      within(group).getByRole('link', { name: '4 guests' }),
    ).toHaveAttribute('aria-current', 'true');
    expect(
      within(group).getByRole('link', { name: '4 guests' }),
    ).toHaveAttribute('href', '/new-york/browse');
    expect(
      within(group).getByRole('link', { name: '2 guests' }),
    ).toHaveAttribute('href', '/new-york/browse?guests=2');
  });

  it('shows Clear all filters when only a party is chosen, and links it to the bare address', () => {
    setup({ ...noFilters, guests: 2 });
    expect(
      screen.getByRole('link', { name: 'Clear all filters' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('links a chip to the address with it added, keeping the rest', () => {
    setup({ ...noFilters, categories: ['cooking'], date: '2026-11-07' });
    expect(screen.getByRole('link', { name: 'DUMBO' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking&neighborhood=dumbo&date=2026-11-07',
    );
  });

  it('links a chosen chip to the address without it', () => {
    setup({ ...noFilters, categories: ['cooking', 'walking-tours'] });
    expect(screen.getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=walking-tours',
    );
  });

  it('disables the chips that are not chosen when a list is full', () => {
    const full = Array.from(
      { length: maxFilterValues },
      (_, i) => `category-${String(i)}`,
    );
    setup({
      ...noFilters,
      categories: ['cooking', ...full].slice(0, maxFilterValues),
    });
    expect(screen.getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'href',
    );
    const blocked = screen.getByRole('link', { name: 'Walking tours' });
    expect(blocked).toHaveAttribute('aria-disabled', 'true');
    expect(blocked).not.toHaveAttribute('href');
    expect(screen.getByRole('link', { name: 'DUMBO' })).toHaveAttribute('href');
  });

  it('shows "Pick a date" with the calendar closed', () => {
    const { details } = setup();
    const chip = screen.getByText('Pick a date');
    expect(chip).not.toHaveAttribute('aria-current');
    expect(details.open).toBe(false);
  });

  it('shows the chosen day on a chip marked as chosen', () => {
    setup({ ...noFilters, date: '2026-11-07' });
    expect(screen.getByText('Sat, Nov 7')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('opens the calendar from the date chip', async () => {
    const { details } = setup();
    await userEvent.click(screen.getByText('Pick a date'));
    expect(details.open).toBe(true);
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
  });

  it('closes the calendar and focuses the date chip when the chosen day changes', async () => {
    const props = {
      categories,
      neighborhoods,
      today: '2026-10-26',
      availableDates: ['2026-10-26', '2026-11-07'],
      onPickDate: vi.fn(),
    };
    const { rerender, container } = render(
      <FilterBar {...props} filters={noFilters} />,
    );
    const details = container.querySelector('details');
    if (!details) throw new Error('No calendar disclosure');
    await userEvent.click(screen.getByText('Pick a date'));
    expect(details.open).toBe(true);

    rerender(
      <FilterBar {...props} filters={{ ...noFilters, date: '2026-11-07' }} />,
    );

    expect(container.querySelector('details')).toBe(details);
    expect(details.open).toBe(false);
    expect(screen.getByText('Sat, Nov 7')).toHaveFocus();
  });

  it('leaves the calendar and focus alone when the day has not changed', async () => {
    const props = {
      categories,
      neighborhoods,
      today: '2026-10-26',
      availableDates: ['2026-10-26', '2026-11-07'],
      onPickDate: vi.fn(),
    };
    const filters = { ...noFilters, date: '2026-11-07' };
    const { rerender, container } = render(
      <FilterBar {...props} filters={filters} />,
    );
    await userEvent.click(screen.getByText('Sat, Nov 7'));
    rerender(
      <FilterBar
        {...props}
        filters={{ ...filters, categories: ['cooking'] }}
      />,
    );
    expect(container.querySelector('details')?.open).toBe(true);
  });

  it('hands the picked day to the route', async () => {
    const { onPickDate } = setup({ ...noFilters, categories: ['cooking'] });
    await userEvent.click(screen.getByText('Pick a date'));
    const [next] = screen.getAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    await userEvent.click(
      screen.getByRole('button', { name: /Saturday, November 7, 2026/ }),
    );
    expect(onPickDate).toHaveBeenCalledExactlyOnceWith('2026-11-07');
  });

  it('still opens the calendar when the address names a day that has passed', async () => {
    setup({ ...noFilters, date: '2020-01-01' });
    await userEvent.click(screen.getByText('Wed, Jan 1'));
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
    expect(screen.getByRole('link', { name: 'Clear date' })).toBeVisible();
  });

  it('links Clear date to the address without the day', () => {
    setup({ ...noFilters, categories: ['cooking'], date: '2026-11-07' });
    expect(screen.getByRole('link', { name: 'Clear date' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking',
    );
  });

  it('has no Clear date when no date is chosen', () => {
    setup();
    expect(
      screen.queryByRole('link', { name: 'Clear date' }),
    ).not.toBeInTheDocument();
  });

  it('has no Clear all filters when nothing is chosen', () => {
    setup();
    expect(
      screen.queryByRole('link', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });

  it('links Clear all filters to the bare address', () => {
    setup({
      categories: ['cooking'],
      neighborhoods: ['dumbo'],
      date: '2026-11-07',
      guests: null,
    });
    expect(
      screen.getByRole('link', { name: 'Clear all filters' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });
});
