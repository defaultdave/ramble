import 'server-only';
import { hostAreaResult, ownedHostId } from '@/lib/hostAccess';
import { buildHostWeek, type HostWeekView } from '@/lib/hostSessions';
import { readHostWeek } from '@/server/db/sessions';
import { systemClock } from '@/server/ports/clock';
import { loadForHostArea } from './hostArea';

export type HostWeekResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostWeekView };

/**
 * The week of the host the request's caller owns or is staff of (staff read it and cannot edit it).
 * The host comes from the caller's own grant, never from the address; anyone with no host role is
 * refused, as is one whose host is gone. A
 * failed read propagates, so the host area's error page shows instead of a partial week.
 */
export function loadHostWeek(
  rawWeek: string | undefined,
): Promise<HostWeekResult> {
  const now = systemClock.now();
  return loadForHostArea(
    (caller, hostId) => readHostWeek(caller, hostId, rawWeek, now),
    (access, data) =>
      hostAreaResult(
        access,
        data,
        (week, who) => ({
          status: 'ok',
          view: buildHostWeek(week, now, ownedHostId(who) !== null),
        }),
        true,
      ),
    true,
  );
}
