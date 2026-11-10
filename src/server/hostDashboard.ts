import 'server-only';
import {
  buildHostDashboard,
  type HostDashboardView,
} from '@/lib/hostDashboard';
import { getCaller } from '@/server/auth/caller';
import { readHostDashboard } from '@/server/db/hostDashboard';
import { systemClock } from '@/server/ports/clock';
import { hostAccessFor } from './hostAccess';

export type HostDashboardResult =
  | { status: 'signed_out' }
  | { status: 'refused' }
  | { status: 'ok'; view: HostDashboardView };

/**
 * The dashboard of the host the request's caller owns. Nobody signed in is told to sign in; anyone
 * else who is not a host owner is refused, as is an owner whose host no longer exists. A failed
 * read propagates, so the host area's error page shows instead of a dashboard that could be missing sessions.
 */
export async function loadHostDashboard(): Promise<HostDashboardResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  if (access.kind === 'signed_out') return { status: 'signed_out' };
  if (access.kind === 'not_a_host_owner') return { status: 'refused' };

  const data = await readHostDashboard(
    caller,
    access.hostId,
    systemClock.now(),
  );
  return data
    ? { status: 'ok', view: buildHostDashboard(data) }
    : { status: 'refused' };
}
