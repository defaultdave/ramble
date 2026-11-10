import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeDriverError } from '../../../../../tests/support/driverError';
import {
  experience,
  id,
  idWithLetters,
  place,
} from '../../../../../tests/support/fixtures/experience';
import GuideEntryRoute, {
  generateMetadata,
  generateStaticParams,
} from './page';

// Behaviours under test, one per decision, branch or risk:
// - an address that is not a slug and an ID is a not-found, before anything is read
// - an experience that is not visible, and a live one, are a not-found
// - a guide entry renders its page, read by the ID in the address, lower-cased
// - the "you can book" module is handed the entry, its category slug, and its category name
// - a failed read logs only the digest and kind and renders the error state, which retries at the page's own address
// - the head names the entry; a live or missing one is the not-found title; a failed read falls back to the plain title

const server = vi.hoisted(() => ({ page: vi.fn(), logError: vi.fn() }));
vi.mock('@/server/experiencePage', () => ({ getExperiencePage: server.page }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { error: server.logError },
}));
// An async Server Component cannot render under Testing Library; its own test covers it.
const related = vi.hoisted(() => ({ content: vi.fn() }));
vi.mock('./RelatedContent', () => ({
  RelatedContent: (props: unknown) => {
    related.content(props);
    return <p>Related stub</p>;
  },
}));

const address = `sourdough-mornings-${id(1)}`;
const props = (slugAndId: string) => ({
  params: Promise.resolve({ slugAndId }),
  searchParams: Promise.resolve({}),
});
const notFoundDigest = expect.stringContaining(
  'NEXT_HTTP_ERROR_FALLBACK;404',
) as string;
const guide = () => ({
  experience: experience({
    status: 'guide_only',
    name: 'Sourdough mornings',
    linkOutUrl: 'https://rise.example/',
    priceOptions: [],
  }),
  photos: [],
  place,
});
const driverError = makeDriverError('secret-id', { withCause: true });

beforeEach(() => {
  vi.clearAllMocks();
  server.page.mockResolvedValue(guide());
});

describe('the guide entry route', () => {
  it('prerenders one placeholder address, so the route has a shell', () => {
    expect(generateStaticParams()).toEqual([{ slugAndId: 'sample' }]);
  });

  it.each(['sample', '', id(1), `x-${id(1)}-y`])(
    'is a not-found for the address %j, and reads nothing',
    async (slugAndId) => {
      await expect(GuideEntryRoute(props(slugAndId))).rejects.toMatchObject({
        digest: notFoundDigest,
      });
      expect(server.page).not.toHaveBeenCalled();
    },
  );

  it('is a not-found when nothing visible has the ID', async () => {
    server.page.mockResolvedValue(null);

    await expect(GuideEntryRoute(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('is a not-found for a live experience, which has its own page', async () => {
    server.page.mockResolvedValue({
      experience: experience(),
      photos: [],
      place,
    });

    await expect(GuideEntryRoute(props(address))).rejects.toMatchObject({
      digest: notFoundDigest,
    });
  });

  it('reads the entry by the ID in the address, lower-cased, and renders it', async () => {
    render(
      await GuideEntryRoute(
        props(`sourdough-mornings-${idWithLetters.toUpperCase()}`),
      ),
    );

    expect(server.page).toHaveBeenCalledExactlyOnceWith(idWithLetters);
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(
      'Sourdough mornings',
    );
  });

  it('hands the module the entry and its category', async () => {
    render(await GuideEntryRoute(props(address)));

    expect(screen.getByText('Related stub')).toBeVisible();
    expect(related.content).toHaveBeenCalledExactlyOnceWith({
      entryId: id(1),
      categorySlug: 'outdoors',
      categoryName: 'Outdoors',
    });
  });

  it('logs only the digest and kind of a failed read and renders the error state', async () => {
    server.page.mockRejectedValue(driverError);

    render(await GuideEntryRoute(props(address)));

    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The guide entry could not be read',
      { digest: undefined, kind: 'Error' },
    );
    expect(JSON.stringify(server.logError.mock.calls)).not.toMatch(
      /secret|Failed query/,
    );
    expect(screen.getByRole('alert')).toHaveTextContent(
      "We couldn't load this entry",
    );
    expect(
      screen.getByRole('button', { name: 'Try again' }).closest('form'),
    ).toHaveAttribute('action', `/guide/${address}`);
  });
});

describe('the guide entry head', () => {
  it('names the entry', async () => {
    expect(await generateMetadata(props(address))).toEqual({
      title: 'Sourdough mornings',
    });
  });

  it('is the not-found title for an address that is not one, without reading', async () => {
    expect(await generateMetadata(props('sample'))).toEqual({
      title: 'Guide entry not found',
    });
    expect(server.page).not.toHaveBeenCalled();
  });

  it.each([null, { experience: experience(), photos: [], place }])(
    'is the not-found title for a missing or live experience',
    async (data) => {
      server.page.mockResolvedValue(data);

      expect(await generateMetadata(props(address))).toEqual({
        title: 'Guide entry not found',
      });
    },
  );

  it('falls back to the plain title on a failed read and logs only the digest and kind', async () => {
    server.page.mockRejectedValue(driverError);

    expect(await generateMetadata(props(address))).toEqual({
      title: 'Guide entry',
    });
    expect(server.logError).toHaveBeenCalledExactlyOnceWith(
      'The guide entry head could not be read',
      { digest: undefined, kind: 'Error' },
    );
  });
});
