import 'server-only';
import { and, asc, eq, gte, inArray, lt } from 'drizzle-orm';
import {
  CardExperienceSchema,
  type CardExperience,
} from '@/lib/experienceCards';
import {
  HomeExperienceIdsSchema,
  ThisWeekSessionSchema,
  homeLimits,
  type ThisWeekSession,
} from '@/lib/home';
import type { SessionWindow } from '@/lib/sessionWindow';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { experiences, sessions } from './schema';

/**
 * The experiences with these IDs that a guest can see, with what a card shows. An ID that is
 * missing or hidden is simply not in the answer. Guest-visible rows only, so it takes no caller.
 */
export async function listHomeExperiences(
  ids: readonly string[],
): Promise<CardExperience[]> {
  const lookedUp = HomeExperienceIdsSchema.parse(ids);
  const rows = await dbRead.query.experiences.findMany({
    where: and(guestVisible, inArray(experiences.id, lookedUp)),
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
      priceOptions: {
        columns: { priceMinor: true, usesSpace: true },
      },
    },
    orderBy: [asc(experiences.name), asc(experiences.id)],
    limit: homeLimits.maxCardIds,
  });
  return CardExperienceSchema.array().parse(
    rows.map(({ neighborhood, ...row }) => ({
      ...row,
      neighborhoodName: neighborhood.name,
    })),
  );
}

/**
 * The scheduled sessions that start from the window's opening up to, not including, its end, of the
 * experiences a guest can see: soonest first, at most `thisWeekSessions`. Whether a session still
 * has space is decided by the caller, from the counts.
 */
export async function listThisWeekSessions(
  window: SessionWindow,
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
        gte(sessions.startsAt, window.from),
        lt(sessions.startsAt, window.to),
      ),
    )
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .limit(homeLimits.thisWeekSessions);
  return ThisWeekSessionSchema.array().parse(rows);
}
