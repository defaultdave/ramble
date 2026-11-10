import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDriverError } from '../../../../../tests/support/driverError';
import type { LegalDocument } from '@/lib/legal';
import { blocks } from '@/lib/seed/richText';
import LegalPage, { generateMetadata, generateStaticParams } from './page';

// Behaviours under test, one per decision, branch or risk:
// - a key that is not a document key is a not-found, and nothing is read
// - an unpublished key is a not-found
// - any published key, a waiver included, renders its title and body with the demo label
// - a failed read logs only the digest and kind and renders the error state, which retries at the page's own address
// - the head is the title; a malformed or unpublished key is the not-found title; a failed read falls back to the plain title

const server = vi.hoisted(() => ({ page: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/legalPage', () => ({ getLegalPage: server.page }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
// The renderer is server-only; its own test covers it.
vi.mock('@/components/RichText', () => ({
  RichText: () => <p>Body stub</p>,
}));

const props = (doc: string) => ({
  params: Promise.resolve({ doc }),
  searchParams: Promise.resolve({}),
});
const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;
const published = (doc: string, title: string): LegalDocument => ({
  id: '0190a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b',
  doc,
  version: 1,
  title,
  body: blocks('Demo text.'),
  status: 'published',
  publishedAt: new Date('2026-11-01T12:00:00Z'),
  createdAt: new Date('2026-10-31T12:00:00Z'),
});
const driverError = makeDriverError('secret-id', { withCause: true });

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue(published('terms', 'Terms of service'));
});

describe('the legal route', () => {
  it('prerenders one placeholder key, so the route has a shell', () => {
    expect(generateStaticParams()).toEqual([{ doc: 'sample' }]);
  });

  it.each(['sample', 'Terms', 'waiver-', 'a'.repeat(300)])(
    'is a not-found for the key %j, and reads nothing',
    async (doc) => {
      await expect(LegalPage(props(doc))).rejects.toMatchObject({
        digest: notFoundDigest,
      });
      expect(server.page).not.toHaveBeenCalled();
    },
  );

  it('is a not-found when nothing is published under the key', async () => {
    server.page.mockResolvedValue(null);

    await expect(LegalPage(props('privacy'))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it.each([
    ['terms', 'Terms of service'],
    ['waiver-hudson-paddle-club', 'Hudson Paddle Club waiver'],
  ])('renders the published document for %s', async (doc, title) => {
    server.page.mockResolvedValue(published(doc, title));

    render(await LegalPage(props(doc)));

    expect(server.page).toHaveBeenCalledExactlyOnceWith(doc);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(title);
    expect(screen.getByText('Demo text')).toBeVisible();
    expect(screen.getByText('Body stub')).toBeVisible();
  });

  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.page.mockRejectedValue(driverError);

    render(await LegalPage(props('terms')));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The legal document could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this document",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/legal/terms');
  });
});

describe('the legal head', () => {
  it('is the document title', async () => {
    expect(await generateMetadata(props('terms'))).toEqual({
      title: 'Terms of service',
    });
  });

  it('is the not-found title for a malformed key, without reading', async () => {
    expect(await generateMetadata(props('sample'))).toEqual({
      title: 'Document not found',
    });
    expect(server.page).not.toHaveBeenCalled();
  });

  it('is the not-found title when nothing is published', async () => {
    server.page.mockResolvedValue(null);

    expect(await generateMetadata(props('privacy'))).toEqual({
      title: 'Document not found',
    });
  });

  it('falls back to the plain title on a failed read and logs only the digest and kind', async () => {
    server.page.mockRejectedValue(driverError);

    expect(await generateMetadata(props('terms'))).toEqual({ title: 'Legal' });
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The legal document head could not be read',
      { digest: undefined, kind: 'Error' },
    );
  });
});
