import 'server-only';
import { and, asc, eq, gte, lt } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import type { SessionWindow } from '@/lib/sessionWindow';
import {
  UpcomingSessionSchema,
  upcomingSessionLimits,
  type UpcomingSession,
} from '@/lib/upcomingSessions';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { experiences, sessions } from './schema';

/**
 * The next scheduled sessions of one experience a guest can see: from the window's opening up to,
 * not including, its end, soonest first, at most `maxRows`. A full session is still listed; the
 * caller reads its spaces. Guest-visible rows only, so it takes no caller.
 */
export async function listUpcomingSessions(
  experienceId: string,
  window: SessionWindow,
): Promise<UpcomingSession[]> {
  const lookedUp = EntityIdSchema.parse(experienceId);
  const rows = await dbRead
    .select({
      id: sessions.id,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
    })
    .from(sessions)
    .innerJoin(experiences, eq(sessions.experienceId, experiences.id))
    .where(
      and(
        guestVisible,
        eq(sessions.experienceId, lookedUp),
        eq(sessions.status, 'scheduled'),
        gte(sessions.startsAt, window.from),
        lt(sessions.startsAt, window.to),
      ),
    )
    .orderBy(asc(sessions.startsAt), asc(sessions.id))
    .limit(upcomingSessionLimits.maxRows);
  return UpcomingSessionSchema.array().parse(rows);
}
