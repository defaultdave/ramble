import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getFilterOptions } from './filterOptions';

// Behaviours under test, one per decision, branch or risk:
// - the read uses the catalog profile and returns both lists
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({ categories: vi.fn(), neighborhoods: vi.fn() }));
vi.mock('@/server/db/catalog', () => ({
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));

const driverError = new Error(
  'Failed query: select ... where slug in ($1)\nparams: secret-slug',
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getFilterOptions', () => {
  it('uses the catalog profile and returns both lists', async () => {
    db.categories.mockResolvedValue([
      { id: '1', slug: 'cooking', name: 'Cooking' },
    ]);
    db.neighborhoods.mockResolvedValue([]);

    await expect(getFilterOptions()).resolves.toEqual({
      categories: [{ id: '1', slug: 'cooking', name: 'Cooking' }],
      neighborhoods: [],
    });

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('catalog');
    expect(cache.tag.mock.calls.flat()).toEqual(['catalog']);
  });

  it('throws only the kind of a failed read', async () => {
    db.categories.mockRejectedValue(driverError);
    db.neighborhoods.mockResolvedValue([]);

    const failure = await getFilterOptions().catch((error: unknown) => error);

    expect(failure).toMatchObject({
      message: 'Filter options read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
  });

  it('names a thrown value that is not an Error as unknown', async () => {
    db.categories.mockRejectedValue('plain text');
    db.neighborhoods.mockResolvedValue([]);

    await expect(getFilterOptions()).rejects.toThrow(
      'Filter options read failed: unknown',
    );
  });
});
