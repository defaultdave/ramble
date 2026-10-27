import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { maxFilterValues, noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar, type FilterBarProps } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - the three groups are labelled and each chip says whether it is chosen
// - choosing a chip writes the address with it added, and keeps what else is chosen
// - choosing a chosen chip takes it off
// - a full list disables the chips that are not chosen and keeps the chosen ones usable
// - the date chip shows the chosen day, opens the calendar, and says it is open
// - a day in the address that has passed does not break the calendar
// - picking a day writes it into the address and closes the calendar; clearing the date takes it off
// - Clear all filters is there only when a filter is on, and goes to the bare address

const push = vi.hoisted(() => vi.fn());
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

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
  render(
    <FilterBar
      categories={categories}
      neighborhoods={neighborhoods}
      filters={filters}
      today="2026-10-26"
      availableDates={['2026-10-26', '2026-11-07', '2026-11-08']}
      {...overrides}
    />,
  );
}

beforeEach(() => {
  push.mockClear();
});

describe('FilterBar', () => {
  it('labels the three groups', () => {
    setup();
    for (const name of ['When', 'Neighborhood', 'Category']) {
      expect(screen.getByRole('group', { name })).toBeVisible();
    }
  });

  it('marks the chosen chips as pressed', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    expect(screen.getByRole('button', { name: 'Cooking' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      screen.getByRole('button', { name: 'Walking tours' }),
    ).toHaveAttribute('aria-pressed', 'false');
  });

  it('adds a chip to the address and keeps the rest', async () => {
    setup({ ...noFilters, categories: ['cooking'], date: '2026-11-07' });
    await userEvent.click(screen.getByRole('button', { name: 'DUMBO' }));
    expect(push).toHaveBeenCalledExactlyOnceWith(
      '/new-york/browse?category=cooking&neighborhood=dumbo&date=2026-11-07',
    );
  });

  it('takes a chosen chip off', async () => {
    setup({ ...noFilters, categories: ['cooking', 'walking-tours'] });
    await userEvent.click(screen.getByRole('button', { name: 'Cooking' }));
    expect(push).toHaveBeenCalledExactlyOnceWith(
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
    expect(screen.getByRole('button', { name: 'Cooking' })).toBeEnabled();
    expect(
      screen.getByRole('button', { name: 'Walking tours' }),
    ).toBeDisabled();
    expect(screen.getByRole('button', { name: 'DUMBO' })).toBeEnabled();
  });

  it('shows "Pick a date" with the calendar closed', () => {
    setup();
    const chip = screen.getByRole('button', { name: 'Pick a date' });
    expect(chip).toHaveAttribute('aria-expanded', 'false');
    expect(chip).toHaveAttribute('aria-pressed', 'false');
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('shows the chosen day on the chip', () => {
    setup({ ...noFilters, date: '2026-11-07' });
    expect(screen.getByRole('button', { name: 'Sat, Nov 7' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
  });

  it('opens the calendar from the date chip', async () => {
    setup();
    const chip = screen.getByRole('button', { name: 'Pick a date' });
    await userEvent.click(chip);
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
    expect(chip).toHaveAttribute('aria-controls');
  });

  it('writes the picked day and closes the calendar', async () => {
    setup({ ...noFilters, categories: ['cooking'] });
    await userEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
    const [next] = screen.getAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    await userEvent.click(
      screen.getByRole('button', { name: /Saturday, November 7, 2026/ }),
    );
    expect(push).toHaveBeenCalledExactlyOnceWith(
      '/new-york/browse?category=cooking&date=2026-11-07',
    );
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();
  });

  it('takes the date off from the calendar', async () => {
    setup({ ...noFilters, date: '2026-11-07' });
    await userEvent.click(screen.getByRole('button', { name: 'Sat, Nov 7' }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear date' }));
    expect(push).toHaveBeenCalledExactlyOnceWith('/new-york/browse');
  });

  it('still opens the calendar when the address names a day that has passed', async () => {
    setup({ ...noFilters, date: '2020-01-01' });
    await userEvent.click(screen.getByRole('button', { name: 'Wed, Jan 1' }));
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
    expect(screen.getByRole('button', { name: 'Clear date' })).toBeVisible();
  });

  it('has no Clear date when no date is chosen', async () => {
    setup();
    await userEvent.click(screen.getByRole('button', { name: 'Pick a date' }));
    expect(
      screen.queryByRole('button', { name: 'Clear date' }),
    ).not.toBeInTheDocument();
  });

  it('has no Clear all filters when nothing is chosen', () => {
    setup();
    expect(
      screen.queryByRole('button', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });

  it('clears everything to the bare address', async () => {
    setup({
      categories: ['cooking'],
      neighborhoods: ['dumbo'],
      date: '2026-11-07',
    });
    await userEvent.click(
      screen.getByRole('button', { name: 'Clear all filters' }),
    );
    expect(push).toHaveBeenCalledExactlyOnceWith('/new-york/browse');
  });
});
