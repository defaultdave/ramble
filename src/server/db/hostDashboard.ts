import 'server-only';
import { and, asc, desc, eq, gte } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import {
  HostDashboardBookingSchema,
  HostDashboardSessionSchema,
  hostDashboardLimits,
  type HostDashboardData,
} from '@/lib/hostDashboard';
import {
  hostReaderRoles,
  requireAnyRole,
  type Caller,
} from '@/server/auth/caller';
import { liveBookings, seatsOf, selectBookings } from './bookingRows';
import { db } from './client';
import { experiences, hosts, orders, sessions } from './schema';

/**
 * What a host's dashboard shows, for the host an owner or staff member acts for: their next scheduled sessions with
 * seats sold, and their latest bookings. The caller is checked against `hostId` before anything is
 * read, so the owner or staff of another host, a guest, and nobody signed in are all refused,
 * and every query below is cut to that host. Null when no such host exists.
 */
export async function readHostDashboard(
  caller: Caller,
  hostId: string,
  now: Date,
): Promise<HostDashboardData | null> {
  const id = EntityIdSchema.parse(hostId);
  requireAnyRole(caller, hostReaderRoles, { hostId: id });

  const [[host], upcoming, recent] = await Promise.all([
    db.select({ name: hosts.name }).from(hosts).where(eq(hosts.id, id)),
    db
      .select({
        id: sessions.id,
        experienceName: experiences.name,
        startsAt: sessions.startsAt,
        timeZone: sessions.timeZone,
        allocation: sessions.allocation,
        seatsSold: sessions.seatsSold,
      })
      .from(sessions)
      .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
      .where(
        and(
          eq(experiences.hostId, id),
          eq(sessions.status, 'scheduled'),
          gte(sessions.startsAt, now),
        ),
      )
      .orderBy(asc(sessions.startsAt), asc(sessions.id))
      .limit(hostDashboardLimits.sessions),
    selectBookings({
      leadGuestName: orders.leadGuestName,
      seats: seatsOf,
      totalMinor: orders.totalMinor,
    })
      .where(and(eq(orders.hostId, id), liveBookings))
      .orderBy(desc(orders.createdAt), desc(orders.id))
      .limit(hostDashboardLimits.bookings),
  ]);
  if (!host) return null;

  return {
    hostName: host.name,
    sessions: HostDashboardSessionSchema.array().parse(upcoming),
    bookings: HostDashboardBookingSchema.array().parse(recent),
  };
}
