import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { isSlug } from '@/lib/catalog';
import type { PageCopy } from '@/lib/editorial';
import {
  landingTag,
  landingTarget,
  type LandingKind,
} from '@/lib/pages/landing';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { getPublishedPageCopy } from '@/server/db/editorial';
import { getFilterOptions } from '@/server/filterOptions';

export type LandingData = {
  name: string;
  /** Null until an editor has published copy for the page; the page then shows a plain heading over the results. */
  copy: PageCopy | null;
};

/**
 * What a category or neighborhood page shows apart from its experiences, or null when the address is
 * not a slug or the catalog has no category or neighborhood by it. A malformed address is refused
 * before the cache is asked, so a prerender of it needs nothing at request time.
 */
export async function getLandingData(
  kind: LandingKind,
  slug: string,
): Promise<LandingData | null> {
  if (!isSlug(slug)) return null;
  return readLandingData(kind, slug);
}

/**
 * Editing the copy reaches this entry through the category or neighborhood tag. No change kind
 * reaches `tags.taxonomy`, which `getFilterOptions` hands to it, so a rename shows when the
 * `editorial` profile runs out. A miss is not kept (the `uncached`
 * profile), so made-up addresses fill nothing, and the names come from the cached lists, so a miss
 * costs no database read.
 */
async function readLandingData(
  kind: LandingKind,
  slug: string,
): Promise<LandingData | null> {
  'use cache';
  cacheLife('editorial');
  const target = landingTarget(kind, slug, await getFilterOptions());
  if (!target) {
    cacheLife('uncached');
    return null;
  }
  cacheTag(landingTag(kind, slug));
  const copy = await readOrRefuse('Landing page copy', () =>
    getPublishedPageCopy(kind, slug),
  );
  return { name: target.name, copy };
}
