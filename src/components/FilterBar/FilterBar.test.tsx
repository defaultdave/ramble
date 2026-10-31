import '@testing-library/jest-dom/vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { maxFilterValues, noFilters, type BrowseFilters } from '@/lib/filters';
import { FilterBar, type FilterBarProps } from './FilterBar';

// Behaviours under test, one per decision, branch or risk:
// - the row holds the Filters button, the date chip, the chosen chips, Neighborhood and Guests, and no list of options
// - Filters shows the number of chosen filters, and nothing when none
// - a chosen chip is a link to the address without it, says it removes the filter, and stays linked when its list is full
// - Neighborhood and Guests are offered only while that filter is empty
// - the bar offers no Clear all filters, which the empty state owns
// - the drawer is not mounted until opened; it opens from the three buttons with every group, by keyboard too
// - Clear all goes to the bare address; Show results and Escape close it; focus goes to the Filters button after any close
// - a chip that takes focus is scrolled into view in the row
// - a chosen chip that clears itself hands focus to Filters; history moves that remove nothing focused leave focus alone
// - the date chip shows the chosen day or "Pick a date"; the calendar opens, picks, clears, and closes on Escape or a press outside
// - a changed day closes the calendar, and moves focus only when it was in the calendar or on the page; the same day changes nothing

// jsdom has no layout, so it has nothing to scroll.
const scrollIntoView = vi.fn();
Element.prototype.scrollIntoView = scrollIntoView;

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
const filtersButton = () => row().getByRole('button', { name: /^Filters/ });

function bar(filters: BrowseFilters): React.ReactElement<FilterBarProps> {
  return <FilterBar {...baseProps} filters={filters} onPickDate={vi.fn()} />;
}

function setup(filters: BrowseFilters = noFilters) {
  const onPickDate = vi.fn();
  const { container } = render(
    <FilterBar {...baseProps} filters={filters} onPickDate={onPickDate} />,
  );
  const details = container.querySelector('details');
  if (!details) throw new Error('No calendar disclosure');
  return { onPickDate, details };
}

async function openDrawer(name: string | RegExp = /^Filters/) {
  await userEvent.click(row().getByRole('button', { name }));
  const dialog = await screen.findByRole('dialog', { name: 'Filters' });
  await waitFor(() => {
    expect(dialog).toContainElement(document.activeElement as HTMLElement);
  });
  return dialog;
}

describe('the row', () => {
  it('holds Filters, the date chip, Neighborhood and Guests, and no list of options', () => {
    setup();
    for (const name of ['Filters', 'Neighborhood', 'Guests']) {
      expect(
        row().getByRole('button', { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
    }
    expect(row().getByText('Pick a date')).toBeVisible();
    expect(row().queryAllByRole('link')).toEqual([]);
  });

  it.each([
    [noFilters, /^Filters$/],
    [{ ...noFilters, categories: ['cooking'], guests: 2 }, /^Filters2$/],
    [{ ...noFilters, date: '2026-11-07' }, /^Filters1$/],
  ])('shows the number of chosen filters on Filters (%#)', (filters, text) => {
    setup(filters);
    expect(filtersButton()).toHaveTextContent(text);
  });

  it('shows a chosen chip that links to the address without it, keeping the rest', () => {
    setup({
      ...noFilters,
      categories: ['cooking', 'walking-tours'],
      neighborhoods: ['dumbo'],
      guests: 4,
      date: '2026-11-07',
    });
    const cooking = row().getByRole('link', { name: /^Cooking/ });
    expect(cooking).toHaveAttribute('aria-current', 'true');
    expect(cooking).toHaveAttribute(
      'href',
      '/new-york/browse?category=walking-tours&neighborhood=dumbo&date=2026-11-07&guests=4',
    );
    expect(row().getByRole('link', { name: /^4 guests/ })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking&category=walking-tours&neighborhood=dumbo&date=2026-11-07',
    );
  });

  it('says that a chosen chip removes its filter, after the words on screen', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    expect(
      row().getByRole('link', { name: 'Cooking, remove filter' }),
    ).toBeVisible();
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
    expect(row().getByRole('link', { name: /^Cooking/ })).toHaveAttribute(
      'href',
    );
  });

  it.each([
    [{ ...noFilters, neighborhoods: ['dumbo'] }, 'Neighborhood', 'Guests'],
    [{ ...noFilters, guests: 3 }, 'Guests', 'Neighborhood'],
  ])(
    'leaves out the opener of a filter that is already chosen (%#)',
    (filters, gone, kept) => {
      setup(filters);
      expect(
        row().queryByRole('button', { name: gone }),
      ).not.toBeInTheDocument();
      expect(row().getByRole('button', { name: kept })).toBeVisible();
    },
  );

  it('never offers Clear all filters, which the empty state owns', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    expect(
      screen.queryByRole('link', { name: 'Clear all filters' }),
    ).not.toBeInTheDocument();
  });
});

describe('the drawer', () => {
  it('is not mounted until it is opened', () => {
    setup();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'DUMBO' }),
    ).not.toBeInTheDocument();
  });

  it.each(['Filters', 'Neighborhood', 'Guests'])(
    'opens from %s with every group',
    async (name) => {
      setup();
      const dialog = await openDrawer(name);
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

  it('opens by keyboard and closes on Escape, with focus on Filters', async () => {
    setup();
    row().getByRole('button', { name: 'Neighborhood' }).focus();
    await userEvent.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Filters' });
    await waitFor(() => {
      expect(screen.getByRole('dialog')).toContainElement(
        document.activeElement as HTMLElement,
      );
    });
    await userEvent.keyboard('{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
    await waitFor(() => {
      expect(filtersButton()).toHaveFocus();
    });
  });

  it('closes on Show results, and Clear all goes to the bare address', async () => {
    setup({ ...noFilters, categories: ['cooking'] });
    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });

    await openDrawer();
    await userEvent.click(screen.getByRole('button', { name: 'Clear all' }));
    expect(push).toHaveBeenCalledExactlyOnceWith('/new-york/browse');
    await waitFor(() => {
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    });
  });
});

describe('focus when a chosen chip clears itself', () => {
  it('scrolls a chip that takes focus into view', () => {
    setup({ ...noFilters, categories: ['cooking'] });
    row()
      .getByRole('link', { name: /^Cooking/ })
      .focus();
    expect(scrollIntoView).toHaveBeenCalledWith({
      block: 'nearest',
      inline: 'nearest',
    });
  });

  it('goes to Filters, not the page', async () => {
    const { rerender } = render(bar({ ...noFilters, categories: ['cooking'] }));
    row()
      .getByRole('link', { name: /^Cooking/ })
      .focus();
    rerender(bar(noFilters));
    await waitFor(() => {
      expect(filtersButton()).toHaveFocus();
    });
  });

  it('is left alone when the filters change and the focused chip is still there', () => {
    const { rerender } = render(bar({ ...noFilters, categories: ['cooking'] }));
    row()
      .getByRole('link', { name: /^Cooking/ })
      .focus();
    (document.activeElement as HTMLElement).blur();
    rerender(bar({ ...noFilters, categories: ['cooking'], guests: 2 }));
    expect(document.body).toHaveFocus();
  });

  it('is left alone when focus is somewhere else on the page', () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        {bar({ ...noFilters, categories: ['cooking'] })}
      </>,
    );
    row()
      .getByRole('link', { name: /^Cooking/ })
      .focus();
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    rerender(
      <>
        <button type="button">Elsewhere</button>
        {bar(noFilters)}
      </>,
    );
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
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

  it('closes the calendar and focuses the chip when the chosen day changes and focus was in the calendar', async () => {
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

  it('closes the calendar but leaves focus where it is when the day changes from elsewhere on the page', () => {
    const { rerender } = render(
      <>
        <button type="button">Elsewhere</button>
        {bar(noFilters)}
      </>,
    );
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    rerender(
      <>
        <button type="button">Elsewhere</button>
        {bar({ ...noFilters, date: '2026-11-07' })}
      </>,
    );
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
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
