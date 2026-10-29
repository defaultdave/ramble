import type { ScaleOptions } from './args';
import { coverageGaps, evaluateCoverage, type SeedSnapshot } from './coverage';
import { minTestPhotos } from './testPhotos';
import type { SeedTargetVerdict } from './target';

// What the seed command says and how it exits. The data layer writes these lines and returns this
// exit code; it decides and words nothing itself.

export type CatalogCounts = {
  hosts: number;
  experiences: number;
  templates: number;
  sessionsCreated: number;
  sessionsAlreadyThere: number;
  seatsAdjusted: number;
};

export type SeedExit = { code: 0 | 1; line: string };

type Refused = Extract<SeedTargetVerdict, { ok: false }>;
type Accepted = Extract<SeedTargetVerdict, { ok: true }>;

export const refusalLine = (verdict: Refused): string =>
  `Refusing to seed: ${verdict.message}`;

export const startLine = (verdict: Accepted): string =>
  `Seeding the ${verdict.target} database on ${verdict.host}`;

/**
 * The exit of a seed that finished: 0 when every probe that applies holds, 1 with the gaps named
 * otherwise. A scale run holds the probes that need the scale fixture to account; a run without
 * one skips them.
 */
export function coverageExit(
  snapshot: SeedSnapshot,
  scale: ScaleOptions | undefined,
): SeedExit {
  const results = evaluateCoverage(snapshot, { scale: scale !== undefined });
  const gaps = coverageGaps(results);
  if (gaps.length > 0) {
    return {
      code: 1,
      line: `Seeded, but the coverage matrix has gaps: ${gaps.join(', ')}`,
    };
  }
  return {
    code: 0,
    line: `Coverage matrix: ${String(results.length)} probes checked, no gaps`,
  };
}

/** The command's exit: 0 only when the matrix and the photo step (null when it was skipped) both hold. */
export function combineSeedExits(
  matrix: SeedExit,
  photos: SeedExit | null,
): 0 | 1 {
  return matrix.code === 0 && (photos === null || photos.code === 0) ? 0 : 1;
}

export const photosLine = (created: number, alreadyThere: number) =>
  `Photos: ${String(created)} written, ${String(alreadyThere)} already there`;

export function photoCoverageLine(
  gaps: readonly string[],
  experiences: number,
): SeedExit {
  return gaps.length > 0
    ? { code: 1, line: `Photo coverage has gaps: ${gaps.join('; ')}` }
    : {
        code: 0,
        line: `Photo coverage: ${String(experiences)} experiences, each with a cover and at least ${String(minTestPhotos)} photos`,
      };
}

export const taxonomyLine = (categories: number, neighborhoods: number) =>
  `Categories ${String(categories)}, neighborhoods ${String(neighborhoods)}`;

export const legalLine = (documents: number) =>
  `Legal documents ${String(documents)}`;

export const curatedLine = (counts: CatalogCounts) =>
  `Curated: ${String(counts.experiences)} experiences, ${String(counts.sessionsCreated)} sessions created`;

export const editorialLine = (
  collections: number,
  homeModules: number,
  pageCopies: number,
) =>
  `Editorial: ${String(collections)} collections, ${String(homeModules)} home modules, ${String(pageCopies)} page copies`;

export const scaleLine = (counts: CatalogCounts) =>
  `Scale: ${String(counts.hosts)} hosts, ${String(counts.experiences)} experiences, ${String(counts.sessionsCreated)} sessions created`;

/** The names a refused step carries in its message. */
export const stepNames = {
  generateSessions: 'generate sessions',
  saveHomeModules: 'save home modules',
  publishLegal: (doc: string) => `publish ${doc}`,
  saveCollection: (slug: string) => `save collection ${slug}`,
  savePageCopy: (kind: string, slug: string) => `save ${kind} copy ${slug}`,
} as const;
