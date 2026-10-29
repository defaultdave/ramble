import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { browseDays, toBrowsePage, type BrowsePage } from '@/lib/browse';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import type { BrowseFilters, BrowseQuery } from '@/lib/filters';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listBrowseDayRows, listBrowseExperiences } from '@/server/db/browse';
import { listCategories, listNeighborhoods } from '@/server/db/catalog';

// A schedule change reaches an entry here only through the experiences it lists. A session added to
// an experience that is not on the page waits for the browse profile to run out (about a minute).

/** One page of results for one filter combination. `asOf` is the minute (`minuteAsOf`), so a minute shares one entry. */
export async function getBrowseResults(
  query: BrowseQuery,
  asOf: string,
): Promise<BrowsePage> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  const read = await readOrRefuse('Browse', () =>
    listBrowseExperiences(query, asOf),
  );
  const page = toBrowsePage(query.after, read);
  if (page.ok) {
    for (const experience of page.items)
      cacheTag(tags.experience(experience.id));
  }
  return page;
}

/** The days a guest can pick for the category and neighborhood filters, as YYYY-MM-DD. */
export async function getBrowseDates(
  filters: Pick<BrowseFilters, 'categories' | 'neighborhoods'>,
  asOf: string,
): Promise<string[]> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  return readOrRefuse('Browse dates', async () =>
    browseDays(await listBrowseDayRows(filters, asOf)),
  );
}

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
