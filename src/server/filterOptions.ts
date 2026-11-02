import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listCategories, listNeighborhoods } from '@/server/db/catalog';

/**
 * Every category and neighborhood. The home page and the experience page call this instead of
 * reading the two lists again, and a cached read inside a cached read hands its tags and profile
 * to the outer entry, so `tags.taxonomy` evicts all three. It is not `tags.catalog`: a listing
 * change never renames a category, and that tag would evict the home entry on every listing.
 *
 * The profile is `editorial`, not `catalog`: the outer entry takes the shortest lifetime of the
 * reads inside it, so a shorter one here would make the hour-long home entry refresh every 15
 * minutes.
 */
export async function getFilterOptions(): Promise<{
  categories: Category[];
  neighborhoods: Neighborhood[];
}> {
  'use cache';
  cacheLife('editorial');
  cacheTag(tags.taxonomy);
  const [categories, neighborhoods] = await readOrRefuse('Filter options', () =>
    Promise.all([listCategories(), listNeighborhoods()]),
  );
  return { categories, neighborhoods };
}
