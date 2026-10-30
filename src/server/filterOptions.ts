import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listCategories, listNeighborhoods } from '@/server/db/catalog';

/** Every category and neighborhood, for the chips. They change when staff publish, and `tags.catalog` says so. */
export async function getFilterOptions(): Promise<{
  categories: Category[];
  neighborhoods: Neighborhood[];
}> {
  'use cache';
  cacheLife('catalog');
  cacheTag(tags.catalog);
  const [categories, neighborhoods] = await readOrRefuse('Filter options', () =>
    Promise.all([listCategories(), listNeighborhoods()]),
  );
  return { categories, neighborhoods };
}
