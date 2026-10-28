import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { experience, id, place } from '@/lib/experiencePage.fixtures';
import ExperienceRoute, {
  generateMetadata,
  generateStaticParams,
} from './page';

// Behaviours under test, one per decision, branch or risk:
// - an address that is not a slug and an ID is a not-found, before anything is read
// - an experience that is not visible to guests, and a guide entry, are a not-found
// - a visible experience renders its page, with the gift entry only while gifts are on
// - a failed read logs only the digest and renders the error state, which retries at the page's own address
// - a framework control-flow error is rethrown and not logged
// - the head names the experience and describes it; anything unreadable falls back to the plain title

const server = vi.hoisted(() => ({
  page: vi.fn(),
  settings: vi.fn(),
  logError: vi.fn(),
}));
vi.mock('@/server/experiencePage', () => ({ getExperiencePage: server.page }));
vi.mock('@/server/siteSettings', () => ({
  getCachedGuestSettings: server.settings,
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));

const address = `sunset-kayak-${id(1)}`;
const props = (slugAndId: string) => ({
  params: Promise.resolve({ slugAndId }),
  searchParams: Promise.resolve({}),
});

const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;

// What a database error carries: the query text and the values bound to it.
const driverError = Object.assign(
  new Error('Failed query: select ... where id = $1\nparams: secret-id'),
  { cause: new Error('connection to secret-host refused') },
);

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue({
    experience: experience(),
    photos: [],
    place,
  });
  server.settings.mockResolvedValue({ giftsEnabled: true, bannerText: null });
});

describe('the experience route', () => {
  it('prerenders one placeholder address, so the route has a shell', () => {
    expect(generateStaticParams()).toEqual([{ slugAndId: 'sample' }]);
  });

  it.each(['sample', '', id(1), `kayak-${id(1)}-x`])(
    'is a not-found for the address %j, and reads nothing',
    async (slugAndId) => {
      await expect(ExperienceRoute(props(slugAndId))).rejects.toMatchObject({
        digest: notFoundDigest,
      });
      expect(server.page).not.toHaveBeenCalled();
    },
  );

  it('reads the experience by the ID in the address, lower-cased', async () => {
    await ExperienceRoute(props(`sunset-kayak-${id(1).toUpperCase()}`));

    expect(server.page).toHaveBeenCalledExactlyOnceWith(id(1));
  });

  it('is a not-found when the experience is not visible to guests', async () => {
    server.page.mockResolvedValue(null);

    await expect(ExperienceRoute(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('is a not-found for a guide entry, which has its own page', async () => {
    server.page.mockResolvedValue({
      experience: experience({
        status: 'guide_only',
        linkOutUrl: 'https://host.example/',
      }),
      photos: [],
      place,
    });

    await expect(ExperienceRoute(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('renders the page of a visible experience, with the gift entry while gifts are on', async () => {
    render(await ExperienceRoute(props(address)));

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Sunset kayak on the Hudson',
    );
    expect(
      screen.getByRole('link', { name: 'Give this as a gift' }),
    ).toHaveAttribute('href', `/gifts/checkout/${id(1)}`);
  });

  it('has no gift entry while gifts are off', async () => {
    server.settings.mockResolvedValue({
      giftsEnabled: false,
      bannerText: null,
    });

    render(await ExperienceRoute(props(address)));

    expect(
      screen.queryByRole('link', { name: 'Give this as a gift' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['the experience', () => server.page.mockRejectedValue(driverError)],
    ['the settings', () => server.settings.mockRejectedValue(driverError)],
  ])(
    'logs only the digest of a failed read of %s and renders the error state',
    async (_name, fail) => {
      fail();

      render(await ExperienceRoute(props(address)));

      expect(server.logError).toHaveBeenCalledExactlyOnceWith(
        'The experience page could not be read',
        { digest: undefined },
      );
      expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
        /secret|Failed query/,
      );
      expect(screen.getByRole('alert')).toHaveTextContent(
        "We couldn't load this experience",
      );
      expect(
        screen.getByRole('button', { name: 'Try again' }).closest('form'),
      ).toHaveAttribute('action', `/experiences/${address}`);
    },
  );

  it('logs the digest a cached read carries', async () => {
    server.page.mockRejectedValue(
      Object.assign(new Error('secret-id'), { digest: '1234567' }),
    );

    render(await ExperienceRoute(props(address)));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The experience page could not be read',
      { digest: '1234567' },
    );
  });

  it('rethrows a framework control-flow error and logs nothing', async () => {
    server.page.mockImplementation(() => {
      notFound();
    });

    await expect(ExperienceRoute(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
    expect(server.logError).not.toHaveBeenCalled();
  });
});

describe('the experience head', () => {
  it('names the experience and describes it from its opening', async () => {
    expect(await generateMetadata(props(address))).toEqual({
      title: 'Sunset kayak on the Hudson',
      description: 'Paddle out as the light goes gold.',
    });
  });

  it('is the plain title for an address that is not one, without reading', async () => {
    expect(await generateMetadata(props('sample'))).toEqual({
      title: 'Experience',
    });
    expect(server.page).not.toHaveBeenCalled();
  });

  it('is the plain title when the experience is not there', async () => {
    server.page.mockResolvedValue(null);

    expect(await generateMetadata(props(address))).toEqual({
      title: 'Experience',
    });
  });

  it('falls back to the plain title when the read fails, and logs nothing of it', async () => {
    server.page.mockRejectedValue(driverError);

    expect(await generateMetadata(props(address))).toEqual({
      title: 'Experience',
    });
    expect(server.logError).not.toHaveBeenCalled();
  });

  it('rethrows a framework control-flow error', async () => {
    server.page.mockImplementation(() => {
      notFound();
    });

    await expect(generateMetadata(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });
});
