import { connection } from 'next/server';
import { BrowseResults } from '@/components/BrowseResults';
import { FilterBar } from '@/components/FilterBar';
import {
  browseHeading,
  browseView,
  emptyBrowsePage,
  errorView,
} from '@/lib/pages/browse';
import {
  knownFilters,
  parseFilters,
  type RawSearchParams,
} from '@/lib/filters';
import { minuteAsOf } from '@/lib/time';
import { venueToday } from '@/lib/venue';
import {
  getBrowseDates,
  getBrowseResults,
  getFilterOptions,
} from '@/server/browse';
import { chooseBrowseDate } from '@/server/actions/browse';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

import styles from './page.module.css';

type BrowseContentProps = { searchParams: Promise<RawSearchParams> };

export async function BrowseContent({ searchParams }: BrowseContentProps) {
  const query = parseFilters(await searchParams);
  const { filters } = query;
  // The time is a request-time value, so a prefetch of this page stops here instead of reading it.
  await connection();
  // TODO(U-005): read the time from the Clock port once it exists.
  const now = new Date();
  const asOf = minuteAsOf(now);

  let loaded;
  try {
    const options = await getFilterOptions();
    // Only slugs the catalog has reach a cache key or the database; the view below keeps the address as it was.
    const known = knownFilters(filters, options);
    const [dates, page] = known.matchesNothing
      ? [[], emptyBrowsePage]
      : await Promise.all([
          getBrowseDates(known.filters, asOf),
          getBrowseResults({ ...query, filters: known.filters }, asOf),
        ]);
    loaded = { options, dates, page };
  } catch (error) {
    rethrowOrLog('Browse could not be read', error);
    return (
      <>
        <p role="status" className={styles.announcement} />
        <BrowseResults {...errorView(query)} />
      </>
    );
  }

  const { options, dates, page } = loaded;
  const view = browseView(query, page, dates);
  return (
    <>
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
    </>
  );
}
