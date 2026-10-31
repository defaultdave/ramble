import '@testing-library/jest-dom/vitest';
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { maxFilterValues, noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar, type FilterBarProps } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - the row holds the Filters chip, the date chip, the chosen chips, Neighborhood and Guests, and no list of options
// - Filters shows the number of chosen filters, and nothing when none
// - a chosen chip is in the row and links to the address without it, also when its list is full
// - the bar offers no Clear all filters, which the empty state owns
// - Filters, Neighborhood and Guests open the drawer with every group; a keyboard opens and closes it and focus returns
// - the drawer's Clear all goes to the bare address and Show results closes it; a modified click is left to the browser
// - with no script the chips are links to a panel with every group, and the day goes in a plain GET form
// - the date chip shows the chosen day or "Pick a date"; the calendar opens, picks, clears, and closes on Escape or a press outside
// - when the chosen day changes the calendar closes and focus returns to the date chip, without remounting it; the same day changes nothing
// - a chosen chip that clears itself hands focus to the Filters chip, not the page

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));

const categories = [
  { slug: 'cooking', name: 'Cooking' },
  { slug: 'walking-tours', name: 'Walking tours' },
];
const neighborhoods = [
  { slug: 'dumbo', name: 'DUMBO' },
  { slug: 'bushwick', name: 'Bushwick' },
];
const baseProps = {
  categories,
  neighborhoods,
  today: '2026-10-26',
  availableDates: ['2026-10-26', '2026-11-07', '2026-11-08'],
};

const row = () => within(screen.getByRole('group', { name: 'Quick filters' }));

function setup(filters: BrowseFilters = noFilters) {
  const onPickDate = vi.fn();
  const { container } = render(
    <FilterBar {...baseProps} filters={filters} onPickDate={onPickDate} />,
  );
  const details = container.querySelector('details');
  if (!details) throw new Error('No calendar disclosure');
  return { onPickDate, details };
}

function bar(filters: BrowseFilters): React.ReactElement<FilterBarProps> {
  return <FilterBar {...baseProps} filters={filters} onPickDate={vi.fn()} />;
}

describe('the row', () => {
  it('holds the Filters, Neighborhood and Guests chips and the date chip, and no list of options', () => {
    setup();
    expect(
      row()
        .getAllByRole('link')
        .map((link) => link.textContent),
    ).toEqual(['Filters', 'Neighborhood', 'Guests']);
    expect(row().getByText('Pick a date')).toBeVisible();
  });

  it.each([
    [noFilters, /^Filters$/],
    [{ ...noFilters, categories: ['cooking'], guests: 2 }, /^Filters2$/],
    [{ ...noFilters, date: '2026-11-07' }, /^Filters1$/],
  ])('shows the number of chosen filters on Filters (%#)', (filters, text) => {
    setup(filters);
    expect(row().getAllByRole('link')[0]).toHaveTextContent(text);
  });

  it('shows a chosen chip that links to the address without it, keeping the rest', () => {
    setup({
      ...noFilters,
      categories: ['cooking', 'walking-tours'],
      neighborhoods: ['dumbo'],
      guests: 4,
      date: '2026-11-07',
    });
    const cooking = row().getByRole('link', { name: 'Cooking' });
    expect(cooking).toHaveAttribute('aria-current', 'true');
    expect(cooking).toHaveAttribute(
      'href',
      '/new-york/browse?category=walking-tours&neighborhood=dumbo&date=2026-11-07&guests=4',
    );
    expect(row().getByRole('link', { name: '4 guests' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking&category=walking-tours&neighborhood=dumbo&date=2026-11-07',
    );
  });

  it('keeps a chosen chip linked when its list is full', () => {
    const full = Array.from(
      { length: maxFilterValues },
      (_, i) => `category-${String(i)}`,
    );
    setup({
      ...noFilters,
      categories: ['cooking', ...full].slice(0, maxFilterValues),
    });
    expect(row().getByRole('link', { name: 'Cooking' })).toHaveAttribute(
      'href',
    );
  });

  it('never offers Clear all filters, which the empty state owns', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    expect(
      screen.queryByRole('link', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });
});

describe('the drawer', () => {
  it.each(['Filters', 'Neighborhood', 'Guests'])(
    'opens from %s with every group',
    async (name) => {
      setup();
      await userEvent.click(row().getByRole('link', { name }));
      const dialog = screen.getByRole('dialog', { name: 'Filters' });
      for (const group of ['When', 'Guests', 'Neighborhood', 'Category']) {
        expect(
          within(dialog).getByRole('group', { name: group }),
        ).toBeVisible();
      }
      expect(
        within(dialog).getByRole('link', { name: 'DUMBO' }),
      ).toHaveAttribute('href', '/new-york/browse?neighborhood=dumbo');
      expect(
        within(dialog).getByRole('link', { name: '3 guests' }),
      ).toHaveAttribute('href', '/new-york/browse?guests=3');
    },
  );

  it('opens and closes by keyboard, and gives focus back to the chip that opened it', async () => {
    setup();
    const chip = row().getByRole('link', { name: 'Neighborhood' });
    chip.focus();
    await userEvent.keyboard('{Enter}');
    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    await waitFor(() => {
      expect(dialog).toContainElement(document.activeElement as HTMLElement);
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(chip).toHaveFocus();
    });
  });

  it('sends Clear all to the bare address and closes on Show results', async () => {
    setup({ ...noFilters, categories: ['cooking'] });
    await userEvent.click(row().getByRole('link', { name: /^Filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(push).toHaveBeenCalledExactlyOnceWith('/new-york/browse');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(row().getByRole('link', { name: /^Filters/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('leaves a modified click to the browser, so the link opens its panel', () => {
    setup();
    fireEvent.click(row().getByRole('link', { name: 'Filters' }), {
      ctrlKey: true,
    });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('with no script', () => {
  it('points each chip at its group in a panel that has every group', () => {
    const html = renderToStaticMarkup(
      bar({ ...noFilters, categories: ['cooking'] }),
    );
    for (const id of ['filters', 'filters-neighborhoods', 'filters-guests']) {
      expect(html).toContain(`href="#${id}"`);
      expect(html).toContain(`id="${id}"`);
    }
    expect(html).toContain('Walking tours');
    expect(html).toContain('Show results');
  });

  it('sends the day in a GET form that keeps the other filters', () => {
    const html = renderToStaticMarkup(
      bar({ ...noFilters, categories: ['cooking'], date: '2026-11-07' }),
    );
    expect(html).toContain('method="get"');
    expect(html).toContain('action="/new-york/browse"');
    expect(html).toMatch(/name="category"[^>]*value="cooking"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*min="2026-10-26"/);
    expect(html).toMatch(/<input[^>]*type="date"[^>]*name="date"/);
    expect(html).not.toMatch(/type="hidden"[^>]*name="date"/);
  });
});

describe('the date chip', () => {
  it('shows "Pick a date" with the calendar closed', () => {
    const { details } = setup();
    expect(row().getByText('Pick a date')).not.toHaveAttribute('aria-current');
    expect(details.open).toBe(false);
  });

  it('shows the chosen day on a chip marked as chosen', () => {
    setup({ ...noFilters, date: '2026-11-07' });
    expect(row().getByText('Sat, Nov 7')).toHaveAttribute(
      'aria-current',
      'true',
    );
  });

  it('opens the calendar from the chip', async () => {
    const { details } = setup();
    await userEvent.click(screen.getByText('Pick a date'));
    expect(details.open).toBe(true);
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
  });

  it('closes the calendar on Escape and returns focus to the chip', async () => {
    const { details } = setup();
    await userEvent.click(screen.getByText('Pick a date'));
    await userEvent.keyboard('{Escape}');
    expect(details.open).toBe(false);
    expect(screen.getByText('Pick a date')).toHaveFocus();
  });

  it('closes the calendar on a press outside it', async () => {
    const { details } = setup();
    await userEvent.click(screen.getByText('Pick a date'));
    await userEvent.click(document.body);
    expect(details.open).toBe(false);
  });

  it('closes the calendar and focuses the chip when the chosen day changes', async () => {
    const { rerender, container } = render(bar(noFilters));
    const details = container.querySelector('details');
    if (!details) throw new Error('No calendar disclosure');
    await userEvent.click(screen.getByText('Pick a date'));
    expect(details.open).toBe(true);

    rerender(bar({ ...noFilters, date: '2026-11-07' }));

    expect(container.querySelector('details')).toBe(details);
    expect(details.open).toBe(false);
    expect(screen.getByText('Sat, Nov 7')).toHaveFocus();
  });

  it('leaves the calendar and focus alone when the day has not changed', async () => {
    const filters = { ...noFilters, date: '2026-11-07' };
    const { rerender, container } = render(bar(filters));
    await userEvent.click(screen.getByText('Sat, Nov 7'));
    rerender(bar({ ...filters, categories: ['cooking'] }));
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
    await userEvent.click(row().getByText('Wed, Jan 1'));
    expect(screen.getByRole('grid', { name: /Choose a date/ })).toBeVisible();
  });

  it('links Clear date to the address without the day, only when a day is chosen', async () => {
    setup({ ...noFilters, categories: ['cooking'], date: '2026-11-07' });
    await userEvent.click(row().getByText('Sat, Nov 7'));
    expect(row().getByRole('link', { name: 'Clear date' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking',
    );
  });

  it('has no Clear date when no day is chosen', async () => {
    setup();
    await userEvent.click(row().getByText('Pick a date'));
    expect(
      row().queryByRole('link', { name: 'Clear date' }),
    ).not.toBeInTheDocument();
  });
});

describe('focus when a chosen chip clears itself', () => {
  it('goes to the Filters chip, not the page', () => {
    const { rerender } = render(bar({ ...noFilters, categories: ['cooking'] }));
    row().getByRole('link', { name: 'Cooking' }).focus();
    rerender(bar(noFilters));
    expect(row().getAllByRole('link')[0]).toHaveFocus();
  });
});
