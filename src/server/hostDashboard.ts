import 'server-only';
import {
  hostAccessFor,
  hostDashboardResult,
  readableHostId,
  type HostDashboardResult,
} from '@/lib/hostAccess';
import { getCaller } from '@/server/auth/caller';
import { readHostDashboard } from '@/server/db/hostDashboard';
import { systemClock } from '@/server/ports/clock';

/**
 * The dashboard of the host the request's caller owns or is staff of. A failed read propagates, so the host
 * area's error page shows instead of a dashboard that could be missing sessions.
 */
export async function loadHostDashboard(): Promise<HostDashboardResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const hostId = readableHostId(access);
  const data =
    hostId === null
      ? null
      : await readHostDashboard(caller, hostId, systemClock.now());
  return hostDashboardResult(access, data);
}
