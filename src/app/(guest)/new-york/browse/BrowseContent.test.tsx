import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseContent } from './BrowseContent';

// Behaviours under test, one per decision, branch or risk:
// - a card shows the cover its experience read carried, and none for one without
// - a polite live region carries the count, or the empty heading, for the current filters
// - the live region is on the page and empty when the content read failed
// - a slug the catalog has no row for never reaches the cached reads, and the page keeps the address it was given
// - filters that match nothing show the empty state without any date or result read
// - a failed content read renders the error state

const server = vi.hoisted(() => ({
  options: vi.fn(),
  dates: vi.fn(),
  results: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/server/browse', () => ({
  getFilterOptions: server.options,
  getBrowseDates: server.dates,
  getBrowseResults: server.results,
}));
vi.mock('@/server/actions/browse', () => ({ chooseBrowseDate: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('@/components/FilterBar', () => ({
  FilterBar: () => <div data-testid="filters" />,
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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

const driverError = new Error(
  'Failed query: select ... where id in ($1)\nparams: secret-id',
);

const render_ = async () =>
  render(await BrowseContent({ searchParams: Promise.resolve({}) }));

beforeEach(() => {
  vi.clearAllMocks();
  server.options.mockResolvedValue({ categories: [], neighborhoods: [] });
  server.dates.mockResolvedValue([]);
  server.results.mockResolvedValue({
    ok: true,
    items: [{ ...item(2), image }, item(1)],
    nextCursor: null,
  });
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
        {
          categories: ['cooking'],
          neighborhoods: [],
          date: null,
          guests: null,
        },
        expect.any(String),
      );
      expect(server.results).toHaveBeenCalledExactlyOnceWith(
        {
          filters: {
            categories: ['cooking'],
            neighborhoods: [],
            date: null,
            guests: null,
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
