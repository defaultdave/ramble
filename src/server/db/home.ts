import 'server-only';
import { and, asc, eq, gt, inArray, lte } from 'drizzle-orm';
import {
  HomeExperienceSchema,
  ThisWeekSessionSchema,
  homeLimits,
  type HomeExperience,
  type ThisWeekSession,
  type ThisWeekWindow,
} from '@/lib/home';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { experiences, sessions } from './schema';

/**
 * The experiences with these IDs that a guest can see, with what a card shows. An ID that is
 * missing or hidden is simply not in the answer. Guest-visible rows only, so it takes no caller.
 */
export async function listHomeExperiences(
  ids: readonly string[],
): Promise<HomeExperience[]> {
  if (ids.length === 0) return [];
  if (ids.length > homeLimits.maxCardIds) {
    throw new RangeError(
      `A home read looks up at most ${String(homeLimits.maxCardIds)} experiences`,
    );
  }
  const rows = await dbRead.query.experiences.findMany({
    where: and(guestVisible, inArray(experiences.id, [...ids])),
    columns: {
      id: true,
      slug: true,
      name: true,
      status: true,
      durationMinutes: true,
      linkOutUrl: true,
    },
    with: {
      neighborhood: { columns: { name: true } },
      priceOptions: { columns: { kind: true, priceMinor: true } },
    },
    orderBy: [asc(experiences.name), asc(experiences.id)],
    limit: homeLimits.maxCardIds,
  });
  return HomeExperienceSchema.array().parse(
    rows.map(({ neighborhood, ...row }) => ({
      ...row,
      neighborhoodName: neighborhood.name,
    })),
  );
}

/**
 * The scheduled sessions that start after the window opens, up to the window's end, of the
 * experiences a guest can see: soonest first, at most `thisWeekSessions`. Whether a session still
 * has space is decided by the caller, from the counts.
 */
export async function listThisWeekSessions(
  window: ThisWeekWindow,
): Promise<ThisWeekSession[]> {
  const rows = await dbRead
    .select({
      experienceId: sessions.experienceId,
      experienceStatus: experiences.status,
      startsAt: sessions.startsAt,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
    })
    .from(sessions)
    .innerJoin(experiences, eq(sessions.experienceId, experiences.id))
    .where(
      and(
        guestVisible,
        eq(sessions.status, 'scheduled'),
        gt(sessions.startsAt, window.from),
        lte(sessions.startsAt, window.to),
      ),
    )
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .limit(homeLimits.thisWeekSessions);
  return ThisWeekSessionSchema.array().parse(rows);
}
