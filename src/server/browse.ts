import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { unstable_rethrow } from 'next/navigation';
import { browseDays, toBrowsePage, type BrowsePage } from '@/lib/browse';
import { tags } from '@/lib/cacheTags';
import type { Category, Neighborhood } from '@/lib/catalog';
import type { BrowseFilters, BrowseQuery } from '@/lib/filters';
import { listBrowseDayRows, listBrowseExperiences } from '@/server/db/browse';
import { listCategories, listNeighborhoods } from '@/server/db/catalog';
import { logger } from '@/server/monitoring/logger';

/**
 * What leaves a failed read. A database error carries the query and its values, and Next.js logs
 * whatever a cached function throws, so the cause stays inside and only its kind comes out.
 */
class BrowseReadError extends Error {
  constructor(kind: string) {
    super(`Browse read failed: ${kind}`);
    this.name = 'BrowseReadError';
  }
}

async function readOrRefuse<T>(read: () => Promise<T>): Promise<T> {
  try {
    return await read();
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that breaks the render.
    unstable_rethrow(error);
    throw new BrowseReadError(error instanceof Error ? error.name : 'unknown');
  }
}

// A schedule change reaches an entry here only through the experiences it lists. A session added to
// an experience that is not on the page waits for the browse profile to run out (about a minute).

/** One page of results for one filter combination. `asOf` is the minute (`browseAsOf`), so a minute shares one entry. */
export async function getBrowseResults(
  query: BrowseQuery,
  asOf: string,
): Promise<BrowsePage> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  const read = await readOrRefuse(() => listBrowseExperiences(query, asOf));
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
  return readOrRefuse(async () =>
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
  const [categories, neighborhoods] = await readOrRefuse(() =>
    Promise.all([listCategories(), listNeighborhoods()]),
  );
  return { categories, neighborhoods };
}

/**
 * The filter options for the page title, which can do without them: a failed read gives empty lists
 * and the title loses the names. Only the digest is logged, as `BrowseContent` does, never the error.
 */
export async function getFilterOptionsOrEmpty(): Promise<
  Awaited<ReturnType<typeof getFilterOptions>>
> {
  try {
    return await getFilterOptions();
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    logger.error('Browse filter names could not be read', {
      digest:
        error instanceof Error && 'digest' in error
          ? String(error.digest)
          : undefined,
    });
    return { categories: [], neighborhoods: [] };
  }
}
