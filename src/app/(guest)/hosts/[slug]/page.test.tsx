import '@testing-library/jest-dom/vitest';
import { Suspense, type ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDriverError } from '../../../../../tests/support/driverError';
import { id } from '../../../../../tests/support/fixtures/experience';
import { HostContent } from './HostContent';
import HostRoute, { generateMetadata, generateStaticParams } from './page';

// Behaviours under test, one per decision, branch or risk:
// - the build prerenders one placeholder address, so the route has a shell
// - an address that is not a slug is a not-found, before anything is read
// - a host slug reaches HostContent behind Suspense and reads nothing itself (the content's tests are in HostContent.test.tsx)
// - the head names the host and describes it; a missing host is the not-found title; a failed read falls back to the plain title

const server = vi.hoisted(() => ({ page: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/hostPage', () => ({ getHostPage: server.page }));
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
const driverError = makeDriverError('secret-id', { withCause: true });

const page = (description: string | null = 'Six guides.') => ({
  host: {
    id: id(2),
    slug: 'hudson-paddle-club',
    name: 'Hudson Paddle Club',
    description,
  },
  experiences: [],
  tiers: [],
});

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue(page());
});

describe('the host route', () => {
  it('prerenders one placeholder address, so the route has a shell', () => {
    expect(generateStaticParams()).toEqual([{ slug: 'not_a_slug' }]);
  });

  it.each(['not_a_slug', 'Hudson', '', '-x', 'x'.repeat(301)])(
    'is a not-found for the address %j, and reads nothing',
    async (slug) => {
      await expect(HostRoute(props(slug))).rejects.toMatchObject({
        digest: notFoundDigest,
      });
      expect(server.page).not.toHaveBeenCalled();
    },
  );

  it('hands a host slug to HostContent behind Suspense, so an unknown one is not-found in the request', async () => {
    const element = (await HostRoute(
      props('hudson-paddle-club'),
    )) as ReactElement<{
      fallback: null;
      children: ReactElement<{ slug: string }>;
    }>;

    expect(element.type).toBe(Suspense);
    expect(element.props.fallback).toBeNull();
    expect(element.props.children.type).toBe(HostContent);
    expect(element.props.children.props).toEqual({
      slug: 'hudson-paddle-club',
    });
    expect(server.page).not.toHaveBeenCalled();
  });
});

describe('the host head', () => {
  it('names the host and describes it from the about text', async () => {
    expect(await generateMetadata(props('hudson-paddle-club'))).toEqual({
      title: 'Hudson Paddle Club',
      description: 'Six guides.',
    });
  });

  it('has no description when the host wrote no about text', async () => {
    server.page.mockResolvedValue(page(null));

    expect(await generateMetadata(props('hudson-paddle-club'))).toEqual({
      title: 'Hudson Paddle Club',
    });
  });

  it('is the not-found title for an address that is no slug, without reading', async () => {
    expect(await generateMetadata(props('not_a_slug'))).toEqual({
      title: 'Host not found',
    });
    expect(server.page).not.toHaveBeenCalled();
  });

  it('is the not-found title for a host nobody has', async () => {
    server.page.mockResolvedValue(null);

    expect(await generateMetadata(props('nobody'))).toEqual({
      title: 'Host not found',
    });
  });

  it('falls back to the plain title on a failed read and logs only its digest and kind', async () => {
    server.page.mockRejectedValue(driverError);

    expect(await generateMetadata(props('hudson-paddle-club'))).toEqual({
      title: 'Host',
    });
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The host head could not be read',
      { digest: undefined, kind: 'Error' },
    );
  });
});
