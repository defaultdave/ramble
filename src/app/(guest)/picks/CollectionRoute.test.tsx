import '@testing-library/jest-dom/vitest';
import { render, screen, within } from '@testing-library/react';
import { notFound } from 'next/navigation';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { landingResultsId } from '@/lib/pages/landing';
import { CollectionRoute, collectionMetadata } from './CollectionRoute';
import { id } from '../../../../tests/support/ids';
import { makeDriverError } from '../../../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - an address with nothing published is a not-found
// - a failed read logs only the digest and kind, and renders the page's own error state, which retries at the page's own address
// - the page shows the editor's title and intro above the experiences, which are in the collection's order and not the order they were read in
// - a collection with no intro has no intro text
// - the results sit in the element that is shown with scripting off, and the skip link points at it
// - an empty collection says so, worded for a page with no filters
// - the link to browse carries no filter, for a guest who wants to narrow by day or party
// - a framework control-flow error is rethrown and not logged
// - the head is the collection's title with its summary; a missing page and a failed read fall back to the kind's plain title, and the failed read logs only its digest and kind

const server = vi.hoisted(() => ({ page: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/collections', () => ({ getCollectionPage: server.page }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('next/form', () => ({
  default: ({ action, children }: { action: string; children: ReactNode }) => (
    <form action={action} method="get">
      {children}
    </form>
  ),
}));

const paragraph = (text: string) => ({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
});

function read(n: number, name: string) {
  return {
    id: id(n),
    slug: `thing-${String(n)}`,
    name,
    status: 'live',
    neighborhoodName: 'DUMBO',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 8500, usesSpace: true }],
  };
}

const page = {
  collection: {
    kind: 'pick',
    slug: 'rainy-days',
    title: 'Rainy days',
    summary: 'Things to do indoors.',
    intro: paragraph('Intro words'),
    items: [
      { experienceId: id(2), note: null },
      { experienceId: id(1), note: null },
    ],
  },
  experiences: [read(1, 'Pottery'), read(2, 'Candle pouring')],
};

const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;
const driverError = makeDriverError('secret-slug', { withCause: true });

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue(page);
});

describe('the collection route', () => {
  it('is a not-found when nothing is published at the address', async () => {
    server.page.mockResolvedValue(null);

    await expect(
      CollectionRoute({ kind: 'pick', slug: 'nope' }),
    ).rejects.toMatchObject({ digest: notFoundDigest });
  });

  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.page.mockRejectedValue(driverError);

    render(await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The collection page could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Ramble Picks' }),
    ).toBeVisible();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this page",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/picks/rainy-days');
  });

  it('retries the gift guide at its own address', async () => {
    server.page.mockRejectedValue(driverError);

    render(await CollectionRoute({ kind: 'gift_guide', slug: null }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Gift guide' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/gifts');
  });

  it('shows the title and intro over the experiences in the collection order', async () => {
    render(await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }));

    expect(
      screen.getByRole('heading', { level: 1, name: 'Rainy days' }),
    ).toBeVisible();
    expect(
      within(screen.getByRole('banner')).getByText('Intro words'),
    ).toBeVisible();
    expect(screen.getByText('2 experiences')).toBeVisible();
    const titles = screen
      .getAllByRole('link')
      .map((link) => link.textContent)
      .filter((text) => /Pottery|Candle/.test(text));
    expect(titles[0]).toContain('Candle pouring');
    expect(titles[1]).toContain('Pottery');
  });

  it('has no intro text when the collection has none', async () => {
    server.page.mockResolvedValue({
      ...page,
      collection: { ...page.collection, intro: null },
    });

    render(await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }));

    expect(screen.getByRole('banner').querySelector('p')).toBeNull();
  });

  it('puts the results in the element shown with scripting off, which the skip link reaches', async () => {
    const { container } = render(
      await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }),
    );

    const shown = container.querySelector('[data-reveal-without-script]');
    expect(shown).toHaveAttribute('id', landingResultsId);
    expect(shown).toContainElement(screen.getByText('2 experiences'));
  });

  it('says an empty collection is empty, for a page with no filters', async () => {
    server.page.mockResolvedValue({ ...page, experiences: [] });

    render(await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }));

    expect(
      screen.getByRole('heading', { name: 'Nothing here yet' }),
    ).toBeVisible();
    expect(screen.queryByText(/filters/)).not.toBeInTheDocument();
  });

  it('links to browse with no filter', async () => {
    render(await CollectionRoute({ kind: 'pick', slug: 'rainy-days' }));

    expect(
      screen.getByRole('link', { name: 'Pick a day or narrow it down' }),
    ).toHaveAttribute('href', '/new-york/browse');
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.page.mockImplementation(() => {
      notFound();
    });

    await expect(
      CollectionRoute({ kind: 'pick', slug: 'rainy-days' }),
    ).rejects.toMatchObject({ digest: notFoundDigest });
    expect(server.logError).not.toHaveBeenCalled();
  });
});

describe('the collection head', () => {
  it('is the title with the summary as its description', async () => {
    expect(
      await collectionMetadata({ kind: 'pick', slug: 'rainy-days' }),
    ).toEqual({ title: 'Rainy days', description: 'Things to do indoors.' });
  });

  it('has no description when no summary is written', async () => {
    server.page.mockResolvedValue({
      ...page,
      collection: { ...page.collection, summary: null },
    });

    expect(
      await collectionMetadata({ kind: 'pick', slug: 'rainy-days' }),
    ).toEqual({ title: 'Rainy days' });
  });

  it.each([
    ['pick', 'nope', 'Ramble Picks'],
    ['gift_guide', null, 'Gift guide'],
  ] as const)(
    'is the plain title for a missing %s page',
    async (kind, slug, title) => {
      server.page.mockResolvedValue(null);

      expect(await collectionMetadata({ kind, slug })).toEqual({ title });
    },
  );

  it('is the plain title when the read fails, and logs only its digest and kind', async () => {
    server.page.mockRejectedValue(driverError);

    expect(
      await collectionMetadata({ kind: 'pick', slug: 'rainy-days' }),
    ).toEqual({ title: 'Ramble Picks' });
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The collection page head could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
  });
});
