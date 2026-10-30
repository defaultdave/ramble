import 'server-only';
import { cacheLife, cacheTag } from 'next/cache';
import { tags } from '@/lib/cacheTags';
import { EntityIdSchema } from '@/lib/catalog';
import { upcomingWindow } from '@/lib/sessionWindow';
import {
  upcomingSessionLimits,
  type SessionWithSpaces,
  type UpcomingSession,
} from '@/lib/upcomingSessions';
import { readOrRefuse } from '@/server/cache/readOrRefuse';
import { listUpcomingSessions } from '@/server/db/upcomingSessions';
import { getSpacesLeft } from '@/server/spacesLeft';

/**
 * The next sessions of an experience. `asOf` is the minute (`minuteAsOf`), so guests inside one
 * minute share an entry. Adding, moving, or cancelling sessions reaches it through the
 * experience's tag. The spaces in each session are not here: they change with every hold, so
 * they are read per session through `getSpacesLeft`. An ID that is no guid reads nothing and keeps nothing.
 */
async function getUpcomingSessions(
  experienceId: string,
  asOf: string,
): Promise<UpcomingSession[]> {
  'use cache';
  cacheLife('browse');
  // safeParse, not parse: a ZodError carries the raw value, and Next.js logs what a cached function throws.
  if (!EntityIdSchema.safeParse(experienceId).success) {
    cacheLife('uncached');
    return [];
  }
  const id = experienceId.toLowerCase();
  cacheTag(tags.experience(id));
  return readOrRefuse('Upcoming sessions', () =>
    listUpcomingSessions(
      id,
      upcomingWindow(asOf, upcomingSessionLimits.windowDays),
    ),
  );
}

/**
 * The next sessions of an experience, each with the spaces left in it for display (up to a minute
 * stale; the reserve decides). A failure of either read propagates, so the page shows its error
 * state instead of a list that could be missing a sold-out date.
 */
export async function readUpcomingSessions(
  experienceId: string,
  asOf: string,
): Promise<SessionWithSpaces[]> {
  const found = await getUpcomingSessions(experienceId, asOf);
  return Promise.all(
    found.map(async (session) => ({
      session,
      spacesLeft: await getSpacesLeft(session.id),
    })),
  );
}
