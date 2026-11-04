import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheEntryTagCounts } from '@/lib/pages/cacheTagBudget';
import { tagsForChanges } from '@/lib/cacheTags';
import { getLandingData } from './landing';
import { makeDriverError } from '../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - a known category or neighborhood is read with the editorial profile, tagged with its own tag and the names, and returns its name and published copy
// - a page with no published copy still has its name and a null copy
// - a slug the catalog does not have for the kind answers null with the uncached profile and reads no copy
// - a malformed slug answers null before the cache or the database is asked
// - editing a page's copy publishes the tag its entry carries
// - a failed copy read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  copy: vi.fn(),
  categories: vi.fn(),
  neighborhoods: vi.fn(),
}));
vi.mock('@/server/db/editorial', () => ({ getPublishedPageCopy: db.copy }));
vi.mock('@/server/db/catalog', () => ({
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));

const copy = { id: '1', kind: 'category', slug: 'cooking', heading: 'Cooking' };
const driverError = makeDriverError('secret-slug');

beforeEach(() => {
  vi.clearAllMocks();
  db.categories.mockResolvedValue([
    { id: '1', slug: 'cooking', name: 'Cooking' },
  ]);
  db.neighborhoods.mockResolvedValue([
    { id: '2', slug: 'dumbo', name: 'DUMBO' },
  ]);
  db.copy.mockResolvedValue(copy);
});

describe('getLandingData', () => {
  it.each([
    ['category', 'cooking', 'Cooking', 'category:cooking'],
    ['neighborhood', 'dumbo', 'DUMBO', 'neighborhood:dumbo'],
  ] as const)(
    'reads a %s page with the editorial profile and its own tag',
    async (kind, slug, name, tag) => {
      await expect(getLandingData(kind, slug)).resolves.toEqual({
        name,
        copy,
      });

      expect(db.copy).toHaveBeenCalledExactlyOnceWith(kind, slug);
      expect(cache.life.mock.calls.flat()).toEqual(['editorial', 'editorial']);
      expect(cache.tag.mock.calls.flat().sort()).toEqual([tag, 'taxonomy']);
      expect(cache.tag.mock.calls.flat()).toHaveLength(
        cacheEntryTagCounts.landing,
      );
    },
  );

  it('keeps the name when no copy is published', async () => {
    db.copy.mockResolvedValue(null);

    await expect(getLandingData('category', 'cooking')).resolves.toEqual({
      name: 'Cooking',
      copy: null,
    });
  });

  it.each([
    ['category', 'dumbo'],
    ['neighborhood', 'cooking'],
    ['neighborhood', 'no-such-place'],
  ] as const)(
    'answers null for %s %j, uncached, without a copy read',
    async (kind, slug) => {
      await expect(getLandingData(kind, slug)).resolves.toBeNull();

      expect(cache.life.mock.calls.flat().at(-1)).toBe('uncached');
      expect(db.copy).not.toHaveBeenCalled();
    },
  );

  it.each(['Not A Slug', 'not_a_slug', ''])(
    'answers null for the malformed slug %j without touching the cache or the database',
    async (slug) => {
      await expect(getLandingData('category', slug)).resolves.toBeNull();

      expect(cache.life).not.toHaveBeenCalled();
      expect(db.categories).not.toHaveBeenCalled();
      expect(db.copy).not.toHaveBeenCalled();
    },
  );

  it('throws only the kind of a failed copy read', async () => {
    db.copy.mockRejectedValue(driverError);

    const failure = await getLandingData('category', 'cooking').catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      message: 'Landing page copy read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
  });
});

describe('the cache entry', () => {
  it.each([
    [{ kind: 'categoryCopy', slug: 'cooking' }, 'category:cooking'],
    [{ kind: 'neighborhoodCopy', slug: 'dumbo' }, 'neighborhood:dumbo'],
  ] as const)(
    'is reached by the tag a %j edit publishes',
    async (change, tag) => {
      await getLandingData(
        change.kind === 'categoryCopy' ? 'category' : 'neighborhood',
        change.slug,
      );

      const carried = cache.tag.mock.calls.flat() as string[];
      expect(tagsForChanges([change]).some((t) => carried.includes(t))).toBe(
        true,
      );
      expect(carried).toContain(tag);
    },
  );
});
