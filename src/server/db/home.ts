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
import { GuestPhotoSchema } from '@/lib/photos';
import { photoView } from '@/lib/photoViews';
import type { SessionWindow } from '@/lib/sessionWindow';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { coverWith } from './photos';
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
        ...(covers
          ? { image: cover ? photoView(GuestPhotoSchema.parse(cover)) : null }
          : {}),
      };
    }),
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
