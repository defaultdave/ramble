import { notFound } from 'next/navigation';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { browseTitle } from '@/lib/browse';
import { noFilters } from '@/lib/filters';
import {
  getBrowseDates,
  getBrowseResults,
  getBrowseTitle,
  getFilterOptions,
} from './browse';

// Behaviours under test, one per decision, branch or risk:
// - each cached read names its cache profile and tags itself, results with the catalog and every experience they list
// - a failed read throws only the name of the read and the kind of the failure, never the query, its values, or the cause
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
  listBrowseDayRows: db.dates,
}));
vi.mock('@/server/db/catalog', () => ({
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));

const log = vi.hoisted(() => ({ error: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({ logger: log }));

const asOf = '2026-10-26T12:00:00.000Z';
const query = { filters: noFilters, after: null };
const cursorId = '00000000-0000-4000-8000-0000000000aa';

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
      cursor: null,
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
    db.results.mockResolvedValue({ cursor: null, items: [], nextCursor: null });

    await expect(
      getBrowseResults({ ...query, after: cursorId }, asOf),
    ).resolves.toEqual({
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
      name: 'CachedReadError',
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
    db.dates.mockResolvedValue({
      storedDates: ['2026-11-08'],
      handEntered: [
        { startsAt: new Date('2026-11-07T16:00:00Z'), timeZone: 'Asia/Tokyo' },
      ],
    });

    await expect(
      getBrowseDates({ categories: [], neighborhoods: [] }, asOf),
    ).resolves.toEqual(['2026-11-08']);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('browse');
    expect(cache.tag.mock.calls.flat()).toEqual(['catalog']);
  });

  it('throws only the kind of a failed read', async () => {
    db.dates.mockRejectedValue(driverError);

    await expect(
      getBrowseDates({ categories: [], neighborhoods: [] }, asOf),
    ).rejects.toThrow('Browse dates read failed: Error');
  });
});

describe('getBrowseDates with a session the calendar cannot place', () => {
  it('throws only the kind of the failure and not the zone', async () => {
    db.dates.mockResolvedValue({
      storedDates: [],
      handEntered: [
        { startsAt: new Date('2026-11-07T16:00:00Z'), timeZone: 'Mars/Phobos' },
      ],
    });

    const failure = await getBrowseDates(
      { categories: [], neighborhoods: [] },
      asOf,
    ).catch((error: unknown) => error);

    expect(failure).toMatchObject({
      name: 'CachedReadError',
      message: 'Browse dates read failed: RangeError',
    });
    expect(JSON.stringify(failure)).not.toContain('Phobos');
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
      'Filter options read failed: Error',
    );
  });

  it('names a thrown value that is not an Error as unknown', async () => {
    db.categories.mockRejectedValue('plain text');
    db.neighborhoods.mockResolvedValue([]);

    await expect(getFilterOptions()).rejects.toThrow(
      'Filter options read failed: unknown',
    );
  });
});

describe('getBrowseTitle', () => {
  const cooking = { id: '1', slug: 'cooking', name: 'Cooking' };
  const filtered = { ...noFilters, categories: ['cooking'] };

  it('names the filters in the title', async () => {
    db.categories.mockResolvedValue([cooking]);
    db.neighborhoods.mockResolvedValue([]);

    await expect(getBrowseTitle(filtered)).resolves.toBe(
      browseTitle(filtered, { categories: [cooking], neighborhoods: [] }),
    );
  });

  it('returns the title without filter names, logs only the digest and kind, and does not throw when the read fails', async () => {
    db.categories.mockRejectedValue(driverError);
    db.neighborhoods.mockResolvedValue([]);

    await expect(getBrowseTitle(filtered)).resolves.toBe(
      browseTitle(filtered, { categories: [], neighborhoods: [] }),
    );

    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'Browse title could not be read',
      { digest: undefined, kind: 'CachedReadError' },
    );
    expect(JSON.stringify(log.error.mock.calls)).not.toContain('secret-slug');
  });

  it('passes a framework control-flow error through', async () => {
    db.categories.mockImplementation(() => {
      notFound();
    });
    db.neighborhoods.mockResolvedValue([]);

    await expect(getBrowseTitle(filtered)).rejects.toMatchObject({
      digest: expect.stringContaining('NEXT_HTTP_ERROR_FALLBACK') as string,
    });
    expect(log.error).not.toHaveBeenCalled();
  });
});
