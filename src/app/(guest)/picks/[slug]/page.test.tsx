import { Suspense, type ReactElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { CollectionRoute } from '../CollectionRoute';
import RamblePicksPage, { generateStaticParams } from './page';

// Behaviours under test, one per decision, branch or risk:
// - the build prerenders one placeholder address, which is not a slug
// - an address that is not a slug is a not-found, before anything is read
// - a slug reaches CollectionRoute behind Suspense, so an unknown Pick is not-found in the request

vi.mock('../CollectionRoute', () => ({
  CollectionRoute: vi.fn(),
  collectionMetadata: vi.fn(),
}));

const props = (slug: string) => ({
  params: Promise.resolve({ slug }),
  searchParams: Promise.resolve({}),
});

describe('the Picks route', () => {
  it('prerenders one placeholder address, which is not a slug', () => {
    expect(generateStaticParams()).toEqual([{ slug: 'not_a_slug' }]);
  });

  it.each(['not_a_slug', 'Spring', '', '-x'])(
    'is a not-found for the address %j',
    async (slug) => {
      await expect(RamblePicksPage(props(slug))).rejects.toMatchObject({
        digest: expect.stringContaining(
          'NEXT_HTTP_ERROR_FALLBACK;404',
        ) as string,
      });
    },
  );

  it('hands a slug to CollectionRoute behind Suspense', async () => {
    const element = (await RamblePicksPage(
      props('spring-picks'),
    )) as ReactElement<{
      fallback: null;
      children: ReactElement<{ kind: string; slug: string }>;
    }>;

    expect(element.type).toBe(Suspense);
    expect(element.props.fallback).toBeNull();
    expect(element.props.children.type).toBe(CollectionRoute);
    expect(element.props.children.props).toEqual({
      kind: 'pick',
      slug: 'spring-picks',
    });
  });
});
