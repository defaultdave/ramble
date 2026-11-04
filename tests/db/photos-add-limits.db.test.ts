import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { GuestPhotoSchema, photoLimits } from '@/lib/photos';
import { experiences, photos } from '@/server/db/schema';
import { StorageError, type StoragePort } from '@/server/ports/storage';
import {
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
// - a full gallery is refused before decoding, and two uploads racing for the last place give one photo and one refusal, with the loser's file removed
// - a row that cannot be written removes its file again
// - when that removal also fails, the failure rides on the original error (never swallowed) as its kind and photo id only
// - a row stored although the transaction call failed, or not readable back, keeps its file

setupPhotosDatabase();

describe('addPhoto', () => {
  describe('the gallery limit', () => {
    async function fillGallery(experienceId: string, count: number) {
      for (let position = 0; position < count; position++) {
        const id = randomUUID();
        await client.db.insert(photos).values({
          id,
          experienceId,
          position,
          storageKey: `public/photos/${experienceId}/${id}.jpg`,
          url: `https://abc123.public.blob.vercel-storage.com/public/photos/${experienceId}/${id}.jpg`,
          width: 1600,
          height: 1000,
          byteSize: 1000,
          decorative: true,
          blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
          rightsBasis: 'ramble_owned',
        });
      }
    }

    it('is refused before the upload is decoded or stored', async () => {
      const experience = await insertExperience();
      await fillGallery(experience.id, photoLimits.maxPerExperience);
      const spy = vi.spyOn(storage, 'put');

      await expect(
        // Not an image: reaching the decoder would give a different error.
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          Buffer.from('x'),
          storage,
        ),
      ).rejects.toBeInstanceOf(photoStore.PhotoLimitError);

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('lets two uploads race for the last place: one wins, one is refused and its file is removed', async () => {
      const experience = await insertExperience();
      await fillGallery(experience.id, photoLimits.maxPerExperience - 1);
      const stored: string[] = [];
      // Both uploads wait here until both have stored their file, so both reach the transaction together.
      let arrived = 0;
      let release: () => void = () => undefined;
      const bothArrived = new Promise<void>((resolve) => {
        release = resolve;
      });
      const recording: StoragePort = {
        ...storage,
        put: async (input) => {
          stored.push(input.key);
          const result = await storage.put(input);
          arrived += 1;
          if (arrived === 2) release();
          await bothArrived;
          return result;
        },
      };

      const results = await Promise.allSettled([
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          validUpload,
          recording,
        ),
        photoStore.addPhoto(
          ops,
          newPhoto(experience.id),
          validUpload,
          recording,
        ),
      ]);

      expect(results.map((r) => r.status).sort()).toEqual([
        'fulfilled',
        'rejected',
      ]);
      const rejected = results.find((r) => r.status === 'rejected');
      expect(rejected?.status === 'rejected' && rejected.reason).toBeInstanceOf(
        photoStore.PhotoLimitError,
      );
      expect(await photoRows(experience.id)).toHaveLength(
        photoLimits.maxPerExperience,
      );
      const kept = (await photoRows(experience.id)).map(
        (row) => row.storageKey,
      );
      const leftover = stored.filter((key) => storage.read(key) !== null);
      expect(leftover).toHaveLength(1);
      expect(kept).toContain(leftover[0]);
    });
  });

  it('removes the stored file when the row cannot be written', async () => {
    const experience = await insertExperience();
    const stored: string[] = [];
    const deletesExperience: StoragePort = {
      ...storage,
      put: async (input) => {
        const result = await storage.put(input);
        stored.push(input.key);
        await client.db
          .delete(experiences)
          .where(eq(experiences.id, experience.id));
        return result;
      },
    };

    await expect(
      photoStore.addPhoto(
        ops,
        newPhoto(experience.id),
        validUpload,
        deletesExperience,
      ),
    ).rejects.toThrow();

    expect(stored).toHaveLength(1);
    expect(storage.read(stored[0] ?? '')).toBeNull();
  });

  it('hands a failed cleanup to the caller on the original error, naming only the error kind and photo id', async () => {
    const { logger } = await import('@/server/monitoring/logger');
    const logged = vi
      .spyOn(logger, 'error')
      .mockImplementation(() => undefined);
    const experience = await insertExperience();
    const keys: string[] = [];
    const failingCleanup: StoragePort = {
      ...storage,
      put: async (input) => {
        keys.push(input.key);
        const result = await storage.put(input);
        await client.db
          .delete(experiences)
          .where(eq(experiences.id, experience.id));
        return result;
      },
      delete: () =>
        Promise.reject(
          new StorageError(
            'provider_unavailable',
            'token abc-secret rejected for public/photos/x.jpg',
          ),
        ),
    };

    const thrown: unknown = await photoStore
      .addPhoto(ops, newPhoto(experience.id), validUpload, failingCleanup)
      .catch((error: unknown) => error);

    // The original error reaches the caller unchanged in kind.
    expect(thrown).not.toMatchObject({ name: 'PhotoCleanupError' });
    expect(thrown).toMatchObject({
      cause: { constraint: 'photos_experience_id_experiences_id_fk' },
    });
    // The cleanup failure is not swallowed: it travels with that error, for whoever reports it.
    const photoId = /\/([0-9a-f-]{36})\.jpg$/.exec(keys[0] ?? '')?.[1];
    expect(photoId).toBeDefined();
    const suppressed = (thrown as { suppressed?: unknown[] }).suppressed;
    expect(suppressed).toHaveLength(1);
    expect(suppressed?.[0]).toMatchObject({
      name: 'PhotoCleanupError',
      photoId,
      errorKind: 'StorageError',
    });
    // The stray file is still there, and nothing raw from the provider is on the failure or in a log.
    expect(storage.read(keys[0] ?? '')).not.toBeNull();
    const everything = JSON.stringify([
      (suppressed?.[0] as Error).message,
      suppressed?.[0],
      logged.mock.calls,
    ]);
    expect(everything).not.toContain('abc-secret');
    expect(logged).toHaveBeenCalledTimes(1);
    expect(logged).toHaveBeenCalledWith(expect.any(String), {
      photoId,
      errorKind: 'StorageError',
    });
    logged.mockRestore();
  });

  it('keeps the file when the row turns out to be stored although the transaction call failed', async () => {
    // A connection that drops after the commit reports a failure for work that happened.
    const experience = await insertExperience();
    const keys: string[] = [];
    const real = storage;
    const spyDelete = vi.spyOn(real, 'delete');
    const recording: StoragePort = {
      ...real,
      put: async (input) => {
        keys.push(input.key);
        const result = await real.put(input);
        const id = /\/([0-9a-f-]{36})\.jpg$/.exec(input.key)?.[1] ?? '';
        await client.db.insert(photos).values({
          id,
          experienceId: experience.id,
          position: 0,
          storageKey: input.key,
          url: result.url ?? '',
          width: 1600,
          height: 1000,
          byteSize: 10,
          decorative: true,
          blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
          rightsBasis: 'ramble_owned',
        });
        return result;
      },
    };

    // The row already exists at the photo's position, so the transaction's own insert fails.
    await expect(
      photoStore.addPhoto(ops, newPhoto(experience.id), validUpload, recording),
    ).rejects.toBeDefined();

    expect(spyDelete).not.toHaveBeenCalled();
    expect(real.read(keys[0] ?? '')).not.toBeNull();
    spyDelete.mockRestore();
  });

  it('does not delete the file when the row is stored but the result cannot be read back', async () => {
    const experience = await insertExperience();
    const readFails = new Error('result did not match its schema');
    const parse = vi
      .spyOn(GuestPhotoSchema, 'parse')
      .mockImplementationOnce(() => {
        throw readFails;
      });
    const spyDelete = vi.spyOn(storage, 'delete');

    await expect(
      photoStore.addPhoto(ops, newPhoto(experience.id), validUpload, storage),
    ).rejects.toBe(readFails);

    const [row] = await photoRows(experience.id);
    expect(row).toBeDefined();
    expect(spyDelete).not.toHaveBeenCalled();
    expect(storage.read(row?.storageKey ?? '')).not.toBeNull();
    parse.mockRestore();
    spyDelete.mockRestore();
  });
});
