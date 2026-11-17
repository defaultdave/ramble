import 'server-only';
import { and, count, desc, eq, gte, lt } from 'drizzle-orm';
import { auditViewRow, type AuditViewRow } from '@/lib/staffAdmin';
import { venueTimeZone } from '@/lib/venue';
import { zonedDayWindow } from '@/lib/zonedDay';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { dbRead } from './client';
import { refundFailedCondition } from './opsBookings';
import {
  auditLog,
  experiences,
  orders,
  sessions,
  supportRequests,
} from './schema';
import { supportStatusCondition } from './supportQueue';
import { currentDatabaseTime } from './time';

// The numbers on the ops landing, for the ops role alone. Each function checks it before it reads.
// None records an audit row of its own: the landing records that ops opened it (`recordOpsAccess`),
// and a count names no guest, host or booking. The queues behind the counts record their own reads.

/** How many experiences wait in the review queue. */
export async function countExperiencesInReview(
  caller: Caller,
): Promise<number> {
  requireRole(caller, Role.Ops, {});
  const [row] = await dbRead
    .select({ total: count() })
    .from(experiences)
    .where(eq(experiences.status, 'in_review'));
  return row?.total ?? 0;
}

/** How many bookings have a refund that failed: the ones the bookings list shows under its refund-failed filter. */
export async function countRefundFailedBookings(
  caller: Caller,
): Promise<number> {
  requireRole(caller, Role.Ops, {});
  const [row] = await dbRead
    .select({ total: count() })
    .from(orders)
    .where(and(eq(orders.kind, 'booking'), refundFailedCondition));
  return row?.total ?? 0;
}

/** How many support requests are not yet resolved. */
export async function countOpenSupportRequests(
  caller: Caller,
): Promise<number> {
  requireRole(caller, Role.Ops, {});
  const [row] = await dbRead
    .select({ total: count() })
    .from(supportRequests)
    .where(supportStatusCondition.open);
  return row?.total ?? 0;
}

/** How many scheduled sessions start on today's calendar date in the site's time zone, by the database's clock. */
export async function countSessionsToday(caller: Caller): Promise<number> {
  requireRole(caller, Role.Ops, {});
  const today = zonedDayWindow(await currentDatabaseTime(), venueTimeZone);
  const [row] = await dbRead
    .select({ total: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.status, 'scheduled'),
        gte(sessions.startsAt, today.from),
        lt(sessions.startsAt, today.to),
      ),
    );
  return row?.total ?? 0;
}

/** The newest `limit` audit rows, newest first, as the audit view shows them. */
export async function readRecentAuditForOps(
  caller: Caller,
  limit: number,
): Promise<AuditViewRow[]> {
  requireRole(caller, Role.Ops, {});
  const rows = await dbRead
    .select()
    .from(auditLog)
    .orderBy(desc(auditLog.id))
    .limit(limit);
  return rows.map(auditViewRow);
}
