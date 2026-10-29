import { z } from 'zod';
import { hasSpaceLeft } from './spaces';
import { msPerDay } from './time';

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

/** A session that starts at `from` or later and before `to`: a start exactly at `from` is in, one exactly at `to` is out. */
export function isUpcomingSession(
  session: Pick<WindowedSession, 'startsAt'>,
  window: SessionWindow,
): boolean {
  const start = session.startsAt.getTime();
  return start >= window.from.getTime() && start < window.to.getTime();
}

/** An upcoming session that still has a space left. */
export function isOpenSession(
  session: WindowedSession,
  window: SessionWindow,
): boolean {
  return isUpcomingSession(session, window) && hasSpaceLeft(session);
}
