import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray } from 'drizzle-orm';
import { EntityIdSchema, guestVisibleStatuses } from '@/lib/catalog';
import {
  GuestPhotoSchema,
  NewPhotoSchema,
  nextPhotoPosition,
  photoAccessFor,
  photoActorFor,
  photoLimits,
  photoStorageKey,
  storedPhotoContentType,
  type GuestPhoto,
} from '@/lib/photos';
import {
  ForbiddenError,
  Role,
  requireRole,
  type Caller,
} from '@/server/auth/caller';
import { logger } from '@/server/monitoring/logger';
import { ingestPhoto } from '@/server/photos/ingest';
import type { StoragePort } from '@/server/ports/storage';
import { db, dbRead } from './client';
import { experiences, photos } from './schema';

// TODO(U-074b): first caller
export class ExperienceNotFoundError extends Error {
  constructor() {
    super('No experience with that ID');
    this.name = 'ExperienceNotFoundError';
  }
}

// TODO(U-074b): first caller
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

/** What was left behind when a photo's file could not be removed; it carries the kind of the failure, never its message. */
class PhotoCleanupError extends Error {
  readonly photoId: string;
  readonly errorKind: string;

  constructor(photoId: string, cause: unknown) {
    super(`Photo file left in storage for ${photoId}`);
    this.name = 'PhotoCleanupError';
    this.photoId = photoId;
    this.errorKind = cause instanceof Error ? cause.name : 'unknown';
  }
}

/** Hands the cleanup failure to whoever reports the primary error, without replacing it. */
function attachSuppressed(primary: unknown, suppressed: PhotoCleanupError) {
  if (typeof primary !== 'object' || primary === null) return;
  const existing: unknown = Reflect.get(primary, 'suppressed');
  Reflect.defineProperty(primary, 'suppressed', {
    value: Array.isArray(existing)
      ? [...(existing as unknown[]), suppressed]
      : [suppressed],
    configurable: true,
    writable: true,
  });
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
  // A caller with neither a staff role nor a host role is refused before any lookup, and a host
  // owner is refused the same way for a missing experience as for another host's (`photoAccessFor`).
  const actor = photoActorFor(caller.roles);
  if (!actor) throw new ForbiddenError(Role.HostOwner);
  const [experience] = await db
    .select({ id: experiences.id, hostId: experiences.hostId })
    .from(experiences)
    .where(eq(experiences.id, photo.experienceId));
  const access = photoAccessFor(actor, experience?.hostId ?? null);
  switch (access.outcome) {
    case 'experience_missing':
      throw new ExperienceNotFoundError();
    case 'refused':
      throw new ForbiddenError(Role.HostOwner);
    case 'staff':
      requireRole(caller, access.role, {});
      break;
    case 'host_owner':
      requireRole(caller, Role.HostOwner, { hostId: access.hostId });
      break;
  }

  // A full gallery is refused before any pixel is decoded; the transaction below decides for certain.
  if (nextPhotoPosition(await takenPositions(photo.experienceId)) === null) {
    throw new PhotoLimitError();
  }

  const ingested = await ingestPhoto(upload);
  const id = randomUUID();
  const storageKey = photoStorageKey(photo.experienceId, id);
  const stored = await storage.put({
    key: storageKey,
    body: ingested.bytes,
    contentType: storedPhotoContentType,
  });
  if (!stored.url)
    throw new Error('A public photo came back without an address');
  const url = stored.url;

  let row;
  try {
    row = await db.transaction(async (tx) => {
      await tx
        .select({ id: experiences.id })
        .from(experiences)
        .where(eq(experiences.id, photo.experienceId))
        .for('update');
      const taken = await tx
        .select({ position: photos.position })
        .from(photos)
        .where(eq(photos.experienceId, photo.experienceId));
      const position = nextPhotoPosition(taken.map((row) => row.position));
      if (position === null) throw new PhotoLimitError();
      const [inserted] = await tx
        .insert(photos)
        .values({
          id,
          experienceId: photo.experienceId,
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
  } catch (error) {
    try {
      await removeOrphan(storage, storageKey, id);
    } catch (cleanupError) {
      const failure = new PhotoCleanupError(id, cleanupError);
      logger.error('Photo file left in storage after its row failed', {
        photoId: id,
        errorKind: failure.errorKind,
      });
      attachSuppressed(error, failure);
    }
    throw error;
  }
  // Outside the try: the row is stored by now, so a failure here must not delete the file it points at.
  return GuestPhotoSchema.parse(row);
}

async function takenPositions(experienceId: string): Promise<number[]> {
  const rows = await db
    .select({ position: photos.position })
    .from(photos)
    .where(eq(photos.experienceId, experienceId));
  return rows.map((row) => row.position);
}

/**
 * Removes the file of a photo whose row could not be written. A failed transaction call can still
 * have gone through (the connection drops after the commit), and a row pointing at a deleted file is
 * worse than a stray file, so the file goes only once the row is known to be absent. A failure here
 * propagates to `addPhoto`, which attaches it to the error it is already rethrowing.
 */
async function removeOrphan(
  storage: StoragePort,
  storageKey: string,
  photoId: string,
): Promise<void> {
  const [stored] = await db
    .select({ id: photos.id })
    .from(photos)
    .where(eq(photos.id, photoId));
  if (stored) return;
  await storage.delete({ key: storageKey });
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
