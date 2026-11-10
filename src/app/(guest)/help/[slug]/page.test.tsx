import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { blocks } from '@/lib/seed/richText';
import { makeDriverError } from '../../../../../tests/support/driverError';
import HelpArticleRoute, {
  generateMetadata,
  generateStaticParams,
} from './page';

// Behaviours under test:
// - one placeholder address is prerendered, so the route has a shell
// - a missing or unpublished article is a not-found
// - a published article renders, read by the slug in the address
// - a failed read logs only the digest and kind and renders the error state, which retries at the article's own address
// - the head names the article; a missing one has the not-found title; a failed read falls back to the plain title

const server = vi.hoisted(() => ({ article: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/help', () => ({ getHelpArticle: server.article }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));

const props = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});
const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;
const article = {
  title: 'How do I cancel?',
  summary: 'Use the link.',
  body: blocks('Open your email.'),
};

beforeEach(() => {
  vi.clearAllMocks();
  server.article.mockResolvedValue(article);
});

describe('the help article route', () => {
  it('prerenders one placeholder address', () => {
    expect(generateStaticParams()).toEqual([{ slug: '_' }]);
  });

  it('is a not-found when no published article has the slug', async () => {
    server.article.mockResolvedValue(null);

    await expect(HelpArticleRoute(props('gone'))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('reads the article by the slug in the address and renders it', async () => {
    render(await HelpArticleRoute(props('how-to-cancel')));

    expect(server.article).toHaveBeenCalledExactlyOnceWith('how-to-cancel');
    expect(
      screen.getByRole('heading', { level: 1, name: 'How do I cancel?' }),
    ).toBeVisible();
    expect(screen.getByText('Open your email.')).toBeVisible();
  });

  it('logs only the digest and kind of a failed read and shows the error state', async () => {
    const secret = 'secret-id';
    server.article.mockRejectedValue(
      makeDriverError(secret, { withCause: true }),
    );

    render(await HelpArticleRoute(props('how-to-cancel')));

    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this article",
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBeVisible();
    expect(JSON.stringify(server.logError.mock.calls)).not.toContain(secret);
  });
});

describe('the help article head', () => {
  it('names the article and describes it with its summary', async () => {
    expect(await generateMetadata(props('how-to-cancel'))).toEqual({
      title: 'How do I cancel?',
      description: 'Use the link.',
    });
  });

  it('has the not-found title for a missing article', async () => {
    server.article.mockResolvedValue(null);

    expect(await generateMetadata(props('gone'))).toEqual({
      title: 'Help article not found',
    });
  });

  it('falls back to the plain title when the read fails', async () => {
    server.article.mockRejectedValue(makeDriverError('secret-id'));

    expect(await generateMetadata(props('x'))).toEqual({
      title: 'Help article',
    });
    expect(server.logError).toHaveBeenCalledOnce();
  });
});
