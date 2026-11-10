import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import {
  browseDays,
  browseTitle,
  browseWindowDays,
  toBrowsePage,
  type BrowsePage,
} from '@/lib/pages/browse';
import { tags } from '@/lib/cacheTags';
import { type BrowseFilters, type BrowseQuery } from '@/lib/filters';
import { upcomingWindow } from '@/lib/sessionWindow';
import {
  countableFilters,
  omittedFor,
  removals,
  suggestions,
  type FilterParam,
  type ZeroResultSuggestion,
} from '@/lib/zeroResults';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { tagExperiences } from '@/server/cache/tagExperiences';
import {
  countBrowseExperiences,
  listBrowseDayRows,
  listBrowseExperiences,
} from '@/server/db/browse';
import { getFilterOptions } from '@/server/filterOptions';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

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
  // A cursor nobody can see is not worth an entry per made-up id.
  if (!page.ok) cacheLife('uncached');
  if (page.ok) tagExperiences(page.items.map((experience) => experience.id));
  return page;
}

/** The days a guest can pick for the category, neighborhood, and guests filters, as YYYY-MM-DD. */
export async function getBrowseDates(
  filters: Pick<BrowseFilters, 'categories' | 'neighborhoods' | 'guests'>,
  asOf: string,
): Promise<string[]> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  return readOrRefuse('Browse dates', async () =>
    browseDays(await listBrowseDayRows(filters, asOf)),
  );
}

/**
 * The page title for a filter combination. The title is presentation, so a failed name read costs
 * the filter names and nothing else; the page's own read shows the error state.
 */
export async function getBrowseTitle(filters: BrowseFilters): Promise<string> {
  try {
    return browseTitle(filters, await getFilterOptions());
  } catch (error) {
    rethrowOrLog('Browse title could not be read', error);
    return browseTitle(filters, { categories: [], neighborhoods: [] });
  }
}

// Cached, so a failed read throws and nothing is remembered; `getZeroResultSuggestions` is the one that forgives it.
async function readZeroResultSuggestions(
  filters: BrowseFilters,
  asOf: string,
): Promise<ZeroResultSuggestion[]> {
  'use cache';
  cacheLife('browse');
  cacheTag(tags.catalog);
  const options = await getFilterOptions();
  const window = upcomingWindow(asOf, browseWindowDays);
  const counts: Partial<Record<FilterParam, number>> = {};
  const omit = omittedFor(filters);
  await readOrRefuse('Zero results', () =>
    Promise.all(
      removals(filters, options, omit).map(
        async ({ param, filters: without }) => {
          const countable = countableFilters(without, options, window);
          counts[param] =
            countable === null
              ? 0
              : await countBrowseExperiences(countable, asOf);
        },
      ),
    ),
  );
  return suggestions(filters, options, counts, omit);
}

/**
 * The filters worth taking off a page with no results, with what browse would list without each. A
 * count is one cheap read per filter that is on, so this is asked for only when the page is empty.
 * A way forward is a courtesy: when its reads fail the empty state shows without it.
 */
export async function getZeroResultSuggestions(
  filters: BrowseFilters,
  asOf: string,
): Promise<ZeroResultSuggestion[]> {
  try {
    return await readZeroResultSuggestions(filters, asOf);
  } catch (error) {
    rethrowOrLog('Browse suggestions could not be read', error);
    return [];
  }
}
