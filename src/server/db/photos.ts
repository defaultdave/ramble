import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { EntityIdSchema, guestVisibleStatuses } from '@/lib/catalog';
import {
  GuestPhotoSchema,
  NewPhotoSchema,
  nextPhotoPosition,
  photoLimits,
  photoStorageKey,
  storedPhotoContentType,
  type GuestPhoto,
} from '@/lib/photos';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { logger } from '@/server/monitoring/logger';
import { ingestPhoto } from '@/server/photos/ingest';
import type { StoragePort } from '@/server/ports/storage';
import { db, dbRead } from './client';
import { experiences, photos } from './schema';

export class ExperienceNotFoundError extends Error {
  constructor() {
    super('No experience with that ID');
    this.name = 'ExperienceNotFoundError';
  }
}

export class PhotoLimitError extends Error {
  constructor() {
    super('The experience already holds the most photos it can');
    this.name = 'PhotoLimitError';
  }
}

const photoColumns = {
  id: photos.id,
  experienceId: photos.experienceId,
  position: photos.position,
  url: photos.url,
  width: photos.width,
  height: photos.height,
  decorative: photos.decorative,
  altText: photos.altText,
  blurDataUrl: photos.blurDataUrl,
};

/** Ops and admin add photos to any experience; a host owner only to their own host's. */
function requireCanEditPhotos(caller: Caller, hostId: string) {
  const staffRole = [Role.Ops, Role.Admin].find((role) =>
    caller.roles.includes(role),
  );
  if (staffRole) requireRole(caller, staffRole, {});
  else requireRole(caller, Role.HostOwner, { hostId });
}

// TODO(U-074b): first caller
/**
 * Checks, re-encodes, stores, and records one photo, as the last in the experience's gallery. The
 * upload is bounded before it is decoded (`ingestPhoto`), the stored copy carries no location data,
 * and alt text or the decorative flag plus the rights record are required. The file is stored first and the
 * row second, in a transaction that holds the experience row so two uploads cannot take one position;
 * if the row cannot be written the file is removed again.
 */
export async function addPhoto(
  caller: Caller,
  input: unknown,
  upload: Uint8Array,
  storage: StoragePort,
): Promise<GuestPhoto> {
  const photo = NewPhotoSchema.parse(input);
  const [experience] = await db
    .select({ id: experiences.id, hostId: experiences.hostId })
    .from(experiences)
    .where(eq(experiences.id, photo.experienceId));
  if (!experience) throw new ExperienceNotFoundError();
  requireCanEditPhotos(caller, experience.hostId);

  // A full gallery is refused before any pixel is decoded; the transaction below decides for certain.
  if (nextPhotoPosition(await takenPositions(experience.id)) === null) {
    throw new PhotoLimitError();
  }

  const ingested = await ingestPhoto(upload);
  const id = randomUUID();
  const storageKey = photoStorageKey(experience.id, id);
  const stored = await storage.put({
    key: storageKey,
    body: ingested.bytes,
    contentType: storedPhotoContentType,
  });
  if (!stored.url)
    throw new Error('A public photo came back without an address');
  const url = stored.url;

  try {
    const row = await db.transaction(async (tx) => {
      await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.id, experience.id))
        .for('update');
      const taken = await tx
        .select({ position: photos.position })
        .from(photos)
        .where(eq(photos.experienceId, experience.id));
      const position = nextPhotoPosition(taken.map((row) => row.position));
      if (position === null) throw new PhotoLimitError();
      const [inserted] = await tx
        .insert(photos)
        .values({
          id,
          experienceId: experience.id,
          position,
          storageKey,
          url,
          width: ingested.width,
          height: ingested.height,
          byteSize: ingested.bytes.byteLength,
          decorative: photo.description.decorative,
          altText: photo.description.altText,
          blurDataUrl: ingested.blurDataUrl,
          rightsBasis: photo.rights.basis,
          rightsHolder: photo.rights.holder,
          rightsLicense: photo.rights.license,
          rightsSourceUrl: photo.rights.sourceUrl,
        })
        .returning(photoColumns);
      if (!inserted) throw new Error('The photo row was not returned');
      return inserted;
    });
    return GuestPhotoSchema.parse(row);
  } catch (error) {
    await removeOrphan(storage, storageKey, id);
    throw error;
  }
}

async function takenPositions(experienceId: string): Promise<number[]> {
  const rows = await db
    .select({ position: photos.position })
    .from(photos)
    .where(eq(photos.experienceId, experienceId));
  return rows.map((row) => row.position);
}

/** Best effort: a failure is logged by kind and photo id, and the original error still reaches the caller. */
async function removeOrphan(
  storage: StoragePort,
  storageKey: string,
  photoId: string,
) {
  try {
    await storage.delete({ key: storageKey });
  } catch (error) {
    logger.error('Photo file left in storage after its row failed', {
      photoId,
      errorKind: error instanceof Error ? error.name : 'unknown',
    });
  }
}

// TODO(U-039): first caller
/**
 * The photos of one experience in gallery order, only while the experience is visible to guests.
 * A malformed ID, a missing experience, and a hidden one each return an empty list.
 */
export async function listGuestPhotos(
  experienceId: string,
): Promise<GuestPhoto[]> {
  const parsedId = EntityIdSchema.safeParse(experienceId);
  if (!parsedId.success) return [];
  const rows = await dbRead
    .select(photoColumns)
    .from(photos)
    .innerJoin(experiences, eq(experiences.id, photos.experienceId))
    .where(
      and(
        eq(photos.experienceId, parsedId.data),
        inArray(experiences.status, [...guestVisibleStatuses]),
      ),
    )
    .orderBy(asc(photos.position))
    .limit(photoLimits.maxPerExperience);
  return GuestPhotoSchema.array().parse(rows);
}
