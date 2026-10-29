import { photoLimits, photoStorageKey } from '@/lib/photos';
import type { StorageProviderName } from '@/lib/storage';
import { seedId } from './ids';
import { experienceId } from './rows';

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
const minPhotos = minTestPhotos;
const maxPhotos = 5;
const labelColumns = 18;

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
    minPhotos +
    (numberFrom('test-photo-count', slug) % (maxPhotos - minPhotos + 1))
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
    const portrait = position >= minPhotos;
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
    if (own.length < minPhotos) {
      gaps.push(
        `${slug} has ${String(own.length)} photos, needs ${String(minPhotos)}`,
      );
    }
    if (own.some((row) => !row.decorative && !row.altText?.trim())) {
      gaps.push(`${slug} has a photo without alt text`);
    }
  }
  return gaps;
}

// A 5 by 7 bitmap font for the labels, one 5-bit row per line. Anything not listed draws as blank.
const glyphs: Record<string, readonly number[]> = {
  A: [14, 17, 17, 31, 17, 17, 17],
  B: [30, 17, 17, 30, 17, 17, 30],
  C: [14, 17, 16, 16, 16, 17, 14],
  D: [30, 17, 17, 17, 17, 17, 30],
  E: [31, 16, 16, 30, 16, 16, 31],
  F: [31, 16, 16, 30, 16, 16, 16],
  G: [14, 17, 16, 23, 17, 17, 15],
  H: [17, 17, 17, 31, 17, 17, 17],
  I: [14, 4, 4, 4, 4, 4, 14],
  J: [7, 2, 2, 2, 2, 18, 12],
  K: [17, 18, 20, 24, 20, 18, 17],
  L: [16, 16, 16, 16, 16, 16, 31],
  M: [17, 27, 21, 21, 17, 17, 17],
  N: [17, 25, 21, 19, 17, 17, 17],
  O: [14, 17, 17, 17, 17, 17, 14],
  P: [30, 17, 17, 30, 16, 16, 16],
  Q: [14, 17, 17, 17, 21, 18, 13],
  R: [30, 17, 17, 30, 20, 18, 17],
  S: [15, 16, 16, 14, 1, 1, 30],
  T: [31, 4, 4, 4, 4, 4, 4],
  U: [17, 17, 17, 17, 17, 17, 14],
  V: [17, 17, 17, 17, 17, 10, 4],
  W: [17, 17, 17, 21, 21, 27, 17],
  X: [17, 17, 10, 4, 10, 17, 17],
  Y: [17, 17, 10, 4, 4, 4, 4],
  Z: [31, 1, 2, 4, 8, 16, 31],
  '0': [14, 17, 19, 21, 25, 17, 14],
  '1': [4, 12, 4, 4, 4, 4, 14],
  '2': [14, 17, 1, 2, 4, 8, 31],
  '3': [30, 1, 1, 14, 1, 1, 30],
  '4': [2, 6, 10, 18, 31, 2, 2],
  '5': [31, 16, 30, 1, 1, 17, 14],
  '6': [6, 8, 16, 30, 17, 17, 14],
  '7': [31, 1, 2, 4, 8, 8, 8],
  '8': [14, 17, 17, 14, 17, 17, 14],
  '9': [14, 17, 17, 15, 1, 2, 12],
  '-': [0, 0, 0, 31, 0, 0, 0],
  '/': [1, 1, 2, 4, 8, 16, 16],
  '.': [0, 0, 0, 0, 0, 12, 12],
  '&': [12, 18, 20, 8, 21, 18, 13],
  "'": [4, 4, 8, 0, 0, 0, 0],
};

const glyphWidth = 5;
const glyphHeight = 7;
const bands = 12;

function hslToRgb(
  hue: number,
  saturation: number,
  lightness: number,
): [number, number, number] {
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const sector = (hue % 360) / 60;
  const x = chroma * (1 - Math.abs((sector % 2) - 1));
  const [r, g, b] =
    sector < 1
      ? [chroma, x, 0]
      : sector < 2
        ? [x, chroma, 0]
        : sector < 3
          ? [0, chroma, x]
          : sector < 4
            ? [0, x, chroma]
            : sector < 5
              ? [x, 0, chroma]
              : [chroma, 0, x];
  const m = lightness - chroma / 2;
  return [r, g, b].map((channel) => Math.round((channel + m) * 255)) as [
    number,
    number,
    number,
  ];
}

/** The text scale that fits `labelColumns` characters in 80% of the width. */
export function labelScale(width: number): number {
  return Math.max(
    1,
    Math.floor((width * 0.8) / ((glyphWidth + 1) * labelColumns)),
  );
}

/**
 * The photo as raw RGB, row by row. A diagonal gradient in twelve flat bands (so it compresses to a
 * small file at any size), under a dark panel carrying the label in white.
 */
export function renderTestPhoto(
  spec: Pick<TestPhotoPlan, 'width' | 'height' | 'hue' | 'label'>,
): Uint8Array {
  const { width, height, label } = spec;
  const out = new Uint8Array(width * height * 3);
  const from = hslToRgb(spec.hue, 0.65, 0.45);
  const to = hslToRgb(spec.hue + 50, 0.7, 0.62);
  const span = width + height;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const band = Math.floor(((x + y) / span) * bands) / (bands - 1);
      const at = (y * width + x) * 3;
      for (let c = 0; c < 3; c++) {
        out[at + c] = Math.round(
          (from[c] ?? 0) + ((to[c] ?? 0) - (from[c] ?? 0)) * Math.min(1, band),
        );
      }
    }
  }
  const scale = labelScale(width);
  const lineHeight = (glyphHeight + 2) * scale;
  const panelWidth = Math.floor(width * 0.88);
  const panelHeight = label.length * lineHeight + scale * 2;
  const left = Math.floor((width - panelWidth) / 2);
  const top = Math.max(0, Math.floor((height - panelHeight) / 2));
  const panelRows = label.length === 0 ? 0 : panelHeight;
  for (let y = top; y < Math.min(height, top + panelRows); y++) {
    for (let x = left; x < left + panelWidth; x++) {
      const at = (y * width + x) * 3;
      for (let c = 0; c < 3; c++)
        out[at + c] = Math.round((out[at + c] ?? 0) * 0.25);
    }
  }
  label.forEach((line, row) => {
    const textWidth = line.length * (glyphWidth + 1) * scale;
    const originX = Math.max(left, Math.floor((width - textWidth) / 2));
    const originY = top + scale + row * lineHeight;
    line.split('').forEach((char, index) => {
      const rows = glyphs[char];
      if (!rows) return;
      rows.forEach((bits, dy) => {
        for (let dx = 0; dx < glyphWidth; dx++) {
          if (!(bits & (1 << (glyphWidth - 1 - dx)))) continue;
          for (let sy = 0; sy < scale; sy++) {
            for (let sx = 0; sx < scale; sx++) {
              const px = originX + (index * (glyphWidth + 1) + dx) * scale + sx;
              const py = originY + dy * scale + sy;
              if (px >= width || py >= height) continue;
              const at = (py * width + px) * 3;
              out[at] = 255;
              out[at + 1] = 255;
              out[at + 2] = 255;
            }
          }
        }
      });
    });
  });
  return out;
}
