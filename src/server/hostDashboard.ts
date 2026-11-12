import 'server-only';
import {
  hostDashboardResult,
  type HostDashboardResult,
} from '@/lib/hostAccess';
import { readHostDashboard } from '@/server/db/hostDashboard';
import { systemClock } from '@/server/ports/clock';
import { loadForHostArea } from './hostArea';

/**
 * The dashboard of the host the request's caller owns or is staff of. A failed read propagates, so
 * the host area's error page shows instead of a dashboard that could be missing sessions.
 */
export function loadHostDashboard(): Promise<HostDashboardResult> {
  return loadForHostArea(
    (caller, hostId) => readHostDashboard(caller, hostId, systemClock.now()),
    hostDashboardResult,
    true,
  );
}
