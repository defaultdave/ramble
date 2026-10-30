import { connection } from 'next/server';
import {
  UpcomingSessions,
  UpcomingSessionsError,
} from '@/components/UpcomingSessions';
import type { RawSearchParams } from '@/lib/filters';
import type { ExperiencePageView } from '@/lib/pages/experience';
import { minuteAsOf } from '@/lib/time';
import {
  buildUpcomingSessions,
  selectedDateFrom,
} from '@/lib/upcomingSessions';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readUpcomingSessions } from '@/server/upcomingSessions';

type UpcomingSessionsContentProps = {
  upcoming: ExperiencePageView['upcoming'];
  bookHref: string;
  /** Not awaited by the page, so only this streamed part waits for the address's query. */
  searchParams: Promise<RawSearchParams>;
  retryHref: string;
};

/** The streamed upcoming dates: the next sessions of the experience with the spaces left in each. */
export async function UpcomingSessionsContent({
  upcoming,
  bookHref,
  searchParams,
  retryHref,
}: UpcomingSessionsContentProps) {
  const selectedDate = selectedDateFrom(await searchParams);
  // The time is a request-time value, so a prefetch of this page stops here instead of reading it.
  await connection();
  // TODO(U-005): read the time from the Clock port once it exists.
  const asOf = minuteAsOf(new Date());

  let sessions;
  try {
    sessions = await readUpcomingSessions(upcoming.experienceId, asOf);
  } catch (error) {
    rethrowOrLog('The upcoming dates could not be read', error);
    return <UpcomingSessionsError retryHref={retryHref} />;
  }

  return (
    <UpcomingSessions
      view={buildUpcomingSessions({
        sessions,
        priceOptions: upcoming.priceOptions,
        selectedDate,
        bookHref,
      })}
    />
  );
}
