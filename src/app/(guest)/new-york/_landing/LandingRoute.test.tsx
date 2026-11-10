import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import type { ReactElement, ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { landingResultsId, type LandingKind } from '@/lib/pages/landing';
import { LandingRoute, landingMetadata } from './LandingRoute';
import { makeDriverError } from '../../../../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - an address the catalog has nothing for is a not-found
// - a failed read of the page logs only the digest and kind and renders the error state, which retries at the page's own address
// - the page is handed the editor's heading, the intro above the results and the body below them, and the browse address with the page's own filter; without copy it has the plain heading and neither
// - the results read browse's first page for the page's filter; a failed read logs only the digest and kind and renders the page's own error wording, which retries at the page's own address
// - both branches of the results are wrapped in the element that is shown with scripting off
// - an empty page is worded for a page with no filters
// - a framework control-flow error is rethrown and not logged, by the page and by its results
// - the head names the page, with the description only when one is written; an unknown page and a failed read fall back to the plain title, and the failed read logs only its digest and kind

const server = vi.hoisted(() => ({
  landing: vi.fn(),
  browse: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/landing', () => ({ getLandingData: server.landing }));
vi.mock('@/server/browse', () => ({ getBrowseResults: server.browse }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
// A request-time read needs a request.
vi.mock('next/server', () => ({ connection: vi.fn() }));
vi.mock('next/form', () => ({
  default: ({ action, children }: { action: string; children: ReactNode }) => (
    <form action={action} method="get">
      {children}
    </form>
  ),
}));
// The results are an async Server Component in a Suspense boundary, which cannot render under
// Testing Library; the stand-in keeps the order of the real page and hands the results over to be read.
vi.mock('@/components/LandingPage', () => ({
  LandingPage: (props: {
    heading: string;
    intro: ReactNode;
    browseHref: string;
    body: ReactNode;
  }) => {
    return (
      <div>
        <header>
          <h1>{props.heading}</h1>
          {props.intro}
          <a href={props.browseHref}>Pick a day</a>
        </header>
        <div data-testid="body">{props.body}</div>
      </div>
    );
  },
}));

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});
const copy = {
  heading: 'Cook your way through Brooklyn',
  metaDescription: 'Classes in home kitchens.',
  intro: paragraph('Intro words'),
  body: paragraph('Body words'),
};

const kinds: readonly (readonly [LandingKind, string, string])[] = [
  ['category', 'cooking', '/new-york/things-to-do/cooking'],
  ['neighborhood', 'dumbo', '/new-york/neighborhoods/dumbo'],
];

const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;

const driverError = makeDriverError('secret-slug', { withCause: true });

type SuspendedResults = ReactElement<{
  children: ReactElement<unknown, (props: unknown) => Promise<ReactElement>>;
}>;

/** The experiences, which the route hands to a Suspense boundary: the async component inside it, awaited and rendered. */
async function renderResults(
  page: ReactElement<{ results: SuspendedResults }>,
) {
  const { type, props } = page.props.results.props.children;
  return render(await type(props));
}

beforeEach(() => {
  vi.clearAllMocks();
  server.landing.mockResolvedValue({ name: 'Cooking', copy });
  server.browse.mockResolvedValue({ ok: true, items: [], nextCursor: null });
});

describe('the landing route', () => {
  it('is a not-found when the catalog has nothing at the address', async () => {
    server.landing.mockResolvedValue(null);

    await expect(
      LandingRoute({ kind: 'category', slug: 'nope' }),
    ).rejects.toMatchObject({ digest: notFoundDigest });
  });

  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.landing.mockRejectedValue(driverError);

    render(await LandingRoute({ kind: 'category', slug: 'cooking' }));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The landing page could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Cooking experiences in New York',
      }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this page",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/new-york/things-to-do/cooking');
  });

  it.each(kinds)(
    'puts the intro above the results and the body below them, and links the %s filter to browse',
    async (kind, slug) => {
      render(await LandingRoute({ kind, slug }));

      expect(
        screen.getByRole('heading', { level: 1, name: copy.heading }),
      ).toBeVisible();
      expect(
        within(screen.getByRole('banner')).getByText('Intro words'),
      ).toBeVisible();
      expect(
        within(screen.getByTestId('body')).getByText('Body words'),
      ).toBeVisible();
      expect(screen.getByRole('link', { name: 'Pick a day' })).toHaveAttribute(
        'href',
        `/new-york/browse?${kind}=${slug}`,
      );
    },
  );

  it('has the plain heading and no intro or body until copy is published', async () => {
    server.landing.mockResolvedValue({ name: 'Cooking', copy: null });

    render(await LandingRoute({ kind: 'category', slug: 'cooking' }));

    expect(
      screen.getByRole('heading', {
        level: 1,
        name: 'Cooking experiences in New York',
      }),
    ).toBeVisible();
    expect(screen.getByTestId('body')).toBeEmptyDOMElement();
    expect(screen.getByRole('banner').querySelector('p')).toBeNull();
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.landing.mockImplementation(() => {
      notFound();
    });

    await expect(
      LandingRoute({ kind: 'category', slug: 'cooking' }),
    ).rejects.toMatchObject({ digest: notFoundDigest });
    expect(server.logError).not.toHaveBeenCalled();
  });
});

describe('the landing results', () => {
  it.each(kinds)(
    'read the first browse page for the %s filter and nothing else',
    async (kind, slug) => {
      await renderResults(await LandingRoute({ kind, slug }));

      expect(server.browse).toHaveBeenCalledExactlyOnceWith(
        {
          filters: {
            categories: kind === 'category' ? [slug] : [],
            neighborhoods: kind === 'neighborhood' ? [slug] : [],
            date: null,
            guests: null,
            price: null,
            age: null,
            setting: null,
            search: null,
          },
          after: null,
        },
        expect.stringMatching(/^\d{4}-\d\d-\d\dT\d\d:\d\d:00\.000Z$/),
      );
    },
  );

  it('logs only the digest and kind of a failed read and words the error for a page with no filters', async () => {
    server.browse.mockRejectedValue(driverError);

    await renderResults(
      await LandingRoute({ kind: 'neighborhood', slug: 'dumbo' }),
    );

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The landing page experiences could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Try again in a moment.');
    expect(alert).not.toHaveTextContent('filters');
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/new-york/neighborhoods/dumbo');
  });

  // With scripting off only a marked wrapper is shown, so a branch without it is a blank page under the intro.
  it.each([
    { branch: 'read', fail: false, inside: () => screen.getByRole('heading') },
    { branch: 'failed', fail: true, inside: () => screen.getByRole('alert') },
  ])(
    'marks the $branch branch to be shown with scripting off, and reachable by the skip link',
    async ({ fail, inside }) => {
      if (fail) server.browse.mockRejectedValue(driverError);

      const { container } = await renderResults(
        await LandingRoute({ kind: 'category', slug: 'cooking' }),
      );

      const shown = container.querySelector('[data-reveal-without-script]');
      expect(shown).toHaveAttribute('id', landingResultsId);
      expect(shown).toContainElement(inside());
    },
  );

  it('words an empty page for a page with no filters', async () => {
    await renderResults(
      await LandingRoute({ kind: 'category', slug: 'cooking' }),
    );

    expect(
      screen.getByRole('heading', { name: 'Nothing here yet' }),
    ).toBeVisible();
    expect(screen.queryByText(/filters/)).not.toBeInTheDocument();
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.browse.mockImplementation(() => {
      notFound();
    });
    const page = await LandingRoute({ kind: 'category', slug: 'cooking' });

    await expect(renderResults(page)).rejects.toMatchObject({
      digest: notFoundDigest,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });
});

describe('the landing head', () => {
  it('names the page and describes it when the editor wrote a description', async () => {
    expect(
      await landingMetadata({ kind: 'category', slug: 'cooking' }),
    ).toEqual({ title: copy.heading, description: copy.metaDescription });
  });

  it('has no description until one is written', async () => {
    server.landing.mockResolvedValue({
      name: 'Cooking',
      copy: { ...copy, heading: null, metaDescription: null },
    });

    expect(
      await landingMetadata({ kind: 'category', slug: 'cooking' }),
    ).toEqual({ title: 'Cooking experiences in New York' });
  });

  it('is the plain title for a page the catalog does not have', async () => {
    server.landing.mockResolvedValue(null);

    expect(await landingMetadata({ kind: 'category', slug: 'nope' })).toEqual({
      title: 'Things to do in New York',
    });
  });

  it('names the page by its address when the read fails, and logs only its digest and kind', async () => {
    server.landing.mockRejectedValue(driverError);

    expect(
      await landingMetadata({ kind: 'category', slug: 'cooking' }),
    ).toEqual({ title: 'Cooking experiences in New York' });
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The landing page head could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
  });
});
