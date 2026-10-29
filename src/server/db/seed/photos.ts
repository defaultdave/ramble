import 'server-only';
import { eq, inArray } from 'drizzle-orm';
import { requireRole, Role, type Caller } from '@/server/auth/caller';
import { db } from '@/server/db/client';
import { experiences, photos } from '@/server/db/schema';
import { storedPhotoContentType } from '@/lib/photos';
import { curated } from '@/lib/seed/fixtures';
import { experienceId } from '@/lib/seed/rows';
import {
  missingTestPhotos,
  photoCoverageGaps,
  planTestPhotos,
  renderTestPhoto,
} from '@/lib/seed/testPhotos';
import { ingestPhoto } from '@/server/photos/ingest';
import type { StoragePort } from '@/server/ports/storage';
import { encodePng } from './png';

// Gives every curated experience its generated test photos, through the same ingest and storage port
// an upload uses, then writes the `photos` rows. Positions and ids are fixed by the slug, so a rerun
// writes only what is missing and never touches a photo that is already there, whoever put it there.

const readLimit = 5_000;

const targets = curated.experiences.map((fixture) => ({
  slug: fixture.slug,
  id: experienceId(fixture.slug),
  plan: planTestPhotos(fixture),
}));
const targetIds = targets.map((target) => target.id);

export type PhotoSeedReport = { created: number; alreadyThere: number };

export async function seedTestPhotos(
  caller: Caller,
  storage: StoragePort,
): Promise<PhotoSeedReport> {
  requireRole(caller, Role.Ops, {});
  const stored = await db
    .select({ experienceId: photos.experienceId, position: photos.position })
    .from(photos)
    .where(inArray(photos.experienceId, targetIds))
    .limit(readLimit);
  const report: PhotoSeedReport = { created: 0, alreadyThere: 0 };
  for (const target of targets) {
    const existing = stored
      .filter((row) => row.experienceId === target.id)
      .map((row) => row.position);
    const missing = missingTestPhotos(target.plan, existing);
    report.alreadyThere += target.plan.length - missing.length;
    for (const photo of missing) {
      const ingested = await ingestPhoto(
        encodePng(renderTestPhoto(photo), photo.width, photo.height),
      );
      // A stopped run can leave the file without its row; keys are never overwritten, so clear it first.
      await storage.delete({ key: photo.storageKey });
      const put = await storage.put({
        key: photo.storageKey,
        body: ingested.bytes,
        contentType: storedPhotoContentType,
      });
      if (!put.url) {
        throw new Error('A public photo came back without an address');
      }
      await db
        .insert(photos)
        .values({
          id: photo.photoId,
          experienceId: target.id,
          position: photo.position,
          storageKey: photo.storageKey,
          url: put.url,
          width: ingested.width,
          height: ingested.height,
          byteSize: ingested.bytes.byteLength,
          decorative: false,
          altText: photo.altText,
          blurDataUrl: ingested.blurDataUrl,
          rightsBasis: 'ramble_owned',
          rightsHolder: 'Ramble (generated test image)',
        })
        .onConflictDoNothing();
      report.created += 1;
    }
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
    .limit(readLimit);
  return photoCoverageGaps(
    targets.map((target) => target.slug),
    rows,
  );
}
