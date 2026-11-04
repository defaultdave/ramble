import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import sharp from 'sharp';
import { describe, expect, it, vi } from 'vitest';
import { anonymousCaller, ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { photos } from '@/server/db/schema';
import {
  alt,
  client,
  insertExperience,
  newPhoto,
  ops,
  photoRows,
  photoStore,
  setupPhotosDatabase,
  storage,
  validUpload,
} from './photosFixtures';

// Behaviours under test:
// - an added photo is stored, re-encoded, under a key made of its ids, and recorded with its size, blur placeholder, alt text, and rights, at the next free position
// - a decorative photo is recorded with no alt text
// - ops adds to any experience, the host owner to their own host's, and nobody else to anyone's; a refused caller stores nothing
// - bad input (blank alt text, no rights, a malformed experience id), a file that is not a photo, and a missing experience each store nothing and write no row

setupPhotosDatabase();

describe('addPhoto', () => {
  it('stores a re-encoded copy under a key made of its ids and records the row', async () => {
    const experience = await insertExperience();

    const added = await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, {
        rights: {
          basis: 'licensed',
          holder: 'Ana Photographer',
          license: 'Unsplash License',
          sourceUrl: 'https://unsplash.com/photos/abc',
        },
      }),
      validUpload,
      storage,
    );

    const [row] = await photoRows(experience.id);
    expect(row).toMatchObject({
      id: added.id,
      position: 0,
      storageKey: `public/photos/${experience.id}/${added.id}.jpg`,
      width: 1600,
      height: 1000,
      decorative: false,
      altText: alt.altText,
      rightsBasis: 'licensed',
      rightsHolder: 'Ana Photographer',
      rightsLicense: 'Unsplash License',
      rightsSourceUrl: 'https://unsplash.com/photos/abc',
    });
    expect(row?.blurDataUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(row?.url).toContain(row?.storageKey);
    const stored = storage.read(row?.storageKey ?? '');
    expect(stored).not.toBeNull();
    expect(row?.byteSize).toBe(stored?.byteLength);
    expect((await sharp(stored ?? Buffer.alloc(0)).metadata()).format).toBe(
      'jpeg',
    );
    expect(added).toMatchObject({ id: row?.id, position: 0, url: row?.url });
    expect(added).not.toHaveProperty('storageKey');
    expect(added).not.toHaveProperty('rightsBasis');
  });

  it('takes the next position each time, and a freed one first', async () => {
    const experience = await insertExperience();
    const add = () =>
      photoStore.addPhoto(ops, newPhoto(experience.id), validUpload, storage);
    const first = await add();
    const second = await add();
    await add();

    await client.db.delete(photos).where(eq(photos.id, second.id));
    const refilled = await add();

    expect(first.position).toBe(0);
    expect(second.position).toBe(1);
    expect(refilled.position).toBe(1);
  });

  it('records a decorative photo with no alt text', async () => {
    const experience = await insertExperience();

    await photoStore.addPhoto(
      ops,
      newPhoto(experience.id, { description: { decorative: true } }),
      validUpload,
      storage,
    );

    expect(await photoRows(experience.id)).toMatchObject([
      { decorative: true, altText: null },
    ]);
  });

  describe('who may add', () => {
    it('lets ops and admin add to any experience', async () => {
      const experience = await insertExperience();

      await photoStore.addPhoto(
        testCaller({ roles: [Role.Admin] }),
        newPhoto(experience.id),
        validUpload,
        storage,
      );

      expect(await photoRows(experience.id)).toHaveLength(1);
    });

    it("lets the owner of the experience's host add", async () => {
      const experience = await insertExperience();

      await photoStore.addPhoto(
        testCaller({
          roles: [Role.HostOwner],
          hostIds: [experience.hostId],
        }),
        newPhoto(experience.id),
        validUpload,
        storage,
      );

      expect(await photoRows(experience.id)).toHaveLength(1);
    });

    it.each([
      [
        'the owner of another host',
        () => testCaller({ roles: [Role.HostOwner], hostIds: [randomUUID()] }),
      ],
      ['a signed-out visitor', () => anonymousCaller],
      ['a guest', () => testCaller()],
      ['host staff', () => testCaller({ roles: [Role.HostStaff] })],
    ])('refuses %s and stores nothing', async (_name, makeCaller) => {
      const experience = await insertExperience();
      const spy = vi.spyOn(storage, 'put');

      await expect(
        photoStore.addPhoto(
          makeCaller(),
          newPhoto(experience.id),
          validUpload,
          storage,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);

      expect(spy).not.toHaveBeenCalled();
      expect(await photoRows(experience.id)).toEqual([]);
      spy.mockRestore();
    });
  });

  describe('refusals store nothing', () => {
    async function expectNothingStored(
      experienceId: string,
      attempt: Promise<unknown>,
      error: new (...args: never[]) => Error | typeof Error,
    ) {
      const spy = vi.spyOn(storage, 'put');
      await expect(attempt).rejects.toBeInstanceOf(error);
      expect(spy).not.toHaveBeenCalled();
      expect(await photoRows(experienceId)).toEqual([]);
      spy.mockRestore();
    }

    it.each([
      ['blank alt text', { description: { decorative: false, altText: '  ' } }],
      ['no description', { description: undefined }],
      ['no rights record', { rights: undefined }],
      ['a malformed experience id', { experienceId: 'nope' }],
    ])('input with %s', async (_name, override) => {
      const experience = await insertExperience();

      await expectNothingStored(
        experience.id,
        photoStore.addPhoto(
          ops,
          { ...newPhoto(experience.id), ...override },
          validUpload,
          storage,
        ),
        Error,
      );
    });

    it('a file that is not a photo', async () => {
      const experience = await insertExperience();
      const { PhotoRefusedError } = await import('@/server/photos/ingest');

      await expectNothingStored(
        experience.id,
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          Buffer.from('not an image'),
          storage,
        ),
        PhotoRefusedError,
      );
    });

    it('an experience that does not exist, for ops', async () => {
      await expect(
        photoStore.addPhoto(ops, newPhoto(randomUUID()), validUpload, storage),
      ).rejects.toBeInstanceOf(photoStore.ExperienceNotFoundError);
    });

    it.each([
      ['a signed-out visitor', () => anonymousCaller],
      ['a guest', () => testCaller()],
      [
        'a host owner',
        () => testCaller({ roles: [Role.HostOwner], hostIds: [randomUUID()] }),
      ],
    ])(
      'gives %s the same refusal for a missing experience as for an existing one, so IDs cannot be probed',
      async (_name, makeCaller) => {
        const existing = await insertExperience();
        const attempt = (experienceId: string) =>
          photoStore
            .addPhoto(
              makeCaller(),
              newPhoto(experienceId),
              validUpload,
              storage,
            )
            .catch((error: unknown) => error);

        const forExisting = await attempt(existing.id);
        const forMissing = await attempt(randomUUID());

        expect(forExisting).toBeInstanceOf(ForbiddenError);
        expect(forMissing).toBeInstanceOf(ForbiddenError);
        expect((forMissing as Error).message).toBe(
          (forExisting as Error).message,
        );
      },
    );
  });
});
