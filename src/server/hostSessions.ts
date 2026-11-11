import 'server-only';
import { hostAccessFor } from '@/lib/hostAccess';
import { buildHostWeek, type HostWeekView } from '@/lib/hostSessions';
import { getCaller } from '@/server/auth/caller';
import { readHostWeek } from '@/server/db/sessions';
import { systemClock } from '@/server/ports/clock';

export type HostWeekResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostWeekView };

/**
 * The week of the host the request's caller owns. The host comes from the caller's own grant, never
 * from the address; anyone who is not a host owner is refused, as is an owner whose host is gone. A
 * failed read propagates, so the host area's error page shows instead of a partial week.
 */
export async function loadHostWeek(
  rawWeek: string | undefined,
): Promise<HostWeekResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner') return { status: 'refused' };
  const now = systemClock.now();
  const data = await readHostWeek(caller, access.hostId, rawWeek, now);
  return data === null
    ? { status: 'refused' }
    : { status: 'ok', view: buildHostWeek(data, now) };
}
