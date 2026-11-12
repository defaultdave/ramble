import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import {
  AccountBookingRowSchema,
  accountBookingLimit,
  type AccountBookingData,
} from '@/lib/accountBookings';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { liveBookings, selectBookings } from './bookingRows';
import { authUsers, guests, orders, sessions } from './schema';

/**
 * The bookings of the guest who holds the caller's verified email, latest session first. A guest
 * row is a booking's email and an auth user is a sign-in's, so the two meet on the address, and
 * only once the sign-in has proved the person controls it. Nobody signed in is refused before any
 * read, and no argument can name another person's bookings.
 */
export async function readAccountBookings(
  caller: Caller,
): Promise<readonly AccountBookingData[]> {
  const userId = caller.userId ?? '';
  requireRole(caller, Role.Guest, { ownerId: userId });

  const rows = await selectBookings({
    manageTokenVersion: orders.manageTokenVersion,
  })
    .innerJoin(guests, eq(guests.id, orders.guestId))
    .innerJoin(authUsers, eq(authUsers.email, guests.email))
    .where(
      and(
        eq(authUsers.id, userId),
        eq(authUsers.emailVerified, true),
        liveBookings,
      ),
    )
    .orderBy(desc(sessions.startsAt), desc(orders.id))
    .limit(accountBookingLimit);
  return AccountBookingRowSchema.array().parse(rows);
}
