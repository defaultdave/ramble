import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { beforeEach, describe, expect, it } from 'vitest';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog } from '@/server/db/schema';
import { PhotoRefusedError } from '@/server/photos/ingest';
import {
  alt,
  client,
  insertExperience,
  newPhoto,
  ops,
  opsUserId,
  photoRows,
  photoStore,
  setupPhotosDatabase,
  storage,
  updateTag,
  validUpload,
} from './photosFixtures';

// Behaviours under test, against the real database, one per decision, branch or risk:
// - an added photo writes one audit row in the same transaction, naming the user, the experience and the photo by id and flags, with no alt text
// - a refused photo (a file that is not a photo, a missing experience, a caller with no user) writes no audit row and publishes nothing
// - a photo added to an experience guests can see publishes that experience's tag once, after the commit
// - a photo added to a draft publishes no tag, since no guest page shows it
// - the ops edit view carries the gallery in order, whatever the status, with no storage key or rights record

setupPhotosDatabase();

async function auditRowsOf(experienceId: string) {
  return client.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.subjectId, experienceId));
}

async function editorStore() {
  return import('@/server/db/experienceEditor');
}

beforeEach(() => {
  updateTag.mockClear();
});

describe('addPhoto audit', () => {
  it('writes one audit row for the user, the experience and the photo', async () => {
    const experience = await insertExperience();

    const added = await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, {
        description: { decorative: true },
        rights: { basis: 'host_agreement', holder: 'Clay Corner' },
      }),
      validUpload,
      storage,
    );

    const rows = await auditRowsOf(experience.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      actorKind: 'user',
      actorId: opsUserId,
      action: 'experience.photo_added',
      subjectKind: 'experience',
      details: {
        photo_id: added.id,
        position: 0,
        decorative: true,
        rights_basis: 'host_agreement',
      },
    });
    expect(JSON.stringify(rows[0]?.details)).not.toContain('Clay Corner');
  });

  it('writes a row for each photo, at its own position', async () => {
    const experience = await insertExperience();

    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id),
      validUpload,
      storage,
    );
    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id),
      validUpload,
      storage,
    );

    const rows = await auditRowsOf(experience.id);
    expect(rows.map((row) => row.details)).toMatchObject([
      { position: 0 },
      { position: 1 },
    ]);
  });

  it('writes no row, stores no file and publishes nothing when the file is not a photo', async () => {
    const experience = await insertExperience();

    await expect(
      photoStore.addPhoto(
        ops,
        newPhoto(experience.id),
        Buffer.from('not a photo'),
        storage,
      ),
    ).rejects.toBeInstanceOf(PhotoRefusedError);

    expect(await auditRowsOf(experience.id)).toEqual([]);
    expect(await photoRows(experience.id)).toEqual([]);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('refuses a caller with no user before anything is written', async () => {
    const experience = await insertExperience();

    await expect(
      photoStore.addPhoto(
        testCaller({ userId: null, roles: [Role.Ops] }),
        newPhoto(experience.id),
        validUpload,
        storage,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await auditRowsOf(experience.id)).toEqual([]);
    expect(await photoRows(experience.id)).toEqual([]);
  });
});

describe('addPhoto cache tag', () => {
  it.each(['live', 'guide_only'] as const)(
    'publishes the experience tag once for a %s experience',
    async (status) => {
      const experience = await insertExperience(undefined, status);

      await photoStore.addPhoto(
        ops,
        newPhoto(experience.id),
        validUpload,
        storage,
      );

      expect(updateTag).toHaveBeenCalledTimes(1);
      expect(updateTag).toHaveBeenCalledWith(`experience:${experience.id}`);
    },
  );

  it('publishes nothing for a draft, which no guest page shows', async () => {
    const experience = await insertExperience(undefined, 'draft');

    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id),
      validUpload,
      storage,
    );

    expect(await photoRows(experience.id)).toHaveLength(1);
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('publishes nothing when the experience does not exist', async () => {
    await expect(
      photoStore.addPhoto(ops, newPhoto(randomUUID()), validUpload, storage),
    ).rejects.toThrow();

    expect(updateTag).not.toHaveBeenCalled();
  });
});

describe('readExperienceForOps gallery', () => {
  it('carries the photos of a draft in order, without the storage key or the rights', async () => {
    const experience = await insertExperience(undefined, 'draft');
    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id),
      validUpload,
      storage,
    );
    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, { description: { decorative: true } }),
      validUpload,
      storage,
    );

    const view = await (
      await editorStore()
    ).readExperienceForOps(ops, experience.id);

    expect(view?.photos.map((photo) => photo.position)).toEqual([0, 1]);
    expect(view?.photos[0]).toMatchObject({
      decorative: false,
      altText: alt.altText,
    });
    expect(view?.photos[1]).toMatchObject({ decorative: true, altText: null });
    expect(view?.photos[0]).not.toHaveProperty('storageKey');
    expect(view?.photos[0]).not.toHaveProperty('rightsBasis');
  });

  it('carries an empty gallery for an experience with no photo', async () => {
    const experience = await insertExperience();

    const view = await (
      await editorStore()
    ).readExperienceForOps(ops, experience.id);

    expect(view?.photos).toEqual([]);
  });
});
