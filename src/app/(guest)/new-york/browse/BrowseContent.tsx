import { unstable_rethrow } from 'next/navigation';
import { connection } from 'next/server';
import { BrowseResults } from '@/components/BrowseResults';
import { FilterBar } from '@/components/FilterBar';
import { browseAsOf, browseView, errorView, venueToday } from '@/lib/browse';
import { parseFilters, type RawSearchParams } from '@/lib/filters';
import {
  getBrowseDates,
  getBrowseResults,
  getFilterOptions,
} from '@/server/browse';
import { chooseBrowseDate } from '@/server/actions/browse';
import { logger } from '@/server/monitoring/logger';

type BrowseContentProps = { searchParams: Promise<RawSearchParams> };

export async function BrowseContent({ searchParams }: BrowseContentProps) {
  const query = parseFilters(await searchParams);
  const { filters } = query;
  // The time is a request-time value, so a prefetch of this page stops here instead of reading it.
  await connection();
  // TODO(U-005): read the time from the Clock port once it exists.
  const now = new Date();
  const asOf = browseAsOf(now);

  let loaded;
  try {
    const [options, dates, page] = await Promise.all([
      getFilterOptions(),
      getBrowseDates(filters, asOf),
      getBrowseResults(query, asOf),
    ]);
    loaded = { options, dates, page };
  } catch (error) {
    // Next.js ends a prerender by throwing; swallowing that would break the render.
    unstable_rethrow(error);
    // Only the digest is logged. Next.js strips the message of an error that crosses a cached
    // function, and the digest finds the line it logged there, which names the kind of failure.
    logger.error('Browse could not be read', {
      digest:
        error instanceof Error && 'digest' in error
          ? String(error.digest)
          : undefined,
    });
    return <BrowseResults {...errorView(query)} />;
  }

  const { options, dates, page } = loaded;
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
      <BrowseResults {...browseView(query, page)} />
    </>
  );
}
