import { beforeEach, describe, expect, it, vi } from 'vitest';
import { idWithLetters } from '@/lib/experiencePage.fixtures';
import { getExperiencePage } from './experiencePage';

// Behaviours under test, one per decision, branch or risk:
// - the page read uses the catalog profile and tags the experience and the catalog
// - an ID that is no guid gives null before anything is tagged or read; the tag is the lower-case ID
// - an experience that is not visible to guests gives null, and nothing else is read for it
// - a visible one comes back with its photos and its place, from the lists of categories and neighborhoods
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  experience: vi.fn(),
  photos: vi.fn(),
  categories: vi.fn(),
  neighborhoods: vi.fn(),
}));
vi.mock('@/server/db/catalog', () => ({
  getGuestExperience: db.experience,
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));
vi.mock('@/server/db/photos', () => ({ listGuestPhotos: db.photos }));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const driverError = new Error(
  'Failed query: select ... where id = $1\nparams: secret-id',
);

beforeEach(() => {
  vi.clearAllMocks();
  db.experience.mockResolvedValue({
    id: id(1),
    categoryId: id(3),
    neighborhoodId: id(4),
  });
  db.photos.mockResolvedValue([{ id: id(100) }]);
  db.categories.mockResolvedValue([
    { id: id(3), slug: 'outdoors', name: 'Outdoors' },
  ]);
  db.neighborhoods.mockResolvedValue([
    { id: id(4), slug: 'tribeca', name: 'Tribeca' },
  ]);
});

describe('getExperiencePage', () => {
  it('uses the catalog profile and tags the experience and the catalog', async () => {
    await getExperiencePage(id(1));

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('catalog');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(
      `experience:${id(1)}`,
      'catalog',
    );
  });

  it.each(['', 'not-a-uuid', `${id(1)}-extra`, 'x'.repeat(100_000)])(
    'gives null for the ID %j, and tags and reads nothing',
    async (bad) => {
      expect(await getExperiencePage(bad)).toBeNull();
      expect(cache.tag).not.toHaveBeenCalled();
      expect(db.experience).not.toHaveBeenCalled();
    },
  );

  it('tags the lower-case ID', async () => {
    await getExperiencePage(idWithLetters.toUpperCase());

    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(
      `experience:${idWithLetters}`,
      'catalog',
    );
  });

  it('comes back with the experience, its photos, and its place', async () => {
    const data = await getExperiencePage(id(1));

    expect(db.experience).toHaveBeenCalledExactlyOnceWith(id(1));
    expect(db.photos).toHaveBeenCalledExactlyOnceWith(id(1));
    expect(data).toEqual({
      experience: { id: id(1), categoryId: id(3), neighborhoodId: id(4) },
      photos: [{ id: id(100) }],
      place: {
        category: { slug: 'outdoors', name: 'Outdoors' },
        neighborhood: { slug: 'tribeca', name: 'Tribeca' },
      },
    });
  });

  it('gives null for an experience guests cannot see, and reads nothing more', async () => {
    db.experience.mockResolvedValue(null);

    expect(await getExperiencePage(id(1))).toBeNull();
    expect(db.photos).not.toHaveBeenCalled();
    expect(db.categories).not.toHaveBeenCalled();
    expect(db.neighborhoods).not.toHaveBeenCalled();
  });

  it('throws only the kind of a failed read', async () => {
    db.experience.mockRejectedValue(driverError);

    const failure = await getExperiencePage(id(1)).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ message: 'Experience read failed: Error' });
    expect(JSON.stringify(failure)).not.toContain('secret-id');
  });

  it('throws the kind of a failure in the lists too', async () => {
    db.categories.mockRejectedValue(driverError);

    const failure = await getExperiencePage(id(1)).catch(
      (error: unknown) => error,
    );

    expect(failure).toMatchObject({ message: 'Experience read failed: Error' });
  });
});
