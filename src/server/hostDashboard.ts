import 'server-only';
import {
  hostAccessFor,
  hostDashboardResult,
  type HostDashboardResult,
} from '@/lib/hostAccess';
import { getCaller } from '@/server/auth/caller';
import { readHostDashboard } from '@/server/db/hostDashboard';
import { systemClock } from '@/server/ports/clock';

/**
 * The dashboard of the host the request's caller owns. A failed read propagates, so the host
 * area's error page shows instead of a dashboard that could be missing sessions.
 */
export async function loadHostDashboard(): Promise<HostDashboardResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const data =
    access.kind === 'owner'
      ? await readHostDashboard(caller, access.hostId, systemClock.now())
      : null;
  return hostDashboardResult(access, data);
}
