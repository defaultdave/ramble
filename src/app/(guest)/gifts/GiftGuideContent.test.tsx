import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { GiftGuideContent } from './GiftGuideContent';
import { makeDriverError } from '../../../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - with gifts on the page is the gift guide, read with no slug
// - with gifts off the page is a not-found and the guide is not read
// - a failed switch read logs only the digest and kind and renders the error state, which retries at /gifts
// - the switch is read per request, so building the site needs no database

const server = vi.hoisted(() => ({
  settings: vi.fn(),
  connection: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/siteSettings', () => ({
  getCachedGuestSettings: server.settings,
}));
vi.mock('next/server', () => ({ connection: server.connection }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
vi.mock('../picks/CollectionRoute', () => ({
  CollectionRoute: ({ kind, slug }: { kind: string; slug: string | null }) => (
    <p>{`route ${kind} ${String(slug)}`}</p>
  ),
}));

const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;

beforeEach(() => {
  vi.clearAllMocks();
  server.settings.mockResolvedValue({ giftsEnabled: true });
});

describe('the gift guide content', () => {
  it('is the gift guide with gifts on', async () => {
    render(await GiftGuideContent());

    expect(screen.getByText('route gift_guide null')).toBeVisible();
  });

  it('is a not-found with gifts off', async () => {
    server.settings.mockResolvedValue({ giftsEnabled: false });

    await expect(GiftGuideContent()).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('logs only the digest and kind of a failed switch read and renders the error state', async () => {
    server.settings.mockRejectedValue(makeDriverError('secret-slug'));

    render(await GiftGuideContent());

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The gift guide switch could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Gift guide' }),
    ).toBeVisible();
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', '/gifts');
  });

  it('waits for the request before reading anything', async () => {
    await GiftGuideContent();

    expect(server.connection).toHaveBeenCalledBefore(server.settings);
  });
});
