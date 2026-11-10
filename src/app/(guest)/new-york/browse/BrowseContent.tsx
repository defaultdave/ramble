import { connection } from 'next/server';
import { BrowseResults } from '@/components/BrowseResults';
import { FilterBar } from '@/components/FilterBar';
import {
  browseHeading,
  browseResultsId,
  browseView,
  browseWindowDays,
  emptyBrowsePage,
  errorView,
  withSuggestions,
} from '@/lib/pages/browse';
import {
  knownFilters,
  parseFilters,
  type BrowseFilters,
  type RawSearchParams,
} from '@/lib/filters';
import { upcomingWindow } from '@/lib/sessionWindow';
import { minuteAsOf } from '@/lib/time';
import { venueToday } from '@/lib/venue';
import {
  getBrowseDates,
  getBrowseResults,
  getZeroResultSuggestions,
} from '@/server/browse';
import { getFilterOptions } from '@/server/filterOptions';
import { chooseBrowseDate } from '@/server/actions/browse';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { systemClock } from '@/server/ports/clock';

import styles from './page.module.css';

type BrowseContentProps = { searchParams: Promise<RawSearchParams> };

export async function BrowseContent({ searchParams }: BrowseContentProps) {
  const query = parseFilters(await searchParams);
  const { filters } = query;
  // The time is a request-time value, so a prefetch of this page stops here instead of reading it.
  await connection();
  const now = systemClock.now();
  const asOf = minuteAsOf(now);

  let loaded;
  try {
    const options = await getFilterOptions();
    // Only slugs the catalog has reach a cache key or the database; the view below keeps the address as it was.
    const known = knownFilters(
      filters,
      options,
      upcomingWindow(asOf, browseWindowDays),
    );
    const { categories, neighborhoods, guests } = known.filters;
    // The calendar ignores the date, so the date is no part of its cache key. A date no session can be on still needs the calendar, for the way out of its empty state.
    const [dates, page] = known.matchesNothing
      ? [[], emptyBrowsePage]
      : await Promise.all([
          getBrowseDates({ categories, neighborhoods, guests }, asOf),
          known.dateOutsideWindow
            ? emptyBrowsePage
            : getBrowseResults({ ...query, filters: known.filters }, asOf),
        ]);
    loaded = { options, dates, page };
  } catch (error) {
    rethrowOrLog('Browse could not be read', error);
    return (
      <div id={browseResultsId} data-reveal-without-script>
        <p role="status" className={styles.announcement} />
        <BrowseResults {...errorView(query)} />
      </div>
    );
  }

  const { options, dates, page } = loaded;
  const found = browseView(query, page, dates);
  const view =
    found.state === 'empty' && found.filtered
      ? withSuggestions(found, await zeroResultSuggestions(filters, asOf))
      : found;
  return (
    <div id={browseResultsId} data-reveal-without-script>
      {/* Always rendered, so a screen reader hears the text change when the filters do. */}
      <p role="status" className={styles.announcement}>
        {browseHeading(view)}
      </p>
      <div className={styles.band}>
        <FilterBar
          categories={options.categories.map(({ slug, name }) => ({
            slug,
            name,
          }))}
          neighborhoods={options.neighborhoods.map(({ slug, name }) => ({
            slug,
            name,
          }))}
          filters={filters}
          today={venueToday(now)}
          availableDates={dates}
          onPickDate={chooseBrowseDate.bind(null, filters)}
        />
        <BrowseResults {...view} />
      </div>
    </div>
  );
}

/** A way forward is a courtesy: when its reads fail, the empty state shows without it. */
async function zeroResultSuggestions(filters: BrowseFilters, asOf: string) {
  try {
    return await getZeroResultSuggestions(filters, asOf);
  } catch (error) {
    rethrowOrLog('Browse suggestions could not be read', error);
    return [];
  }
}
