import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { isSlug } from '@/lib/catalog';
import type { Collection } from '@/lib/editorial';
import type { CardExperience } from '@/lib/experienceCards';
import type { CollectionPageKind } from '@/lib/pages/picks';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { tagExperiences } from '@/server/cache/tagExperiences';
import { getPublishedGiftGuide, getPublishedPick } from '@/server/db/editorial';
import { listHomeExperiences } from '@/server/db/home';

export type CollectionPageData = {
  collection: Collection;
  /** The experiences a guest can see among the entries, in no order: the page sets the editor's. */
  experiences: CardExperience[];
};

/**
 * A published Pick or the gift guide with the experiences it lists, or null when the address is
 * not a slug, nothing is published there, or it is still a draft. A malformed address is refused
 * before the cache is asked, so a prerender of it needs nothing at request time.
 */
export async function getCollectionPage(
  kind: CollectionPageKind,
  slug: string | null,
): Promise<CollectionPageData | null> {
  if (kind === 'pick' && (slug === null || !isSlug(slug))) return null;
  return readCollectionPage(kind, slug);
}

/**
 * Editing the collection reaches this entry through its own tag. `catalog` is there for the
 * experiences the entry does not hold yet: publishing one that was hidden is a listing change,
 * which no tag of an experience a guest could not see can carry. Nothing here depends on the
 * minute, so the page is the same for every guest until a tag or the profile ends it. A miss is not
 * kept (the `uncached` profile), so made-up addresses fill nothing.
 */
async function readCollectionPage(
  kind: CollectionPageKind,
  slug: string | null,
): Promise<CollectionPageData | null> {
  'use cache';
  cacheLife('editorial');
  cacheTag(
    tags.catalog,
    kind === 'pick' && slug ? tags.pick(slug) : tags.giftGuide,
  );
  const collection = await readOrRefuse('Collection page', () =>
    kind === 'pick' && slug ? getPublishedPick(slug) : getPublishedGiftGuide(),
  );
  if (!collection) {
    cacheLife('uncached');
    return null;
  }
  const ids = collection.items.map((item) => item.experienceId);
  tagExperiences(ids);
  const experiences =
    ids.length === 0
      ? []
      : await readOrRefuse('Collection experiences', () =>
          listHomeExperiences(ids, { covers: true }),
        );
  return { collection, experiences };
}
