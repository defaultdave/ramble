import 'server-only';
import { and, asc, desc, eq, sql } from 'drizzle-orm';
import {
  AccountBookingRowSchema,
  accountBookingLimit,
  type AccountBookingData,
} from '@/lib/accountBookings';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { liveBookings, selectBookings } from './bookingRows';
import { authUsers, guests, orders, sessions } from './schema';

/**
 * The bookings of the guest who holds the caller's verified email: upcoming ones first, soonest
 * first, then the rest, latest first, so the cap at `accountBookingLimit` drops the oldest past
 * bookings and never an upcoming one. A guest
 * row is a booking's email and an auth user is a sign-in's, so the two meet on the address, and
 * only once the sign-in has proved the person controls it. Nobody signed in is refused before any
 * read, and no argument can name another person's bookings.
 */
export async function readAccountBookings(
  caller: Caller,
  now: Date,
): Promise<readonly AccountBookingData[]> {
  const userId = caller.userId ?? '';
  requireRole(caller, Role.Guest, { ownerId: userId });

  const isUpcoming = sql`(${orders.status} = 'confirmed' and ${sessions.startsAt} >= ${now})`;
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
    .orderBy(
      sql`case when ${isUpcoming} then 0 else 1 end`,
      asc(sql`case when ${isUpcoming} then ${sessions.startsAt} end`),
      desc(sessions.startsAt),
      desc(orders.id),
    )
    .limit(accountBookingLimit);
  return AccountBookingRowSchema.array().parse(rows);
}
