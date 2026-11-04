import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cacheTagBudget } from '@/lib/pages/cacheTagBudget';
import { photoLimits } from '@/lib/photos';
import { idWithLetters } from '../../tests/support/fixtures/experience';
import { getCoverPhotos } from './coverPhotos';
import { id } from '../../tests/support/ids';
import { makeDriverError } from '../../tests/support/driverError';

// Behaviours under test, one per decision, branch or risk:
// - the cover read uses the catalog profile and tags the experience of every ID it was asked about
// - the list is checked before anything is tagged or read: a list past the limit and an ID that is no uuid are refused by kind alone, with no tag and no read
// - the tag of an experience is its lower-case ID
// - it reads exactly the IDs it was given and returns what the data layer found
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({ covers: vi.fn() }));
vi.mock('@/server/db/photos', () => ({ listGuestCoverPhotos: db.covers }));

const driverError = makeDriverError('secret-id');

beforeEach(() => {
  vi.clearAllMocks();
  db.covers.mockResolvedValue([]);
});

describe('getCoverPhotos', () => {
  it('uses the catalog profile and tags each experience it was asked about', async () => {
    await getCoverPhotos([id(1), id(2)]);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('catalog');
    expect(cache.tag.mock.calls.flat()).toEqual([
      `experience:${id(1)}`,
      `experience:${id(2)}`,
    ]);
  });

  it('carries no more tags than the budget when asked for the most covers it takes', async () => {
    await getCoverPhotos(
      Array.from({ length: photoLimits.maxCoverLookups }, (_, n) => id(n)),
    );

    expect(cache.tag).toHaveBeenCalledTimes(photoLimits.maxCoverLookups);
    expect(cache.tag.mock.calls.length).toBeLessThanOrEqual(cacheTagBudget);
  });

  it('tags the lower-case ID', async () => {
    await getCoverPhotos([idWithLetters.toUpperCase()]);

    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(
      `experience:${idWithLetters}`,
    );
  });

  it.each([
    ['a list past the limit', Array.from({ length: 100_000 }, (_, n) => id(n))],
    ['an ID that is no uuid', ['not-a-uuid\nsecret-id']],
  ])(
    'refuses %s by kind alone, before tagging or reading',
    async (_name, ids) => {
      const failure = await getCoverPhotos(ids).catch(
        (error: unknown) => error,
      );

      expect(failure).toMatchObject({
        message: 'Cover photos read failed: ZodError',
      });
      expect(JSON.stringify(failure)).not.toContain('secret-id');
      expect(cache.tag).not.toHaveBeenCalled();
      expect(db.covers).not.toHaveBeenCalled();
    },
  );

  it('reads the IDs it was given and returns what was found', async () => {
    db.covers.mockResolvedValue([{ id: id(100) }]);

    const covers = await getCoverPhotos([id(1)]);

    expect(db.covers).toHaveBeenCalledExactlyOnceWith([id(1)]);
    expect(covers).toEqual([{ id: id(100) }]);
  });

  it('throws only the kind of a failed read', async () => {
    db.covers.mockRejectedValue(driverError);

    const failure = await getCoverPhotos([id(1)]).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({
      message: 'Cover photos read failed: Error',
    });
    expect(JSON.stringify(failure)).not.toContain('secret-id');
  });
});
