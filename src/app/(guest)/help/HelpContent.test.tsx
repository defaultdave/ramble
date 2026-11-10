import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDriverError } from '../../../../tests/support/driverError';
import { HelpContent } from './HelpContent';
import { generateMetadata } from './page';

// Behaviours under test:
// - no q reads the cached index, and a q reads the search with the cleaned-up term
// - a blank q is no search
// - a search that finds nothing renders the no-results state
// - a failed read logs only the digest and kind, and renders the error state with a retry to the index
// - a searched index is kept out of search engines in its head

const server = vi.hoisted(() => ({
  index: vi.fn(),
  search: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/help', () => ({
  getHelpIndex: server.index,
  searchHelp: server.search,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));

const summary = {
  id: '1',
  slug: 'how-to-cancel',
  title: 'How do I cancel?',
  summary: null,
};
const searchParams = (q?: string | string[]) =>
  Promise.resolve(q === undefined ? {} : { q });

beforeEach(() => {
  vi.clearAllMocks();
  server.index.mockResolvedValue([summary]);
  server.search.mockResolvedValue([summary]);
});

describe('the help index content', () => {
  it('reads the index when there is no search', async () => {
    render(await HelpContent({ searchParams: searchParams() }));

    expect(server.index).toHaveBeenCalledOnce();
    expect(server.search).not.toHaveBeenCalled();
    expect(
      screen.getByRole('link', { name: 'How do I cancel?' }),
    ).toBeVisible();
  });

  it('reads a blank search as no search', async () => {
    render(await HelpContent({ searchParams: searchParams('   ') }));

    expect(server.index).toHaveBeenCalledOnce();
    expect(server.search).not.toHaveBeenCalled();
  });

  it('searches with the cleaned-up term', async () => {
    render(await HelpContent({ searchParams: searchParams('  can   cel ') }));

    expect(server.search).toHaveBeenCalledExactlyOnceWith('can cel');
    expect(server.index).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Search help articles')).toHaveValue(
      'can cel',
    );
  });

  it('shows the no-results state when the search finds nothing', async () => {
    server.search.mockResolvedValue([]);

    render(await HelpContent({ searchParams: searchParams('zzz') }));

    expect(
      screen.getByRole('heading', { level: 2, name: /No articles match/ }),
    ).toBeVisible();
  });

  it.each([
    ['the index', undefined, 'index'],
    ['a search', 'cancel', 'search'],
  ] as const)(
    'logs only the digest and kind of a failed read of %s and shows the error state',
    async (_name, q, read) => {
      const secret = 'secret-id';
      server[read].mockRejectedValue(
        makeDriverError(secret, { withCause: true }),
      );

      render(await HelpContent({ searchParams: searchParams(q) }));

      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't load the help articles",
      );
      expect(
        screen.getByRole('heading', { level: 1, name: 'Help' }),
      ).toBeVisible();
      expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
      expect(JSON.stringify(server.logError.mock.calls)).not.toContain(secret);
      expect(server.logError).toHaveBeenCalledOnce();
    },
  );
});

describe('the help index head', () => {
  it.each([
    ['no search', undefined, undefined],
    ['a search', 'cancel', { index: false, follow: true }],
  ])('has the robots rule for %s', async (_name, q, robots) => {
    const head = await generateMetadata({
      searchParams: searchParams(q),
    } as Parameters<typeof generateMetadata>[0]);

    expect(head.robots).toEqual(robots);
  });
});
