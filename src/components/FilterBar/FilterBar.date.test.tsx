import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Root } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import {
  calendarLoadFailedMessage,
  calendarLoadingMessage,
} from '@/lib/filterBar';
import { noFilters } from '@/lib/filters';
import { dateChipLabel } from '@/lib/pages/browse';
import {
  bar,
  calendarCard,
  calendarFetch,
  calendarHeld,
  calendarRegion,
  dateChip,
  deferredCalendar,
  disclosure,
  filtersButton,
  openDrawer,
  pickADate,
  real,
  row,
  setup,
} from './FilterBar.testkit';

// Behaviours under test, one per decision, branch or risk:
// - the date chip shows the chosen day or "Pick a date"; the calendar opens, picks, clears, and closes on Escape or a press outside
// - a calendar card fixed over the chip scrolls the page by the overlap; one that clears it or sits against the chip does not
// - a press on blank space forgets the focus a history change would then wrongly claim
// - the calendar's code is not fetched before the date disclosure opens, is fetched on its first open (row and drawer), and a press of the chip's neighbour fetches nothing
// - until it arrives a box the size of the month says it is loading; a failed fetch says so and the next open tries again; a calendar already held shows at once
// - the calendar arriving moves no focus, and puts the card clear of the chip again; a pick closes the disclosure, returns focus, and does not remount the calendar
// - hovering or focusing the date chip fetches the calendar; the idle warm-up fetches it with the drawer, and not for a guest who saves data
// - a changed day closes the calendar, and moves focus only when it was in the control; Back and Forward and the rest of the page leave it; the same day changes nothing

const chosenDay = '2026-11-07';
const chosenLabel = dateChipLabel(chosenDay);

describe('the date chip', () => {
  it('shows "Pick a date" with the calendar closed', () => {
    const { details } = setup();
    expect(dateChip()).not.toHaveAttribute('aria-current');
    expect(details.open).toBe(false);
  });

  it('shows the chosen day on a chip marked as chosen', () => {
    setup({ ...noFilters, date: chosenDay });
    expect(dateChip(chosenLabel)).toHaveAttribute('aria-current', 'true');
  });

  it('opens the calendar from the chip', async () => {
    const { details } = setup();
    await userEvent.click(dateChip());
    expect(details.open).toBe(true);
    expect(
      await screen.findByRole('grid', { name: /Choose a date/ }),
    ).toBeVisible();
  });

  it('closes the calendar on Escape and returns focus to the chip', async () => {
    const { details } = setup();
    await userEvent.click(dateChip());
    await userEvent.keyboard('{Escape}');
    expect(details.open).toBe(false);
    expect(dateChip()).toHaveFocus();
  });

  it('closes the calendar on a press outside it', async () => {
    const { details } = setup();
    await userEvent.click(dateChip());
    await userEvent.click(document.body);
    expect(details.open).toBe(false);
  });

  it('leaves focus on the page when the day changes by history after a press on blank space', async () => {
    const { rerender } = render(bar(noFilters));
    await userEvent.click(dateChip());
    await userEvent.click(document.body);
    rerender(bar({ ...noFilters, date: chosenDay }));
    expect(document.body).toHaveFocus();
  });

  it.each([
    [
      'moves the page so a card over the chip does not hide it',
      'fixed',
      300,
      290,
      18,
    ],
    [
      'leaves the page alone when the card clears the chip',
      'fixed',
      300,
      400,
      null,
    ],
    [
      'leaves the page alone when the card is placed against the chip',
      'absolute',
      300,
      290,
      null,
    ],
  ] as const)(
    '%s',
    async (_name, position, chipBottom, cardTop, scrolledBy) => {
      const scrollBy = vi.fn();
      vi.stubGlobal('scrollBy', scrollBy);
      const { details } = setup();
      const chip = dateChip();
      const card = calendarCard(details);
      card.style.position = position;
      chip.getBoundingClientRect = () => ({ bottom: chipBottom }) as DOMRect;
      card.getBoundingClientRect = () => ({ top: cardTop }) as DOMRect;
      await userEvent.click(chip);
      await waitFor(() => {
        expect(details.open).toBe(true);
      });
      if (scrolledBy === null) {
        // The calendar arriving is the last thing that can place the card again.
        await screen.findByRole('grid');
        expect(scrollBy).not.toHaveBeenCalled();
      } else {
        await waitFor(() => {
          expect(scrollBy).toHaveBeenCalledWith({ top: scrolledBy });
        });
      }
      vi.unstubAllGlobals();
    },
  );

  it('closes the calendar and focuses the chip when the chosen day changes and focus was in the calendar', async () => {
    const { rerender } = render(bar(noFilters));
    const details = disclosure();
    await userEvent.click(dateChip());
    expect(details.open).toBe(true);

    rerender(bar({ ...noFilters, date: chosenDay }));

    expect(disclosure()).toBe(details);
    expect(details.open).toBe(false);
    expect(dateChip(chosenLabel)).toHaveFocus();
  });

  it('leaves focus on the page when the day changes by Back or Forward', () => {
    const { rerender } = render(bar(noFilters));
    rerender(bar({ ...noFilters, date: chosenDay }));
    expect(document.body).toHaveFocus();
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
        {bar({ ...noFilters, date: chosenDay })}
      </>,
    );
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('leaves the calendar and focus alone when the day has not changed', async () => {
    const filters = { ...noFilters, date: chosenDay };
    const { rerender } = render(bar(filters));
    await userEvent.click(dateChip(chosenLabel));
    rerender(bar({ ...filters, categories: ['cooking'] }));
    expect(disclosure().open).toBe(true);
  });

  it('hands the picked day to the route', async () => {
    const { onPickDate } = setup({ ...noFilters, categories: ['cooking'] });
    await userEvent.click(dateChip());
    const [next] = await screen.findAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    await userEvent.click(
      screen.getByRole('button', { name: /Saturday, November 7, 2026/ }),
    );
    expect(onPickDate).toHaveBeenCalledExactlyOnceWith(chosenDay);
  });

  it('still opens the calendar when the address names a day that has passed', async () => {
    setup({ ...noFilters, date: '2020-01-01' });
    await userEvent.click(dateChip(dateChipLabel('2020-01-01')));
    expect(
      await screen.findByRole('grid', { name: /Choose a date/ }),
    ).toBeVisible();
  });

  it('links Clear date to the address without the day, only when a day is chosen', async () => {
    setup({ ...noFilters, categories: ['cooking'], date: chosenDay });
    await userEvent.click(dateChip(chosenLabel));
    expect(row().getByRole('link', { name: 'Clear date' })).toHaveAttribute(
      'href',
      '/new-york/browse?category=cooking',
    );
  });

  it('has no Clear date when no day is chosen', async () => {
    setup();
    await userEvent.click(dateChip());
    expect(
      row().queryByRole('link', { name: 'Clear date' }),
    ).not.toBeInTheDocument();
  });
});

describe('the calendar fetched when the date disclosure opens', () => {
  const placeholder = () => screen.getByRole('status', { busy: true });

  it('is not fetched before the disclosure opens, nor by the other chips', async () => {
    setup();
    await userEvent.click(filtersButton());
    await screen.findByRole('dialog', { name: 'Filters' });
    expect(calendarFetch).not.toHaveBeenCalled();
  });

  it('is fetched on the first open and shows a box saying it is loading until it arrives', async () => {
    const calendar = deferredCalendar();
    const { details } = setup();
    // Opened by the browser alone, as by a tap, so nothing else has fetched it first.
    await act(async () => {
      details.open = true;
      await Promise.resolve();
    });
    expect(calendarFetch).toHaveBeenCalledOnce();
    expect(placeholder()).toHaveTextContent(calendarLoadingMessage());
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    calendar.finish();
    expect(await screen.findByRole('grid')).toBeVisible();
    expect(
      screen.queryByRole('status', { busy: true }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['October 2026 starts on a Thursday and needs five rows', undefined, '5'],
    ['August 2026 starts on a Saturday and needs six', '2026-08-31', '6'],
  ])('holds the size of the month: %s', async (_name, date, weeks) => {
    deferredCalendar();
    setup({ ...noFilters, date: date ?? null });
    await userEvent.click(dateChip(date ? dateChipLabel(date) : pickADate));
    expect(placeholder()).toHaveAttribute('data-weeks', weeks);
    expect(placeholder()).not.toHaveAttribute('style');
  });

  it('keeps its live region from the first render, empty until the card is opened', async () => {
    const calendar = deferredCalendar();
    const { details } = setup();
    const region = calendarRegion(details);
    expect(region).toBeEmptyDOMElement();
    await userEvent.click(dateChip());
    expect(calendarRegion(details)).toBe(region);
    expect(region).toHaveTextContent(calendarLoadingMessage());
    calendar.finish();
    await screen.findByRole('grid');
  });

  it('loads a card that was opened before the page hydrated', async () => {
    const { renderToString } = await import('react-dom/server');
    const { hydrateRoot } = await import('react-dom/client');
    const html = renderToString(bar(noFilters));
    const host = document.createElement('div');
    host.innerHTML = html;
    document.body.append(host);
    const details = disclosure(host);
    // The page is plain HTML here: a tap on the chip opens the card with no script to hear it.
    const toggled = new Promise((resolve) => {
      details.addEventListener('toggle', resolve, { once: true });
    });
    details.open = true;
    await toggled;
    expect(calendarFetch).not.toHaveBeenCalled();

    let root: Root | undefined;
    try {
      await act(async () => {
        root = hydrateRoot(host, bar(noFilters));
        await Promise.resolve();
      });
      expect(await within(host).findByRole('grid')).toBeVisible();
      expect(details.open).toBe(true);
    } finally {
      act(() => {
        root?.unmount();
      });
      host.remove();
    }
  });

  it('shows a calendar a warm-up brought after the bar mounted at once, with no stand-in', async () => {
    setup();
    calendarHeld.mockReturnValue(await real.loadDatePicker());
    await userEvent.click(dateChip());
    expect(screen.getByRole('grid')).toBeVisible();
    expect(
      screen.queryByRole('status', { busy: true }),
    ).not.toBeInTheDocument();
  });

  it('holds one fetch for a card closed and opened again while the code is on its way', async () => {
    const calendar = deferredCalendar();
    const { details } = setup();
    await userEvent.click(dateChip());
    await userEvent.keyboard('{Escape}');
    expect(details.open).toBe(false);
    await userEvent.click(dateChip());
    expect(placeholder()).toHaveTextContent(calendarLoadingMessage());

    calendar.finish();
    expect(await screen.findAllByRole('grid')).toHaveLength(1);
    expect(
      screen.queryByText(calendarLoadFailedMessage()),
    ).not.toBeInTheDocument();
  });

  it('shows the new month once the code arrives when the day changed while it was on its way', async () => {
    const calendar = deferredCalendar();
    const { rerender } = render(bar(noFilters));
    await userEvent.click(dateChip());
    expect(placeholder()).toHaveAttribute('data-weeks', '5');

    rerender(bar({ ...noFilters, date: '2027-01-15' }));
    expect(disclosure().open).toBe(false);
    expect(placeholder()).toHaveAttribute('data-weeks', '6');

    calendar.finish();
    expect(
      await screen.findByLabelText(/Friday, January 15, 2027 selected/, {
        selector: '*',
      }),
    ).toBeInTheDocument();
  });

  it('shows the calendar at once when an earlier fetch has brought it', async () => {
    const component = await real.loadDatePicker();
    calendarHeld.mockReturnValue(component);
    setup();
    await userEvent.click(dateChip());
    expect(screen.getByRole('grid')).toBeVisible();
    expect(
      screen.queryByRole('status', { busy: true }),
    ).not.toBeInTheDocument();
  });

  it('says the calendar could not load, and a later open tries again', async () => {
    calendarFetch.mockRejectedValue(new Error('chunk failed'));
    const { details } = setup();
    await userEvent.click(dateChip());
    expect(await screen.findByText(calendarLoadFailedMessage())).toBeVisible();
    expect(screen.queryByRole('grid')).not.toBeInTheDocument();

    await userEvent.keyboard('{Escape}');
    expect(details.open).toBe(false);
    calendarFetch.mockImplementation(real.loadDatePicker);
    await userEvent.click(dateChip());
    expect(await screen.findByRole('grid')).toBeVisible();
    expect(
      screen.queryByText(calendarLoadFailedMessage()),
    ).not.toBeInTheDocument();
  });

  it('shows the loading box, not the old failure, while the retry is on its way', async () => {
    calendarFetch.mockRejectedValue(new Error('chunk failed'));
    setup();
    await userEvent.click(dateChip());
    await screen.findByText(calendarLoadFailedMessage());
    deferredCalendar();
    await userEvent.keyboard('{Escape}');
    await userEvent.click(dateChip());
    expect(placeholder()).toHaveTextContent(calendarLoadingMessage());
  });

  it('is fetched from the drawer too, and opens there', async () => {
    setup();
    const dialog = await openDrawer();
    expect(calendarFetch).not.toHaveBeenCalled();
    await userEvent.click(dateChip(pickADate, within(dialog)));
    expect(await within(dialog).findByRole('grid')).toBeVisible();
  });

  it.each(['hovering', 'focusing'] as const)(
    'is fetched ahead of the open by %s the chip',
    async (how) => {
      const { details } = setup();
      const chip = dateChip();
      if (how === 'hovering') await userEvent.hover(chip);
      else chip.focus();
      expect(calendarFetch).toHaveBeenCalled();
      expect(details.open).toBe(false);
    },
  );

  it('stays quiet when the fetch ahead of the open fails', async () => {
    calendarFetch.mockRejectedValueOnce(new Error('chunk failed'));
    setup();
    await userEvent.hover(dateChip());
    await Promise.resolve();
    expect(screen.queryByText(calendarLoadFailedMessage())).toBeNull();
    await userEvent.click(dateChip());
    expect(await screen.findByRole('grid')).toBeVisible();
  });

  it('leaves focus on the chip when the calendar arrives, and on a guest who moved on', async () => {
    const calendar = deferredCalendar();
    render(
      <>
        {bar(noFilters)}
        <button type="button">Elsewhere</button>
      </>,
    );
    await userEvent.click(dateChip());
    expect(dateChip()).toHaveFocus();
    calendar.finish();
    await screen.findByRole('grid');
    expect(dateChip()).toHaveFocus();

    cleanup();
    const late = deferredCalendar();
    render(
      <>
        {bar(noFilters)}
        <button type="button">Elsewhere</button>
      </>,
    );
    await userEvent.click(dateChip());
    screen.getByRole('button', { name: 'Elsewhere' }).focus();
    late.finish();
    await screen.findByRole('grid');
    expect(screen.getByRole('button', { name: 'Elsewhere' })).toHaveFocus();
  });

  it('puts the card clear of the chip again once the calendar has replaced the box', async () => {
    const scrollBy = vi.fn();
    vi.stubGlobal('scrollBy', scrollBy);
    const calendar = deferredCalendar();
    const { details } = setup();
    const chip = dateChip();
    const card = calendarCard(details);
    card.style.position = 'fixed';
    chip.getBoundingClientRect = () => ({ bottom: 300 }) as DOMRect;
    // The box clears the chip; the taller calendar rises over it.
    card.getBoundingClientRect = () =>
      ({ top: screen.queryByRole('grid') ? 290 : 400 }) as DOMRect;
    await userEvent.click(chip);
    expect(scrollBy).not.toHaveBeenCalled();

    calendar.finish();
    await screen.findByRole('grid');
    expect(scrollBy).toHaveBeenCalledExactlyOnceWith({ top: 18 });
    vi.unstubAllGlobals();
  });

  it('closes on a pick and gives focus back to the chip, without mounting the calendar again', async () => {
    const { rerender } = render(bar(noFilters));
    await userEvent.click(dateChip());
    const grid = await screen.findByRole('grid');
    const [next] = await screen.findAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    await userEvent.click(
      screen.getByRole('button', { name: /Saturday, November 7, 2026/ }),
    );

    rerender(bar({ ...noFilters, date: chosenDay }));

    expect(disclosure().open).toBe(false);
    expect(dateChip(chosenLabel)).toHaveFocus();
    expect(screen.getByRole('grid', { hidden: true })).toBe(grid);
  });

  it('keeps the calendar a guest paged through when the day changes, so it is never keyed by the day', async () => {
    const { rerender } = render(bar({ ...noFilters, date: '2026-10-26' }));
    await userEvent.click(dateChip(dateChipLabel('2026-10-26')));
    const grid = await screen.findByRole('grid');
    const [next] = await screen.findAllByRole('button', { name: 'Next' });
    if (!next) throw new Error('No Next button');
    await userEvent.click(next);
    const marked = screen.getByRole('button', {
      name: /Saturday, November 7, 2026/,
    });

    rerender(bar({ ...noFilters, date: '2026-11-08' }));

    expect(screen.getByRole('grid', { hidden: true })).toBe(grid);
    expect(
      screen.getByRole('button', {
        name: /Saturday, November 7, 2026/,
        hidden: true,
      }),
    ).toBe(marked);
  });
});
