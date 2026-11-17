import 'server-only';
import { and, eq, inArray, sql, type SQL } from 'drizzle-orm';
import type { SelectedFields } from 'drizzle-orm/pg-core';
import { hostDashboardBookingStatuses } from '@/lib/hostDashboard';
import { db } from './client';
import { experiences, orderItems, orders, sessions } from './schema';

// What a list of bookings reads of each one, for the host's list and the guest's account alike.
// The caller adds its own columns, joins, and where clause, and checks its own authorization first.

/** The bookings that were paid for, and the ones since cancelled: never one still being paid for, a void one, or a gift purchase. */
export const liveBookings: SQL | undefined = and(
  eq(orders.kind, 'booking'),
  inArray(orders.status, [...hostDashboardBookingStatuses]),
);

/** The seats a booking holds: its items that use space, summed. */
export const seatsOf = sql<number>`coalesce((
  select sum(${orderItems.quantity})::int from ${orderItems}
  where ${orderItems.orderId} = ${orders.id} and ${orderItems.usesSpace}
), 0)`;

export function selectBookings<Extra extends SelectedFields>(extra: Extra) {
  return db
    .select({
      id: orders.id,
      reference: orders.reference,
      experienceName: experiences.name,
      sessionStartsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      status: orders.status,
      ...extra,
    })
    .from(orders)
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .innerJoin(experiences, eq(experiences.id, orders.experienceId));
}
