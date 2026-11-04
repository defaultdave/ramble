import 'server-only';
import { and, asc, eq, gte, inArray, lt, sql } from 'drizzle-orm';
import {
  CardExperienceSchema,
  type CardExperience,
} from '@/lib/experienceCards';
import {
  HomeExperienceIdsSchema,
  ThisWeekSessionSchema,
  homeLimits,
  type ThisWeekSession,
} from '@/lib/pages/home';
import type { SessionWindow } from '@/lib/sessionWindow';
import { soldOutAtSpacesLeft } from '@/lib/spaces';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { coverImage, coverWith } from './photos';
import { experiences, sessions } from './schema';

/**
 * The experiences with these IDs that a guest can see, with what a card shows. An ID that is
 * missing or hidden is simply not in the answer. Guest-visible rows only, so it takes no caller.
 * With `covers`, each row also carries its cover (`image`, null without a photo), read in the same
 * query; without it the page sets the covers.
 */
export async function listHomeExperiences(
  ids: readonly string[],
  { covers }: { covers: boolean },
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
      ...(covers ? { photos: coverWith } : {}),
    },
    orderBy: [asc(experiences.name), asc(experiences.id)],
    limit: homeLimits.maxCardIds,
  });
  return CardExperienceSchema.array().parse(
    rows.map(({ neighborhood, photos: coverRows, ...row }) => {
      // Without `covers` the query did not load photos, so there is no cover row to read.
      const [cover] = covers ? coverRows : [];
      return {
        ...row,
        neighborhoodName: neighborhood.name,
        ...(covers ? { image: coverImage(cover ?? null) } : {}),
      };
    }),
  );
}

/**
 * For each experience a guest can see, its soonest scheduled session with a space left that starts
 * from the window's opening up to, not including, its end; the soonest `thisWeekSessions` of those,
 * soonest first. One row per experience, so a busy experience cannot crowd the others out, and a
 * sold-out session is left out here by the same threshold `hasSpaceLeft` uses. The caller still
 * decides what is open, from these rows.
 */
export async function listThisWeekSessions(
  window: SessionWindow,
): Promise<ThisWeekSession[]> {
  const soonestPerExperience = dbRead
    .selectDistinctOn([sessions.experienceId], {
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
        sql`${sessions.allocation} - ${sessions.seatsSold} > ${soldOutAtSpacesLeft}`,
      ),
    )
    .orderBy(
      asc(sessions.experienceId),
      asc(sessions.startsAt),
      asc(sessions.id),
    )
    .as('soonest_per_experience');
  const rows = await dbRead
    .select()
    .from(soonestPerExperience)
    .orderBy(
      asc(soonestPerExperience.startsAt),
      asc(soonestPerExperience.experienceId),
    )
    .limit(homeLimits.thisWeekSessions);
  return ThisWeekSessionSchema.array().parse(rows);
}
