import 'server-only';
import { hostAccessFor, readableHostId } from '@/lib/hostAccess';
import { buildHostWeek, type HostWeekView } from '@/lib/hostSessions';
import { getCaller } from '@/server/auth/caller';
import { readHostWeek } from '@/server/db/sessions';
import { systemClock } from '@/server/ports/clock';

export type HostWeekResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostWeekView; canEdit: boolean };

/**
 * The week of the host the request's caller owns or is staff of (staff read it and cannot edit it).
 * The host comes from the caller's own grant, never from the address; anyone with no host role is
 * refused, as is one whose host is gone. A
 * failed read propagates, so the host area's error page shows instead of a partial week.
 */
export async function loadHostWeek(
  rawWeek: string | undefined,
): Promise<HostWeekResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  const hostId = readableHostId(access);
  if (hostId === null) return { status: 'refused' };
  const now = systemClock.now();
  const data = await readHostWeek(caller, hostId, rawWeek, now);
  return data === null
    ? { status: 'refused' }
    : {
        status: 'ok',
        view: buildHostWeek(data, now),
        canEdit: access.kind === 'owner',
      };
}
