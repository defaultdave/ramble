import { photoLimits, photoStorageKey } from '@/lib/photos';
import type { StorageProviderName } from '@/lib/storage';
import { seedId } from './ids';
import { experienceId } from './rows';
import { labelColumns } from './testPhotoImage';

// The generated test photos of the curated set: a labelled gradient per experience and position, drawn
// from nothing but arithmetic, so no third-party art is involved and a rerun makes the same pixels.
// Ingest refuses a source under 1,600 px on its long edge (PRD-50), so the smallest source here is
// that floor; the largest is the 2,400 px stored ceiling.

export const testPhotoLongEdges = [
  photoLimits.minLongEdge,
  1920,
  photoLimits.storedEdge,
] as const;

export const minTestPhotos = 3;
const maxPhotos = 5;

export type TestPhotoPlan = {
  position: number;
  width: number;
  height: number;
  /** The id the row keeps on every run, so the stored key and the row never change. */
  photoId: string;
  storageKey: string;
  altText: string;
  hue: number;
  /** The text drawn on the image, one entry per line. */
  label: string[];
};

function numberFrom(namespace: string, key: string): number {
  return parseInt(seedId(namespace, key).slice(0, 8), 16);
}

/** How many test photos an experience gets, from 3 to 5, fixed by its slug. */
export function testPhotoCount(slug: string): number {
  return (
    minTestPhotos +
    (numberFrom('test-photo-count', slug) % (maxPhotos - minTestPhotos + 1))
  );
}

/** The label split into lines of at most `columns` characters, breaking on spaces; the last line is cut with no ellipsis. */
export function wrapLabel(
  text: string,
  columns: number,
  maxLines: number,
): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.toUpperCase().split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (next.length <= columns) {
      current = next;
      continue;
    }
    if (current) lines.push(current);
    current = word.slice(0, columns);
  }
  if (current) lines.push(current);
  return lines.slice(0, maxLines);
}

/**
 * The photos one experience gets. Any three consecutive positions hold all three long edges, so every
 * experience has a small, a medium, and a ceiling-sized source; the fourth and fifth are portrait.
 */
export function planTestPhotos(experience: {
  slug: string;
  name: string;
}): TestPhotoPlan[] {
  const total = testPhotoCount(experience.slug);
  const offset =
    numberFrom('test-photo-size', experience.slug) % testPhotoLongEdges.length;
  const baseHue = numberFrom('test-photo-hue', experience.slug) % 360;
  const id = experienceId(experience.slug);
  return Array.from({ length: total }, (_, position) => {
    const long =
      testPhotoLongEdges[(position + offset) % testPhotoLongEdges.length] ??
      photoLimits.minLongEdge;
    const short = Math.round((long * 2) / 3);
    const portrait = position >= minTestPhotos;
    const photoId = seedId('photo', `${experience.slug}/${String(position)}`);
    return {
      position,
      width: portrait ? short : long,
      height: portrait ? long : short,
      photoId,
      storageKey: photoStorageKey(id, photoId),
      altText:
        `Generated test image ${String(position + 1)} of ${String(total)} for ${experience.name}: a colour gradient labelled with the experience name.`.slice(
          0,
          photoLimits.maxAltLength,
        ),
      hue: (baseHue + position * 37) % 360,
      label: [
        ...wrapLabel(experience.name, labelColumns, 3),
        `PHOTO ${String(position + 1)}/${String(total)} ${String(long)}PX`,
      ],
    };
  });
}

export type TestPhotoTarget = {
  slug: string;
  experienceId: string;
  plan: readonly TestPhotoPlan[];
};

export type StoredPhotoRef = {
  experienceId: string;
  id: string;
  position: number;
  storageKey: string;
};

export type TestPhotoWork = {
  target: TestPhotoTarget;
  /** The planned photos with no row at their position and none owning their id or key. */
  missing: TestPhotoPlan[];
};

/**
 * What each experience still needs, from the rows already stored. A photo is left alone when a row
 * holds its position (whoever wrote it) or owns its id or storage key, so a rerun writes only what is
 * missing and never clears a file that a row points at.
 */
export function reconcileTestPhotos(
  targets: readonly TestPhotoTarget[],
  stored: readonly StoredPhotoRef[],
): TestPhotoWork[] {
  return targets.map((target) => {
    const own = stored.filter(
      (row) => row.experienceId === target.experienceId,
    );
    const positions = new Set(own.map((row) => row.position));
    const ids = new Set(own.map((row) => row.id));
    const keys = new Set(own.map((row) => row.storageKey));
    return {
      target,
      missing: target.plan.filter(
        (photo) =>
          !positions.has(photo.position) &&
          !ids.has(photo.photoId) &&
          !keys.has(photo.storageKey),
      ),
    };
  });
}

/** What one experience's run counts: only rows the database took are written; every other planned photo was already there. */
export function tallyTestPhotos(planned: number, inserted: number) {
  return { created: inserted, alreadyThere: planned - inserted };
}

/** The files stored for photos whose row was not written and that no row owns, so nothing points at them. */
export function orphanedTestPhotos<T extends { photoId: string }>(
  attempted: readonly T[],
  insertedIds: readonly string[],
  ownedIds: readonly string[],
): T[] {
  const kept = new Set([...insertedIds, ...ownedIds]);
  return attempted.filter((photo) => !kept.has(photo.photoId));
}

type StepVerdict = { run: true } | { run: false; line: string };

/**
 * Whether the photo step runs. The fake provider keeps objects in memory behind an address that
 * `next/image` refuses outside production and test, so a row written for it breaks every page that
 * draws the photo in `next dev`. Only a real store takes the step. Production is already refused by
 * the target check unless the demo opt-in is set.
 */
export function photoStepFor(provider: StorageProviderName): StepVerdict {
  if (provider === 'fake') {
    return {
      run: false,
      line: 'Photos skipped: STORAGE_PROVIDER=fake has no address next/image can show. Set STORAGE_PROVIDER=vercel-blob to seed photos (docs/runbooks/seed.md).',
    };
  }
  return { run: true };
}

export type PhotoCoverageRow = {
  experienceSlug: string;
  position: number;
  decorative: boolean;
  altText: string | null;
};

/** One line per experience that lacks a cover, has fewer than three photos, or has a photo without alt text. */
export function photoCoverageGaps(
  expectedSlugs: readonly string[],
  rows: readonly PhotoCoverageRow[],
): string[] {
  const bySlug = new Map<string, PhotoCoverageRow[]>();
  for (const row of rows) {
    bySlug.set(row.experienceSlug, [
      ...(bySlug.get(row.experienceSlug) ?? []),
      row,
    ]);
  }
  const gaps: string[] = [];
  for (const slug of expectedSlugs) {
    const own = bySlug.get(slug) ?? [];
    if (!own.some((row) => row.position === 0))
      gaps.push(`${slug} has no cover`);
    if (own.length < minTestPhotos) {
      gaps.push(
        `${slug} has ${String(own.length)} photos, needs ${String(minTestPhotos)}`,
      );
    }
    if (own.some((row) => !row.decorative && !row.altText?.trim())) {
      gaps.push(`${slug} has a photo without alt text`);
    }
  }
  return gaps;
}
