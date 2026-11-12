import 'server-only';
import { hostAccessFor, readableHostId } from '@/lib/hostAccess';
import {
  hostBookingListResult,
  hostGuestListResult,
  parseSessionId,
  type HostBookingListResult,
  type HostGuestListResult,
} from '@/lib/hostGuestLists';
import { getCaller } from '@/server/auth/caller';
import {
  readHostBookings,
  readHostGuestList,
} from '@/server/db/hostGuestLists';

/**
 * The bookings of the host the request's caller owns or is staff of, narrowed by `term` (already read with
 * `parseSearchTerm`). A failed read propagates, so the host area's error page shows.
 */
export async function loadHostBookings(
  term: string,
): Promise<HostBookingListResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const hostId = readableHostId(access);
  const data =
    hostId === null ? null : await readHostBookings(caller, hostId, term);
  return hostBookingListResult(access, data, term);
}

/**
 * The guest list of one session, for the host the caller owns or is staff of. A session id that is no id, is
 * missing, or is another host's is refused the same way, so an address never says which exist.
 */
export async function loadHostGuestList(
  rawSessionId: string,
): Promise<HostGuestListResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const sessionId = parseSessionId(rawSessionId);
  const hostId = readableHostId(access);
  const data =
    hostId !== null && sessionId !== null
      ? await readHostGuestList(caller, hostId, sessionId)
      : null;
  return hostGuestListResult(access, data);
}
