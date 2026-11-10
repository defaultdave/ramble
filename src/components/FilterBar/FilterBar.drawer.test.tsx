import {
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { drawerLoadFailedMessage } from '@/lib/filterBar';
import { maxFilterValues, noFilters } from '@/lib/filters';
import {
  bar,
  calendarFetch,
  dateChip,
  deferredDrawer,
  drawerFetch,
  drawerStatus,
  filtersButton,
  openDrawer,
  push,
  real,
  row,
  scrollIntoView,
  setup,
} from './FilterBar.testkit';

// Behaviours under test, one per decision, branch or risk:
// - the row holds the Filters button, the date chip, the chosen chips, Neighborhood and Guests, and no list of options
// - Filters shows the number of chosen filters, and nothing when none
// - a chosen chip is a link to the address without it, says it removes the filter, and stays linked when its list is full
// - Neighborhood and Guests are offered only while that filter is empty
// - the bar offers no Clear all filters, which the empty state owns
// - the drawer is not mounted until opened; it opens from the three buttons with every group, by keyboard too
// - the drawer opens only once its code has arrived: the button is busy meanwhile and a second press does nothing
// - a failed fetch leaves it closed, says so, and a later press tries again
// - the drawer's code is fetched once when the browser is idle (after a timer where there is no idle callback), not at all when the guest saves data, and the fetch stops if the bar goes
// - a failed idle fetch says nothing, and the next press still opens the drawer
// - a guest who pressed or focused elsewhere while it was arriving is not pulled into the dialog, and the watch for that is removed
// - Clear all goes to the bare address; Show results and Escape close it
// - after a close focus goes to the button that opened it, or to Filters when that button is gone
// - a chip that takes focus is scrolled into view in the row
// - a chosen chip that clears itself hands focus to Filters; history moves that remove nothing focused leave focus alone

describe('the row', () => {
  it('holds Filters, the date chip, Neighborhood and Guests, and no list of options', () => {
    setup();
    for (const name of ['Filters', 'Neighborhood', 'Guests']) {
      expect(
        row().getByRole('button', { name: new RegExp(`^${name}`) }),
      ).toBeVisible();
    }
    expect(dateChip()).toBeVisible();
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
      for (const group of [
        'When',
        'Guests',
        'Neighborhood',
        'Category',
        'Price',
        'Age',
        'Indoor or outdoor',
      ]) {
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

  it('opens by keyboard and closes on Escape, with focus on the button that opened it', async () => {
    setup();
    const neighborhood = row().getByRole('button', { name: 'Neighborhood' });
    neighborhood.focus();
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
      expect(neighborhood).toHaveFocus();
    });
  });

  it.each(['Filters', 'Guests'])(
    'gives focus back to %s after Show results',
    async (name) => {
      setup();
      await openDrawer(name);
      await userEvent.click(
        screen.getByRole('button', { name: 'Show results' }),
      );
      await waitFor(() => {
        expect(row().getByRole('button', { name })).toHaveFocus();
      });
    },
  );

  it('gives focus to Filters when the button that opened the drawer is gone', async () => {
    const { rerender } = render(bar(noFilters));
    await openDrawer('Guests');
    rerender(bar({ ...noFilters, guests: 2 }));
    await userEvent.click(screen.getByRole('button', { name: 'Show results' }));
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

describe('a drawer that has to be fetched', () => {
  it('stays closed and shows the button as busy until its code arrives, then opens once', async () => {
    const drawer = deferredDrawer();
    setup();
    await userEvent.click(filtersButton());
    expect(filtersButton()).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    await userEvent.click(filtersButton());
    drawer.finish();

    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
    expect(
      screen.getByRole('button', { name: /^Filters/, hidden: true }),
    ).not.toHaveAttribute('aria-busy');
  });

  it('stays closed, says so, and tries again on the next press when the fetch fails', async () => {
    const drawer = deferredDrawer();
    setup();
    await userEvent.click(filtersButton());
    drawer.fail(new Error('chunk failed'));

    await waitFor(() => {
      expect(drawerStatus()).toHaveTextContent(drawerLoadFailedMessage());
    });
    expect(drawerStatus()).toBeVisible();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(filtersButton()).not.toHaveAttribute('aria-busy');

    drawerFetch.mockImplementation(real.loadDrawer);
    await userEvent.click(filtersButton());
    expect(
      await screen.findByRole('dialog', { name: 'Filters' }),
    ).toBeVisible();
    expect(drawerStatus()).toBeEmptyDOMElement();
  });

  it.each([
    [
      'presses',
      () => userEvent.click(screen.getByRole('button', { name: 'Elsewhere' })),
    ],
    [
      'focuses',
      () => {
        screen.getByRole('button', { name: 'Elsewhere' }).focus();
        return Promise.resolve();
      },
    ],
  ])(
    'does not take focus from a guest who %s elsewhere while it arrives',
    async (_how, moveAway) => {
      const drawer = deferredDrawer();
      render(
        <>
          <button type="button">Elsewhere</button>
          {bar(noFilters)}
        </>,
      );
      await userEvent.click(filtersButton());
      await moveAway();
      drawer.finish();

      await waitFor(() => {
        expect(filtersButton()).not.toHaveAttribute('aria-busy');
      });
      expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
    },
  );
});

describe('the drawer fetched ahead of a press', () => {
  afterEach(() => {
    // Unmounting calls cancelIdleCallback, which the stubs must still be there to answer.
    cleanup();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    Reflect.deleteProperty(navigator, 'connection');
  });

  function idleQueue() {
    const queued: (() => void)[] = [];
    const cancel = vi.fn();
    vi.stubGlobal('requestIdleCallback', (callback: () => void) => {
      queued.push(callback);
      return queued.length;
    });
    vi.stubGlobal('cancelIdleCallback', cancel);
    return { queued, cancel };
  }

  it('fetches once when the browser is idle, and not before', () => {
    const { queued } = idleQueue();
    setup();
    expect(drawerFetch).not.toHaveBeenCalled();
    queued.forEach((run) => {
      run();
    });
    expect(drawerFetch).toHaveBeenCalledOnce();
    expect(calendarFetch).toHaveBeenCalledOnce();
  });

  it('fetches after a timer where the browser has no idle callback', () => {
    vi.stubGlobal('requestIdleCallback', undefined);
    vi.useFakeTimers();
    setup();
    vi.advanceTimersByTime(1000);
    expect(drawerFetch).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(drawerFetch).toHaveBeenCalledOnce();
  });

  it('does not fetch for a guest who saves data', () => {
    Object.defineProperty(navigator, 'connection', {
      value: { saveData: true },
      configurable: true,
    });
    const { queued } = idleQueue();
    setup();
    expect(queued).toHaveLength(0);
    expect(drawerFetch).not.toHaveBeenCalled();
    expect(calendarFetch).not.toHaveBeenCalled();
  });

  it('stops waiting when the bar goes', () => {
    const { cancel } = idleQueue();
    const { unmount } = render(bar(noFilters));
    unmount();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('says nothing when the fetch fails, and the press still opens the drawer', async () => {
    const { queued } = idleQueue();
    drawerFetch.mockRejectedValueOnce(new Error('chunk failed'));
    setup();
    queued.forEach((run) => {
      run();
    });
    await Promise.resolve();
    expect(drawerStatus()).toBeEmptyDOMElement();

    // The press brings the drawer up although the idle fetch failed.
    await openDrawer();
  });

  it('still shows the button as busy while a press waits on the fetch already under way', async () => {
    const { queued } = idleQueue();
    const drawer = deferredDrawer();
    setup();
    queued.forEach((run) => {
      run();
    });
    await userEvent.click(filtersButton());
    expect(filtersButton()).toHaveAttribute('aria-busy', 'true');
    drawer.finish();
    expect(await screen.findAllByRole('dialog')).toHaveLength(1);
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
