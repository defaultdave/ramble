import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HomeContent } from './HomeContent';

// Behaviours under test, one per decision, branch or risk:
// - a read that throws an Error carrying query text and params logs only its digest and kind and renders the error state
// - a framework control-flow error is rethrown and not logged
// - a page with no module to show renders the empty state
// - the cover photos of the cards on the page are read once, by the IDs of those cards, and shown on them
// - a failed cover read logs the cover message with only the digest and kind and renders the cards without images, not the error state
// - a control-flow error from the cover read passes through
// - a page without a hero_search renders the hidden title, and one with it does not

const server = vi.hoisted(() => ({
  content: vi.fn(),
  thisWeek: vi.fn(),
  settings: vi.fn(),
  covers: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('next/server', () => ({ connection: () => Promise.resolve() }));
vi.mock('@/server/home', () => ({
  getHomeContent: server.content,
  getThisWeek: server.thisWeek,
}));
vi.mock('@/server/coverPhotos', () => ({ getCoverPhotos: server.covers }));
vi.mock('@/server/siteSettings', () => ({
  getCachedGuestSettings: server.settings,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('@/components/RichText', () => ({
  RichText: () => <div data-testid="rich-text" />,
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const homeModule = (
  n: number,
  kind: 'hero_search' | 'reassurance' | 'picks',
  collectionId: string | null = null,
) => ({
  id: id(900 + n),
  position: n,
  kind,
  enabled: true,
  heading: null,
  body: null,
  collectionId,
});

function content(modules: ReturnType<typeof homeModule>[]) {
  return {
    modules,
    picks: [],
    categories: [],
    neighborhoods: [],
    experiences: [],
  };
}

// What a database error carries: the query text and the values bound to it.
const driverError = Object.assign(
  new Error('Failed query: select ... where slug in ($1)\nparams: secret-slug'),
  { cause: new Error('connection to secret-host refused') },
);

beforeEach(() => {
  vi.clearAllMocks();
  server.content.mockResolvedValue(content([homeModule(1, 'reassurance')]));
  server.thisWeek.mockResolvedValue({ experienceIds: [], experiences: [] });
  server.settings.mockResolvedValue({ giftsEnabled: true, bannerText: null });
  server.covers.mockResolvedValue([]);
});

describe('HomeContent', () => {
  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.content.mockRejectedValue(driverError);

    render(await HomeContent());

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The home page could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load the home page",
    );
  });

  it('logs the digest and kind a cached read carries', async () => {
    server.thisWeek.mockRejectedValue(
      Object.assign(new Error('secret-slug'), { digest: '1234567' }),
    );

    render(await HomeContent());

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The home page could not be read',
      { digest: '1234567', kind: 'Error' },
    );
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.content.mockImplementation(() => {
      notFound();
    });

    await expect(HomeContent()).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('renders the empty state when no module has anything to show', async () => {
    server.content.mockResolvedValue(content([]));

    render(await HomeContent());

    expect(
      screen.getByRole('link', { name: 'Browse experiences' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('renders the page title when no hero carries the h1', async () => {
    render(await HomeContent());

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Ramble',
    );
  });

  it('leaves the page title to the hero when staff switch it on', async () => {
    server.content.mockResolvedValue(
      content([homeModule(1, 'hero_search'), homeModule(2, 'reassurance')]),
    );

    render(await HomeContent());

    const headings = screen.getAllByRole('heading', { level: 1 });
    expect(headings).toHaveLength(1);
    expect(headings[0]).not.toHaveTextContent(/^Ramble$/);
  });

  describe('cover photos', () => {
    const picksPage = () => {
      const picksModule = homeModule(1, 'picks', id(800));
      return {
        ...content([picksModule]),
        picks: [
          {
            id: id(800),
            slug: 'rainy-day',
            title: 'Rainy day',
            summary: null,
            itemCount: 2,
            experienceIds: [id(2), id(1)],
          },
        ],
        experiences: [id(1), id(2)].map((experienceId) => ({
          id: experienceId,
          slug: 'thing',
          name: `Thing ${experienceId.slice(-1)}`,
          status: 'live',
          neighborhoodName: 'Greenpoint',
          durationMinutes: 120,
          linkOutUrl: null,
          priceOptions: [{ kind: 'adult', priceMinor: 7000, usesSpace: true }],
        })),
      };
    };
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

    it('reads the covers of the cards once, in one order, and shows them', async () => {
      server.content.mockResolvedValue(picksPage());
      server.covers.mockResolvedValue([photo]);

      render(await HomeContent());

      expect(server.covers).toHaveBeenCalledExactlyOnceWith([id(1), id(2)]);
      expect(screen.getAllByRole('img')).toHaveLength(1);
      expect(
        screen.getByRole('img', { name: 'A kayak at dusk' }),
      ).toBeInTheDocument();
    });

    it('asks for no cover when no card is shown', async () => {
      render(await HomeContent());

      expect(server.covers).toHaveBeenCalledExactlyOnceWith([]);
    });

    it('logs only the digest and kind of a failed cover read and renders the cards without images', async () => {
      server.content.mockResolvedValue(picksPage());
      server.covers.mockRejectedValue(driverError);

      render(await HomeContent());

      expect(server.logError).toHaveBeenCalledExactlyOnceWith(
        'The home page covers could not be read',
        { digest: undefined, kind: 'Error' },
      );
      expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
        /secret|Failed query/,
      );
      expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      expect(screen.getByText('Thing 1')).toBeInTheDocument();
      expect(screen.getByText('Thing 2')).toBeInTheDocument();
      expect(screen.queryByRole('img')).not.toBeInTheDocument();
    });

    it('rethrows a framework control-flow error from the cover read and logs nothing', async () => {
      server.content.mockResolvedValue(picksPage());
      server.covers.mockImplementation(() => {
        notFound();
      });

      await expect(HomeContent()).rejects.toMatchObject({
        digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
      });
      expect(server.logError).not.toHaveBeenCalled();
    });
  });
});
