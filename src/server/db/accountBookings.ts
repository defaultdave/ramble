import 'server-only';
import { and, desc, eq, inArray } from 'drizzle-orm';
import {
  AccountBookingRowSchema,
  accountBookingLimit,
  type AccountBookingData,
} from '@/lib/accountBookings';
import { hostDashboardBookingStatuses } from '@/lib/hostDashboard';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { db } from './client';
import { authUsers, experiences, guests, orders, sessions } from './schema';

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

  const rows = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      experienceName: experiences.name,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      status: orders.status,
      manageTokenVersion: orders.manageTokenVersion,
    })
    .from(authUsers)
    .innerJoin(guests, eq(guests.email, authUsers.email))
    .innerJoin(orders, eq(orders.guestId, guests.id))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .where(
      and(
        eq(authUsers.id, userId),
        eq(authUsers.emailVerified, true),
        eq(orders.kind, 'booking'),
        inArray(orders.status, [...hostDashboardBookingStatuses]),
      ),
    )
    .orderBy(desc(sessions.startsAt), desc(orders.id))
    .limit(accountBookingLimit);
  return AccountBookingRowSchema.array().parse(rows);
}
