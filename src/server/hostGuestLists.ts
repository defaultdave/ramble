import 'server-only';
import { hostAccessFor } from '@/lib/hostAccess';
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
 * The bookings of the host the request's caller owns, narrowed by `term` (already read with
 * `parseSearchTerm`). A failed read propagates, so the host area's error page shows.
 */
export async function loadHostBookings(
  term: string,
): Promise<HostBookingListResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const data =
    access.kind === 'owner'
      ? await readHostBookings(caller, access.hostId, term)
      : null;
  return hostBookingListResult(access, data, term);
}

/**
 * The guest list of one session, for the host the caller owns. A session id that is no id, is
 * missing, or is another host's is refused the same way, so an address never says which exist.
 */
export async function loadHostGuestList(
  rawSessionId: string,
): Promise<HostGuestListResult> {
  const caller = await getCaller();
  const access = hostAccessFor(caller);
  const sessionId = parseSessionId(rawSessionId);
  const data =
    access.kind === 'owner' && sessionId !== null
      ? await readHostGuestList(caller, access.hostId, sessionId)
      : null;
  return hostGuestListResult(access, data);
}
