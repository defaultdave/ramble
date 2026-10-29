import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { experiences, photos } from '@/server/db/schema';
import { photoLimits, storedPhotoContentType } from '@/lib/photos';
import { curated } from '@/lib/seed/fixtures';
import { experienceId } from '@/lib/seed/rows';
import {
  orphanedTestPhotos,
  photoCoverageGaps,
  planTestPhotos,
  reconcileTestPhotos,
  renderTestPhoto,
  tallyTestPhotos,
  type TestPhotoPlan,
} from '@/lib/seed/testPhotos';
import { ingestPhoto, type IngestedPhoto } from '@/server/photos/ingest';
import type { StoragePort } from '@/server/ports/storage';
import { encodePng } from './png';

// Gives every curated experience its generated test photos, through the same ingest and storage port
// an upload uses, then writes the `photos` rows. Positions and ids are fixed by the slug, so a rerun
// writes only what is missing and never touches a photo that is already there, whoever put it there.
// Per experience the files go first and the rows follow in one transaction, so a row never points at
// a file that was not stored.

const targets = curated.experiences.map((fixture) => ({
  slug: fixture.slug,
  experienceId: experienceId(fixture.slug),
  plan: planTestPhotos(fixture),
}));
const targetIds = targets.map((target) => target.experienceId);

/** The most rows the curated set can hold, which bounds every read below. */
const maxPhotoRows = photoLimits.maxPerExperience * targets.length;

export type PhotoSeedReport = { created: number; alreadyThere: number };

export async function seedTestPhotos(
  caller: Caller,
  storage: StoragePort,
): Promise<PhotoSeedReport> {
  requireRole(caller, Role.Ops, {});
  const stored = await db
    .select({
      experienceId: photos.experienceId,
      id: photos.id,
      position: photos.position,
      storageKey: photos.storageKey,
    })
    .from(photos)
    .where(inArray(photos.experienceId, targetIds))
    .limit(maxPhotoRows);
  const report: PhotoSeedReport = { created: 0, alreadyThere: 0 };
  for (const { target, missing } of reconcileTestPhotos(targets, stored)) {
    const ready: {
      photo: TestPhotoPlan;
      ingested: IngestedPhoto;
      url: string;
    }[] = [];
    for (const photo of missing) {
      const ingested = await ingestPhoto(
        encodePng(renderTestPhoto(photo), photo.width, photo.height),
      );
      // No row owns this key (reconcileTestPhotos), so a file here is left by a stopped run. Keys are never overwritten, so clear it first.
      await storage.delete({ key: photo.storageKey });
      const put = await storage.put({
        key: photo.storageKey,
        body: ingested.bytes,
        contentType: storedPhotoContentType,
      });
      if (!put.url) {
        throw new Error('A public photo came back without an address');
      }
      ready.push({ photo, ingested, url: put.url });
    }
    const { insertedIds, ownedIds } =
      ready.length === 0
        ? { insertedIds: [], ownedIds: [] }
        : await db.transaction(async (tx) => {
            const inserted = await tx
              .insert(photos)
              .values(
                ready.map(({ photo, ingested, url }) => ({
                  id: photo.photoId,
                  experienceId: target.experienceId,
                  position: photo.position,
                  storageKey: photo.storageKey,
                  url,
                  width: ingested.width,
                  height: ingested.height,
                  byteSize: ingested.bytes.byteLength,
                  decorative: false,
                  altText: photo.altText,
                  blurDataUrl: ingested.blurDataUrl,
                  rightsBasis: 'ramble_owned' as const,
                  rightsHolder: 'Ramble (generated test image)',
                })),
              )
              .onConflictDoNothing()
              .returning({ id: photos.id });
            const owned = await tx
              .select({ id: photos.id })
              .from(photos)
              .where(
                inArray(
                  photos.id,
                  ready.map(({ photo }) => photo.photoId),
                ),
              )
              .limit(photoLimits.maxPerExperience);
            return {
              insertedIds: inserted.map((row) => row.id),
              ownedIds: owned.map((row) => row.id),
            };
          });
    // A photo that lost a race for its position leaves a file no row points at.
    for (const photo of orphanedTestPhotos(
      ready.map(({ photo }) => photo),
      insertedIds,
      ownedIds,
    )) {
      await storage.delete({ key: photo.storageKey });
    }
    const tally = tallyTestPhotos(target.plan.length, insertedIds.length);
    report.created += tally.created;
    report.alreadyThere += tally.alreadyThere;
  }
  return report;
}

/** The coverage gaps of the curated set, read from what the database holds. */
export async function readPhotoCoverageGaps(caller: Caller): Promise<string[]> {
  requireRole(caller, Role.Ops, {});
  const rows = await db
    .select({
      experienceSlug: experiences.slug,
      position: photos.position,
      decorative: photos.decorative,
      altText: photos.altText,
    })
    .from(photos)
    .innerJoin(experiences, eq(photos.experienceId, experiences.id))
    .where(inArray(photos.experienceId, targetIds))
    .limit(maxPhotoRows);
  return photoCoverageGaps(
    targets.map((target) => target.slug),
    rows,
  );
}
