import { connection } from 'next/server';
import { BookingBarIsland } from '@/components/BookingBar/BookingBarIsland';
import { BookingPanelIsland } from '@/components/BookingPanel/BookingPanelIsland';
import { BookingSheetIsland } from '@/components/BookingSheet/BookingSheetIsland';
import { BookingSlots } from '@/components/ExperiencePage';
import { UpcomingSessionsError } from '@/components/UpcomingSessions';
import type { RawSearchParams } from '@/lib/filters';
import type { BookingBasics } from '@/lib/pages/experience';
import { buildBookingOffer } from '@/lib/pages/experienceBooking';
import { minuteAsOf } from '@/lib/time';
import { bookingRead, selectedDateFrom } from '@/lib/upcomingSessions';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readUpcomingSessions } from '@/server/upcomingSessions';

type BookingContentProps = {
  basics: BookingBasics;
  /** Not awaited by the page, so only this streamed part waits for the address's query. */
  searchParams: Promise<RawSearchParams>;
  retryHref: string;
};

/**
 * The streamed booking controls: the bar and sheet on a phone, the panel beside the page from the
 * tablet width. They read the upcoming sessions with `bookingRead` (up to 60 sessions), apart from
 * the dates list's own read of 6 rows, and `?date=` preselects its date.
 */
export async function BookingContent({
  basics,
  searchParams,
  retryHref,
}: BookingContentProps) {
  const selectedDate = selectedDateFrom(await searchParams);
  // The time is a request-time value, so a prefetch of this page stops here instead of reading it.
  await connection();
  // TODO(U-005): read the time from the Clock port once it exists.
  const asOf = minuteAsOf(new Date());

  let sessions;
  try {
    sessions = await readUpcomingSessions(
      basics.experienceId,
      asOf,
      bookingRead,
    );
  } catch (error) {
    rethrowOrLog('The booking dates could not be read', error);
    return (
      <BookingSlots
        bar={null}
        panel={<UpcomingSessionsError retryHref={retryHref} />}
      />
    );
  }

  const offer = buildBookingOffer({ basics, sessions, selectedDate, asOf });
  return (
    <BookingSlots
      bar={
        <>
          <BookingBarIsland offer={offer} />
          <BookingSheetIsland offer={offer} />
        </>
      }
      panel={<BookingPanelIsland offer={offer} />}
    />
  );
}
