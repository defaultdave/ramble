import { connection } from 'next/server';
import { BrowseResults } from '@/components/BrowseResults';
import { FilterBar } from '@/components/FilterBar';
import {
  browseCardIds,
  browseView,
  errorView,
  withBrowseCovers,
} from '@/lib/browse';
import { parseFilters, type RawSearchParams } from '@/lib/filters';
import { coverLookupIds, coversByExperience } from '@/lib/photoViews';
import { minuteAsOf } from '@/lib/time';
import { venueToday } from '@/lib/venue';
import { getCoverPhotos } from '@/server/coverPhotos';
import {
  getBrowseDates,
  getBrowseResults,
  getFilterOptions,
} from '@/server/browse';
import { chooseBrowseDate } from '@/server/actions/browse';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';

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
    const [options, dates, page] = await Promise.all([
      getFilterOptions(),
      getBrowseDates(filters, asOf),
      getBrowseResults(query, asOf),
    ]);
    const covers = await getCoverPhotos(coverLookupIds(browseCardIds(page)));
    loaded = { options, dates, page, covers: coversByExperience(covers) };
  } catch (error) {
    rethrowOrLog('Browse could not be read', error);
    return <BrowseResults {...errorView(query)} />;
  }

  const { options, dates, page, covers } = loaded;
  return (
    <>
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
      <BrowseResults
        {...withBrowseCovers(browseView(query, page, dates), covers)}
      />
    </>
  );
}
