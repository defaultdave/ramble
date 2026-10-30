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
 */
export async function getFilterOptions(): Promise<{
  categories: Category[];
  neighborhoods: Neighborhood[];
}> {
  'use cache';
  cacheLife('catalog');
  cacheTag(tags.taxonomy);
  const [categories, neighborhoods] = await readOrRefuse('Filter options', () =>
    Promise.all([listCategories(), listNeighborhoods()]),
  );
  return { categories, neighborhoods };
}
