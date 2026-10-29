import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowseContent } from './BrowseContent';

// Behaviours under test, one per decision, branch or risk:
// - the cover photos of the experiences on the page are read once, by their IDs in one order, and shown on their cards
// - a page with no result asks for no cover
// - a polite live region carries the count, or the empty heading, for the current filters
// - the live region is on the page and empty when the content read failed
// - a failed cover read logs the cover message with only the digest and kind and renders the cards and filters without images, not the error state
// - a control-flow error from the cover read passes through
// - a failed content read renders the error state and reads no cover

const server = vi.hoisted(() => ({
  options: vi.fn(),
  dates: vi.fn(),
  results: vi.fn(),
  covers: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/server/browse', () => ({
  getFilterOptions: server.options,
  getBrowseDates: server.dates,
  getBrowseResults: server.results,
}));
vi.mock('@/server/actions/browse', () => ({ chooseBrowseDate: vi.fn() }));
vi.mock('@/server/coverPhotos', () => ({ getCoverPhotos: server.covers }));
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

const photo = {
  id: id(100),
  experienceId: id(2),
  position: 0,
  url: 'data:image/png;base64,iVBORw0KGgo=',
  width: 1600,
  height: 1000,
  decorative: false,
  altText: 'A kayak at dusk',
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
    items: [item(2), item(1)],
    nextCursor: null,
  });
  server.covers.mockResolvedValue([photo]);
});

describe('BrowseContent', () => {
  it('reads the covers of the listed experiences once, in one order, and shows them', async () => {
    await render_();

    expect(server.covers).toHaveBeenCalledExactlyOnceWith([id(1), id(2)]);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(
      screen.getByRole('img', { name: 'A kayak at dusk' }),
    ).toBeInTheDocument();
  });

  it('asks for no cover when nothing is listed', async () => {
    server.results.mockResolvedValue({
      ok: true,
      items: [],
      nextCursor: null,
    });

    await render_();

    expect(server.covers).toHaveBeenCalledExactlyOnceWith([]);
  });

  it('logs only the digest and kind of a failed cover read and renders the cards without images', async () => {
    server.covers.mockRejectedValue(driverError);

    await render_();

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'Browse covers could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByText('Thing 1')).toBeInTheDocument();
    expect(screen.getByText('Thing 2')).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByTestId('filters')).toBeInTheDocument();
  });

  it('rethrows a framework control-flow error from the cover read and logs nothing', async () => {
    server.covers.mockImplementation(() => {
      notFound();
    });

    await expect(render_()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('logs only the digest and kind of a failed content read and renders the error state, reading no cover', async () => {
    server.results.mockRejectedValue(driverError);

    await render_();

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'Browse could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load experiences",
    );
    expect(server.covers).not.toHaveBeenCalled();
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
});
