import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { upcomingSessionLimits } from '@/lib/upcomingSessions';
import {
  UpcomingSessions,
  UpcomingSessionsError,
  UpcomingSessionsSkeleton,
} from './UpcomingSessions';
import {
  lowSpaces,
  mixed,
  none,
  soldOut,
  withSelectedDate,
  withSpaces,
} from './UpcomingSessions.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - each date is one list item with its day and time, the spaces left, and the price
// - an open or few-left date is a link to the booking; a sold-out date stays listed, marked, and is no link
// - the low-spaces wording ("3 left", "1 left") reads in the row, and "Sold out" for none or fewer
// - the date the address asked for is marked as the current date, and no other row is
// - no dates says so in words instead of an empty list
// - the skeleton announces loading and draws one hidden row per bounded row, in the loaded rows' class
// - the error state says what failed and retries with a GET form to the page's own address

describe('UpcomingSessions', () => {
  it('lists each date with its time, spaces left, and price', () => {
    render(<UpcomingSessions view={withSpaces} />);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(4);
    expect(rows[0]).toHaveTextContent('Sat, Oct 24 · 5:30 PM EDT');
    expect(rows[0]).toHaveTextContent('8 spaces');
    expect(rows[0]).toHaveTextContent('$65');
    expect(rows[2]).toHaveTextContent('Sat, Oct 31 · 5:30 PM EDT');
  });

  it('links an open date to the booking and lists a sold-out one without a link', () => {
    render(<UpcomingSessions view={mixed} />);

    const rows = screen.getAllByRole('listitem');
    expect(within(rows[0] as HTMLElement).getByRole('link')).toHaveAttribute(
      'href',
      '/checkout/demo',
    );
    expect(within(rows[1] as HTMLElement).getByRole('link')).toHaveTextContent(
      '2 left',
    );
    expect(rows[2]).toHaveTextContent('Sold out');
    expect(within(rows[2] as HTMLElement).queryByRole('link')).toBeNull();
    expect(rows).toHaveLength(4);
  });

  it.each([
    [lowSpaces, ['3 left', '1 left', '5 spaces']],
    [soldOut, ['Sold out', 'Sold out', '4 spaces']],
  ])('words the spaces of each row', (view, expected) => {
    render(<UpcomingSessions view={view} />);

    const spoken = screen
      .getAllByRole('listitem')
      .map(
        (row) => /(\d+ spaces|\d+ left|Sold out)/.exec(row.textContent)?.[0],
      );
    expect(spoken).toEqual(expected);
  });

  it('marks the date the address asked for, and only its rows', () => {
    render(<UpcomingSessions view={withSelectedDate} />);

    const current = document.querySelectorAll('[aria-current="date"]');
    expect(current).toHaveLength(2);
    expect([...current].map((row) => row.textContent)).toEqual([
      expect.stringContaining('Sun, Oct 25 · 1:00 PM EDT') as string,
      expect.stringContaining('Sun, Oct 25 · 5:30 PM EDT') as string,
    ]);
  });

  it('says so when no date is open', () => {
    render(<UpcomingSessions view={none} />);

    expect(screen.queryByRole('list')).toBeNull();
    expect(screen.getByText(/No dates are open/)).toBeInTheDocument();
  });
});

describe('UpcomingSessionsSkeleton', () => {
  it('announces the load and holds the space of every row it can be replaced by', () => {
    const { container } = render(<UpcomingSessionsSkeleton />);

    expect(screen.getByRole('status')).toHaveTextContent('Loading dates');
    const list = container.querySelector('ul');
    expect(list).toHaveAttribute('aria-hidden', 'true');
    expect(list?.children).toHaveLength(upcomingSessionLimits.maxRows);
    const loaded = render(<UpcomingSessions view={withSpaces} />);
    const loadedRow = loaded.container.querySelector('li > a, li > div');
    expect(list?.firstElementChild?.className).toBe(
      loadedRow?.className.split(' ').find((name) => name.includes('row')),
    );
  });
});

describe('UpcomingSessionsError', () => {
  it('says what failed and retries with a GET form to the same address', () => {
    render(<UpcomingSessionsError retryHref="/experiences/sunset-kayak-1" />);

    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load the dates",
    );
    const form = screen
      .getByRole('button', { name: 'Check availability' })
      .closest('form');
    expect(form).toHaveAttribute('action', '/experiences/sunset-kayak-1');
    expect(form).toHaveAttribute('method', 'get');
  });
});
