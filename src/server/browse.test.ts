import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { noFilters } from '@/lib/filters';
import { getBrowseDates, getBrowseResults, getFilterOptions } from './browse';

// Behaviours under test, one per decision, branch or risk:
// - each cached read names its cache profile and tags itself, results with the catalog and every experience they list
// - a failed read throws only the kind of the failure, never the query, its values, or the cause
// - a framework control-flow error passes through unchanged

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  results: vi.fn(),
  dates: vi.fn(),
  categories: vi.fn(),
  neighborhoods: vi.fn(),
}));
vi.mock('@/server/db/browse', () => ({
  listBrowseExperiences: db.results,
  listBrowseDates: db.dates,
}));
vi.mock('@/server/db/catalog', () => ({
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));

const asOf = '2026-10-26T12:00:00.000Z';
const query = { filters: noFilters, after: null };

// What a database error carries: the query text and the values bound to it.
const driverError = new Error(
  'Failed query: select ... where slug in ($1)\nparams: secret-slug,2026-11-07',
);

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getBrowseResults', () => {
  it('uses the browse profile and tags the catalog and each listed experience', async () => {
    db.results.mockResolvedValue({
      ok: true,
      items: [{ id: 'a' }, { id: 'b' }],
      nextCursor: null,
    });

    await getBrowseResults(query, asOf);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('browse');
    expect(cache.tag.mock.calls.flat()).toEqual([
      'catalog',
      'experience:a',
      'experience:b',
    ]);
  });

  it('tags only the catalog when the cursor was not found', async () => {
    db.results.mockResolvedValue({ ok: false, reason: 'cursor_not_found' });

    await expect(getBrowseResults(query, asOf)).resolves.toEqual({
      ok: false,
      reason: 'cursor_not_found',
    });

    expect(cache.tag.mock.calls.flat()).toEqual(['catalog']);
  });

  it('throws the kind of a failed read and not the query or its values', async () => {
    db.results.mockRejectedValue(driverError);

    const failure = await getBrowseResults(query, asOf).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      name: 'BrowseReadError',
      message: 'Browse read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-slug');
    expect((failure as Error).cause).toBeUndefined();
  });

  it('passes a framework control-flow error through', async () => {
    db.results.mockImplementation(() => {
      notFound();
    });

    await expect(getBrowseResults(query, asOf)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
  });
});

describe('getBrowseDates', () => {
  it('uses the browse profile and tags the catalog', async () => {
    db.dates.mockResolvedValue(['2026-11-07']);

    await expect(
      getBrowseDates({ categories: [], neighborhoods: [] }, asOf),
    ).resolves.toEqual(['2026-11-07']);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('browse');
    expect(cache.tag.mock.calls.flat()).toEqual(['catalog']);
  });

  it('throws only the kind of a failed read', async () => {
    db.dates.mockRejectedValue(driverError);

    await expect(
      getBrowseDates({ categories: [], neighborhoods: [] }, asOf),
    ).rejects.toThrow('Browse read failed: Error');
  });
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

    await expect(getFilterOptions()).rejects.toThrow(
      'Browse read failed: Error',
    );
  });

  it('names a thrown value that is not an Error as unknown', async () => {
    db.categories.mockRejectedValue('plain text');
    db.neighborhoods.mockResolvedValue([]);

    await expect(getFilterOptions()).rejects.toThrow(
      'Browse read failed: unknown',
    );
  });
});
