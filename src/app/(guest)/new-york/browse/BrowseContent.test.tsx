import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { browseResultsId } from '@/lib/pages/browse';
import { BrowseContent } from './BrowseContent';
import { id } from '../../../../../tests/support/ids';
import { makeDriverError } from '../../../../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - a card shows the cover its experience read carried, and none for one without
// - a polite live region carries the count, or the empty heading, for the current filters
// - the live region is on the page and empty when the content read failed
// - a slug the catalog has no row for never reaches the cached reads, and the page keeps the address it was given
// - filters that match nothing show the empty state without any date or result read
// - a failed content read renders the error state
// - the calendar read gets the picked fields only, so a date never keys it
// - a date no session can be on reads no results but still reads the calendar, and keeps the address
// - both branches are wrapped in the element that is shown with scripting off, with the id the skip link targets

const server = vi.hoisted(() => ({
  options: vi.fn(),
  dates: vi.fn(),
  results: vi.fn(),
  suggestions: vi.fn().mockResolvedValue([]),
  logError: vi.fn(),
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/server/filterOptions', () => ({
  getFilterOptions: server.options,
}));
vi.mock('@/server/browse', () => ({
  getBrowseDates: server.dates,
  getBrowseResults: server.results,
  getZeroResultSuggestions: server.suggestions,
}));
vi.mock('@/server/actions/browse', () => ({ chooseBrowseDate: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('@/components/FilterBar', () => ({
  FilterBar: () => <div data-testid="filters" />,
}));

const item = (n: number) => ({
  id: id(n),
  slug: `thing-${String(n)}`,
  name: `Thing ${String(n)}`,
  status: 'live',
  neighborhoodName: 'DUMBO',
  durationMinutes: 120,
  linkOutUrl: null,
  priceOptions: [{ priceMinor: 8500, usesSpace: true }],
});

const image = {
  src: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1600,
  height: 1000,
  alt: 'A kayak at dusk',
  blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
};

const driverError = makeDriverError('secret-id');

const render_ = async () =>
  render(await BrowseContent({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T15:00:00Z'));
  server.options.mockResolvedValue({ categories: [], neighborhoods: [] });
  server.dates.mockResolvedValue([]);
  server.results.mockResolvedValue({
    ok: true,
    items: [{ ...item(2), image }, item(1)],
    nextCursor: null,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('BrowseContent', () => {
  it('shows the cover its experience read carried, and none for one without', async () => {
    await render_();

    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(
      screen.getByRole('img', { name: 'A kayak at dusk' }),
    ).toBeInTheDocument();
  });

  it('logs only the digest and kind of a failed content read and renders the error state', async () => {
    server.results.mockRejectedValue(driverError);

    await render_();

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'Browse could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load experiences",
    );
  });

  it('renders the live region empty on the error path, so a recovery updates the same node', async () => {
    server.results.mockRejectedValue(driverError);

    await render_();

    expect(screen.getByRole('status')).toBeEmptyDOMElement();
  });

  // With scripting off, only a wrapper marked this way is shown, so a branch without it is a blank page.
  it.each([
    {
      branch: 'read',
      fail: false,
      inside: () => screen.getByTestId('filters'),
    },
    {
      branch: 'failed',
      fail: true,
      inside: () => screen.getByRole('alert'),
    },
  ])(
    'marks the $branch branch to be shown with scripting off, and reachable by the skip link',
    async ({ fail, inside }) => {
      if (fail) server.results.mockRejectedValue(driverError);

      const { container } = await render_();

      const shown = container.querySelector('[data-reveal-without-script]');
      expect(shown).toHaveAttribute('id', browseResultsId);
      expect(shown).toContainElement(inside());
    },
  );

  it('offers the next day from the calendar days when a dated browse has no results', async () => {
    server.dates.mockResolvedValue(['2026-11-02', '2026-11-09']);
    server.results.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });

    render(
      await BrowseContent({
        searchParams: Promise.resolve({ date: '2026-11-07' }),
      }),
    );

    expect(
      screen.getByRole('link', { name: 'See Mon, Nov 9' }),
    ).toHaveAttribute('href', '/new-york/browse?date=2026-11-09');
    expect(screen.getByRole('link', { name: 'Any day' })).toHaveAttribute(
      'href',
      '/new-york/browse',
    );
  });

  it('reads the calendar from the picked fields only, so the date is no part of its key', async () => {
    render(
      await BrowseContent({
        searchParams: Promise.resolve({ date: '2026-11-07', guests: '3' }),
      }),
    );

    expect(server.dates).toHaveBeenCalledExactlyOnceWith(
      { categories: [], neighborhoods: [], guests: 3 },
      expect.any(String),
    );
  });

  it('reads no results for a date outside the window, keeps the calendar, and words the empty state for the address', async () => {
    server.dates.mockResolvedValue(['2026-11-02', '2026-11-09']);

    render(
      await BrowseContent({
        searchParams: Promise.resolve({ date: '1999-01-01' }),
      }),
    );

    expect(server.results).not.toHaveBeenCalled();
    expect(server.dates).toHaveBeenCalledOnce();
    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing on Fri, Jan 1',
    );
    expect(
      screen.getByRole('link', { name: 'See Mon, Nov 2' }),
    ).toHaveAttribute('href', '/new-york/browse?date=2026-11-02');
  });

  it('carries the count in a live region', async () => {
    await render_();

    expect(screen.getByRole('status')).toHaveTextContent('2 experiences');
  });

  it('carries the empty heading for a chosen day in the live region', async () => {
    server.results.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });

    render(
      await BrowseContent({
        searchParams: Promise.resolve({ date: '2026-11-07' }),
      }),
    );

    expect(screen.getByRole('status')).toHaveTextContent(
      'Nothing on Sat, Nov 7',
    );
  });

  describe('with a slug the catalog does not have', () => {
    const withSlugs = (searchParams: Record<string, string | string[]>) =>
      BrowseContent({ searchParams: Promise.resolve(searchParams) });

    beforeEach(() => {
      server.options.mockResolvedValue({
        categories: [{ slug: 'cooking', name: 'Cooking' }],
        neighborhoods: [],
      });
    });

    it('reads with the known slugs only', async () => {
      render(await withSlugs({ category: ['junk', 'cooking'] }));

      expect(server.dates).toHaveBeenCalledExactlyOnceWith(
        { categories: ['cooking'], neighborhoods: [], guests: null },
        expect.any(String),
      );
      expect(server.results).toHaveBeenCalledExactlyOnceWith(
        {
          filters: {
            categories: ['cooking'],
            neighborhoods: [],
            date: null,
            guests: null,
            price: null,
            age: null,
            setting: null,
            search: null,
          },
          after: null,
        },
        expect.any(String),
      );
    });

    it('shows the empty state and reads neither dates nor results when no slug is known', async () => {
      render(await withSlugs({ category: 'junk' }));

      expect(server.dates).not.toHaveBeenCalled();
      expect(server.results).not.toHaveBeenCalled();
      expect(screen.getByRole('status')).toHaveTextContent(
        'Nothing matches those filters',
      );
    });
  });
});
