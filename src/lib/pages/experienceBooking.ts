import {
  sessionLabels,
  type BookingOffer,
  type OfferedSession,
} from '../bookingDraft';
import { cancellationWindow } from '../cancellation';
import type { SessionWithSpaces } from '../upcomingSessions';
import { venueToday } from '../venue';
import { zonedDeadlineLabel } from '../zonedLabels';
import type { BookingBasics } from './experience';

/** The cancellation line under the total: the deadline when the booking is still free to cancel, and the plain truth when it no longer is. */
export function cancelNote(
  fullRefundHoursBefore: number,
  startsAt: Date,
  now: Date,
  timeZone: string,
): string {
  const window = cancellationWindow(
    { fullRefundHoursBefore },
    startsAt,
    now,
    timeZone,
  );
  return window.isFree
    ? `Free cancellation until ${zonedDeadlineLabel(window.freeCancelUntil, timeZone)}.`
    : 'The free cancellation window has closed, so this booking will not be refundable.';
}

/** The sessions the choices offer: those guests can see, in the order they arrive, each on its own calendar and clock. */
export function offeredSessions(
  sessions: readonly SessionWithSpaces[],
  fullRefundHoursBefore: number,
  now: Date,
): OfferedSession[] {
  return sessions.flatMap(({ session, spacesLeft }) =>
    spacesLeft === null
      ? []
      : [
          {
            id: session.id,
            ...sessionLabels(session.startsAt, session.timeZone),
            spacesLeft,
            cancelNote: cancelNote(
              fullRefundHoursBefore,
              session.startsAt,
              now,
              session.timeZone,
            ),
          },
        ],
  );
}

/**
 * The booking choices for one experience at `asOf` (a minute key, so the page stays cacheable): the
 * basics, the sessions, the venue's date for the calendar, and `?date=` kept only when it is a date
 * the sessions list.
 */
export function buildBookingOffer(input: {
  basics: BookingBasics;
  sessions: readonly SessionWithSpaces[];
  selectedDate: string | null;
  asOf: string;
}): BookingOffer {
  const { fullRefundHoursBefore, ...basics } = input.basics;
  const now = new Date(input.asOf);
  const sessions = offeredSessions(input.sessions, fullRefundHoursBefore, now);
  return {
    ...basics,
    today: venueToday(now),
    sessions,
    preselectedDate:
      input.selectedDate !== null &&
      sessions.some((session) => session.date === input.selectedDate)
        ? input.selectedDate
        : null,
  };
}
