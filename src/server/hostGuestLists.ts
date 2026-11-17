import 'server-only';
import {
  hostBookingListResult,
  hostGuestListResult,
  parseSessionId,
  type HostBookingListResult,
  type HostGuestListResult,
} from '@/lib/hostGuestLists';
import {
  readHostBookings,
  readHostGuestList,
} from '@/server/db/hostGuestLists';
import { loadForHostArea } from './hostArea';

/**
 * The bookings of the host the request's caller owns or is staff of, narrowed by `term` (already read with
 * `parseSearchTerm`). A failed read propagates, so the host area's error page shows.
 */
export function loadHostBookings(term: string): Promise<HostBookingListResult> {
  return loadForHostArea(
    (caller, hostId) => readHostBookings(caller, hostId, term),
    (access, data) => hostBookingListResult(access, data, term),
    true,
  );
}

/**
 * The guest list of one session, for the host the caller owns or is staff of. A session id that is no id, is
 * missing, or is another host's is refused the same way, so an address never says which exist.
 */
export function loadHostGuestList(
  rawSessionId: string,
): Promise<HostGuestListResult> {
  const sessionId = parseSessionId(rawSessionId);
  return loadForHostArea(
    (caller, hostId) =>
      sessionId === null
        ? Promise.resolve(null)
        : readHostGuestList(caller, hostId, sessionId),
    hostGuestListResult,
    true,
  );
}
