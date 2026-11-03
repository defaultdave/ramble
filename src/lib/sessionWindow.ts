import { z } from 'zod';
import { hasSpaceForParty, hasSpaceLeft } from './spaces';
import { msPerDay, msPerHour } from './time';

/** The minute key a cached read takes, as `minuteAsOf` writes it. */
const AsOfSchema = z.iso.datetime();

/** The sessions a read looks at: those that start from `from` up to, not including, `to`. */
export type SessionWindow = { from: Date; to: Date };

/** What the predicates decide from: when a session starts and how many spaces it holds and has sold. */
type WindowedSession = {
  startsAt: Date;
  allocation: number;
  seatsSold: number;
};

/** The window that opens at `asOf` and runs `days` days. `asOf` is a key, so this never reads the clock. */
export function upcomingWindow(asOf: string, days: number): SessionWindow {
  const from = new Date(AsOfSchema.parse(asOf));
  return { from, to: new Date(from.getTime() + days * msPerDay) };
}

// Host zones run from UTC-12 to UTC+14, so one instant is on a different calendar date in each of them.
const westmostZoneOffsetMs = -12 * msPerHour;
const eastmostZoneOffsetMs = 14 * msPerHour;

/**
 * Whether a session in the window could fall on the calendar `date` (YYYY-MM-DD) in some host zone.
 * A day outside this has no session to find, so a read for it is wasted.
 */
export function isDateInWindow(date: string, window: SessionWindow): boolean {
  const first = new Date(window.from.getTime() + westmostZoneOffsetMs);
  // `to` is not in the window, so the last instant is a millisecond before it.
  const last = new Date(window.to.getTime() - 1 + eastmostZoneOffsetMs);
  return (
    date >= first.toISOString().slice(0, 10) &&
    date <= last.toISOString().slice(0, 10)
  );
}

/** A session that starts at `from` or later and before `to`: a start exactly at `from` is in, one exactly at `to` is out. */
export function isUpcomingSession(
  session: Pick<WindowedSession, 'startsAt'>,
  window: SessionWindow,
): boolean {
  const start = session.startsAt.getTime();
  return start >= window.from.getTime() && start < window.to.getTime();
}

/** An upcoming session that still has a space left, or room for the whole `party` when one is given. */
export function isOpenSession(
  session: WindowedSession,
  window: SessionWindow,
  party: number | null = null,
): boolean {
  return (
    isUpcomingSession(session, window) &&
    (party === null ? hasSpaceLeft(session) : hasSpaceForParty(session, party))
  );
}
