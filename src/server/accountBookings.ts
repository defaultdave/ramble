import 'server-only';
import {
  buildAccountBookings,
  type AccountBookingsResult,
} from '@/lib/accountBookings';
import { getCaller } from '@/server/auth/caller';
import { readAccountBookings } from '@/server/db/accountBookings';
import { systemClock } from '@/server/ports/clock';
import { capabilityToken } from '@/server/tokens';

/**
 * The page for the request's caller: nobody signed in is told to sign in. A failed read
 * propagates, so the area's error page shows. The manage token is rebuilt at each order's current
 * version, as the confirmation page does, so the link is the one a booking email carries.
 */
export async function loadAccountBookings(): Promise<AccountBookingsResult> {
  const caller = await getCaller();
  if (caller.userId === null) return { status: 'signed_out' };
  const now = systemClock.now();
  const rows = await readAccountBookings(caller, now);
  const view = buildAccountBookings(
    rows.map(({ manageTokenVersion, ...row }) => ({
      ...row,
      manageToken: capabilityToken('manage', row.id, manageTokenVersion),
    })),
    now,
  );
  return { status: 'ok', view };
}
