import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';
import { photoLimits } from '@/lib/photos';
import { experiences, photos } from '@/server/db/schema';
import {
  client,
  insertExperience,
  newPhoto,
  ops,
  photoStore,
  setupPhotosDatabase,
  storage,
  validUpload,
} from './photosFixtures';

// Behaviours under test:
// - guests list the photos of live and guide-only experiences in order, and none of a hidden one
// - a batch cover read gives each listed experience its lowest-position photo (a gap at 0 included), once each, and nothing for an experience with no photo, a hidden one, or one not listed
// - a batch cover read takes no IDs, refuses a malformed ID and a list past the limit before reading, and is capped at one row per experience

setupPhotosDatabase();

describe('listGuestPhotos', () => {
  async function add(experienceId: string, altText: string) {
    return photoStore.addPhoto(
      ops,
      newPhoto(experienceId, { description: { decorative: false, altText } }),
      validUpload,
      storage,
    );
  }

  it('lists a live experience in gallery order, with only what a page renders', async () => {
    const experience = await insertExperience();
    await add(experience.id, 'first');
    await add(experience.id, 'second');
    await add(experience.id, 'third');

    const listed = await photoStore.listGuestPhotos(experience.id);

    expect(listed.map((photo) => photo.altText)).toEqual([
      'first',
      'second',
      'third',
    ]);
    expect(listed.map((photo) => photo.position)).toEqual([0, 1, 2]);
    expect(Object.keys(listed[0] ?? {}).sort()).toEqual(
      [
        'altText',
        'blurDataUrl',
        'decorative',
        'experienceId',
        'height',
        'id',
        'position',
        'url',
        'width',
      ].sort(),
    );
  });

  it('lists a guide-only experience', async () => {
    const experience = await insertExperience(undefined, 'guide_only');
    await add(experience.id, 'guide');

    expect(await photoStore.listGuestPhotos(experience.id)).toHaveLength(1);
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'lists nothing for a %s experience',
    async (status) => {
      const experience = await insertExperience();
      await add(experience.id, 'hidden');
      await client.db
        .update(experiences)
        .set({ status })
        .where(eq(experiences.id, experience.id));

      expect(await photoStore.listGuestPhotos(experience.id)).toEqual([]);
    },
  );

  it.each(['not-a-uuid', '', randomUUID()])(
    'lists nothing for the id %j',
    async (id) => {
      expect(await photoStore.listGuestPhotos(id)).toEqual([]);
    },
  );
});

describe('listGuestCoverPhotos', () => {
  async function add(experienceId: string, altText: string) {
    return photoStore.addPhoto(
      ops,
      newPhoto(experienceId, { description: { decorative: false, altText } }),
      validUpload,
      storage,
    );
  }

  it('gives each listed experience its first photo, once, and nothing for one with no photo', async () => {
    const first = await insertExperience();
    const second = await insertExperience();
    const bare = await insertExperience();
    await add(first.id, 'first of first');
    await add(first.id, 'second of first');
    await add(second.id, 'first of second');

    const covers = await photoStore.listGuestCoverPhotos([
      first.id,
      second.id,
      bare.id,
    ]);

    expect(
      covers
        .map((photo) => [photo.experienceId, photo.altText])
        .sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    ).toEqual(
      [
        [first.id, 'first of first'],
        [second.id, 'first of second'],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
  });

  it('takes the lowest position even when the first place is empty', async () => {
    const experience = await insertExperience();
    const gone = await add(experience.id, 'gone');
    await add(experience.id, 'kept one');
    await add(experience.id, 'kept two');
    await client.db.delete(photos).where(eq(photos.id, gone.id));

    const [cover] = await photoStore.listGuestCoverPhotos([experience.id]);

    expect(cover?.altText).toBe('kept one');
    expect(cover?.position).toBe(1);
  });

  it('reads only what a page renders', async () => {
    const experience = await insertExperience();
    await add(experience.id, 'cover');

    const [cover] = await photoStore.listGuestCoverPhotos([experience.id]);

    expect(Object.keys(cover ?? {}).sort()).toEqual(
      [
        'altText',
        'blurDataUrl',
        'decorative',
        'experienceId',
        'height',
        'id',
        'position',
        'url',
        'width',
      ].sort(),
    );
  });

  it('lists a guide-only experience', async () => {
    const experience = await insertExperience(undefined, 'guide_only');
    await add(experience.id, 'guide');

    expect(await photoStore.listGuestCoverPhotos([experience.id])).toHaveLength(
      1,
    );
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'gives nothing for a %s experience',
    async (status) => {
      const experience = await insertExperience();
      await add(experience.id, 'hidden');
      await client.db
        .update(experiences)
        .set({ status })
        .where(eq(experiences.id, experience.id));

      expect(await photoStore.listGuestCoverPhotos([experience.id])).toEqual(
        [],
      );
    },
  );

  it('gives nothing for an experience that is not listed', async () => {
    const listed = await insertExperience();
    const other = await insertExperience();
    await add(other.id, 'other');

    expect(await photoStore.listGuestCoverPhotos([listed.id])).toEqual([]);
  });

  it('reads nothing for no IDs', async () => {
    expect(await photoStore.listGuestCoverPhotos([])).toEqual([]);
  });

  it('refuses a malformed ID and a list past the limit', async () => {
    await expect(
      photoStore.listGuestCoverPhotos(['not-a-uuid']),
    ).rejects.toThrow();
    await expect(
      photoStore.listGuestCoverPhotos(
        Array.from({ length: photoLimits.maxCoverLookups + 1 }, () =>
          randomUUID(),
        ),
      ),
    ).rejects.toThrow();
  });

  it('takes a list at the limit', async () => {
    const ids = Array.from({ length: photoLimits.maxCoverLookups }, () =>
      randomUUID(),
    );
    expect(await photoStore.listGuestCoverPhotos(ids)).toEqual([]);
  });
});
