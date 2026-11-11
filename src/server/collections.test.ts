import { beforeEach, describe, expect, it, vi } from 'vitest';
import { tagsForChanges } from '@/lib/cacheTags';
import { getCollectionPage } from './collections';
import { id } from '../../tests/support/ids';
import { makeDriverError } from '../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - a published Pick is read with the editorial profile and carries its own tag, the catalog tag, and one tag per entry
// - the gift guide is read the same way under the gift guide tag
// - the experiences are read by the entries' IDs with their covers; a collection with no entries reads none
// - a Pick that is missing or a draft answers null, uncached, and reads no experiences
// - a malformed slug answers null before the cache or the database is asked, and the gift guide needs no slug
// - what an editor's save or a listing change publishes reaches the entry's tags
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  pick: vi.fn(),
  giftGuide: vi.fn(),
  experiences: vi.fn(),
}));
vi.mock('@/server/db/editorial', () => ({
  getPublishedPick: db.pick,
  getPublishedGiftGuide: db.giftGuide,
}));
vi.mock('@/server/db/home', () => ({ listHomeExperiences: db.experiences }));

const collection = {
  id: id(50),
  kind: 'pick',
  slug: 'rainy-days',
  title: 'Rainy days',
  items: [
    { experienceId: id(2), note: null },
    { experienceId: id(1), note: null },
  ],
};
const experiences = [{ id: id(1) }, { id: id(2) }];
const driverError = makeDriverError('secret-slug');

const carriedTags = () => cache.tag.mock.calls.flat() as string[];

beforeEach(() => {
  vi.clearAllMocks();
  db.pick.mockResolvedValue(collection);
  db.giftGuide.mockResolvedValue({
    ...collection,
    kind: 'gift_guide',
    slug: 'gift-guide',
  });
  db.experiences.mockResolvedValue(experiences);
});

describe('getCollectionPage', () => {
  it('reads a Pick with the editorial profile and tags it with itself, the catalog, and each entry', async () => {
    await expect(getCollectionPage('pick', 'rainy-days')).resolves.toEqual({
      collection,
      experiences,
    });

    expect(db.pick).toHaveBeenCalledExactlyOnceWith('rainy-days');
    expect(cache.life.mock.calls.flat()).toEqual(['editorial']);
    expect(carriedTags().sort()).toEqual(
      [
        'catalog',
        'pick:rainy-days',
        `experience:${id(1)}`,
        `experience:${id(2)}`,
      ].sort(),
    );
  });

  it('reads the gift guide under its own tag, with no slug', async () => {
    const page = await getCollectionPage('gift_guide', null);

    expect(page?.collection.kind).toBe('gift_guide');
    expect(db.giftGuide).toHaveBeenCalledOnce();
    expect(db.pick).not.toHaveBeenCalled();
    expect(carriedTags()).toContain('gift-guide');
  });

  it('asks for the entries by ID with their covers', async () => {
    await getCollectionPage('pick', 'rainy-days');

    expect(db.experiences).toHaveBeenCalledExactlyOnceWith([id(2), id(1)], {
      covers: true,
    });
  });

  it('reads no experiences for a collection with no entries', async () => {
    db.pick.mockResolvedValue({ ...collection, items: [] });

    await expect(getCollectionPage('pick', 'rainy-days')).resolves.toEqual({
      collection: { ...collection, items: [] },
      experiences: [],
    });
    expect(db.experiences).not.toHaveBeenCalled();
  });

  it.each([
    ['pick', 'no-such-pick'],
    ['gift_guide', null],
  ] as const)(
    'answers null for a missing or draft %s, uncached, without reading experiences',
    async (kind, slug) => {
      db.pick.mockResolvedValue(null);
      db.giftGuide.mockResolvedValue(null);

      await expect(getCollectionPage(kind, slug)).resolves.toBeNull();

      expect(cache.life.mock.calls.flat().at(-1)).toBe('uncached');
      expect(db.experiences).not.toHaveBeenCalled();
    },
  );

  it.each(['Not A Slug', 'not_a_slug', ''])(
    'answers null for the malformed slug %j without touching the cache or the database',
    async (slug) => {
      await expect(getCollectionPage('pick', slug)).resolves.toBeNull();

      expect(cache.life).not.toHaveBeenCalled();
      expect(db.pick).not.toHaveBeenCalled();
    },
  );

  it('answers null for a Pick asked for without a slug', async () => {
    await expect(getCollectionPage('pick', null)).resolves.toBeNull();

    expect(db.pick).not.toHaveBeenCalled();
  });

  it.each([
    ['the collection read', () => db.pick.mockRejectedValue(driverError)],
    [
      'the experiences read',
      () => db.experiences.mockRejectedValue(driverError),
    ],
  ])('throws only the kind of a failed %s', async (_read, fail) => {
    fail();

    const failure = await getCollectionPage('pick', 'rainy-days').catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
    expect((failure as Error).message).not.toContain('secret-slug');
    expect((failure as Error).message).toMatch(/read failed: Error$/);
  });
});

describe('the cache entry', () => {
  it.each([
    { why: 'a save of the Pick', change: { kind: 'pick', slug: 'rainy-days' } },
    {
      why: 'a listing change, even of an experience the entry does not hold yet',
      change: {
        kind: 'listing',
        id: id(9),
        categorySlugs: [],
        neighborhoodSlug: 'dumbo',
      },
    },
  ] as const)('is reached by $why', async ({ change }) => {
    await getCollectionPage('pick', 'rainy-days');

    const carried = carriedTags();
    expect(tagsForChanges([change]).some((tag) => carried.includes(tag))).toBe(
      true,
    );
  });

  it('is reached by a save of the gift guide', async () => {
    await getCollectionPage('gift_guide', null);

    expect(
      tagsForChanges([{ kind: 'giftGuide' }]).some((tag) =>
        carriedTags().includes(tag),
      ),
    ).toBe(true);
  });
});
