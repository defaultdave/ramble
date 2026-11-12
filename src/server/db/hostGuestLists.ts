import 'server-only';
import { and, desc, eq, ilike, or, sql } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import {
  HostBookingListRowSchema,
  HostBookingSearchSchema,
  HostGuestListBookingSchema,
  HostGuestListSessionSchema,
  hostBookingListLimit,
  type HostBookingListData,
  type HostGuestListData,
} from '@/lib/hostGuestLists';
import { containsPattern } from '@/lib/pages/help';
import { Role, requireRole, type Caller } from '@/server/auth/caller';
import { liveBookings, selectBookings } from './bookingRows';
import { db } from './client';
import { experiences, hosts, orderItems, orders, sessions } from './schema';

// Guest personal data (names, emails, phones, children's ages, guardians) leaves here only for the
// host that owns the booking (PRD-73). The caller is checked against `hostId` before anything is
// read, and every query is cut to that host.

const seatsOf = sql<number>`coalesce((
  select sum(${orderItems.quantity})::int from ${orderItems}
  where ${orderItems.orderId} = ${orders.id} and ${orderItems.usesSpace}
), 0)`;

/**
 * A host owner's bookings, latest first, confirmed and cancelled, optionally those whose reference
 * or lead guest's name contains `term` (any case, the term matched literally). The owner of another
 * host, host staff, a guest, ops, admin, and nobody signed in are refused.
 */
export async function readHostBookings(
  caller: Caller,
  hostId: string,
  term: string,
): Promise<HostBookingListData> {
  const id = EntityIdSchema.parse(hostId);
  const search = HostBookingSearchSchema.parse(term);
  requireRole(caller, Role.HostOwner, { hostId: id });

  const pattern = containsPattern(search);
  const rows = await selectBookings({
    leadGuestName: orders.leadGuestName,
    sessionId: orders.sessionId,
    seats: seatsOf,
  })
    .where(
      and(
        eq(orders.hostId, id),
        liveBookings,
        search === ''
          ? undefined
          : or(
              ilike(orders.reference, pattern),
              ilike(orders.leadGuestName, pattern),
            ),
      ),
    )
    .orderBy(desc(orders.createdAt), desc(orders.id))
    .limit(hostBookingListLimit);
  return { bookings: HostBookingListRowSchema.array().parse(rows) };
}

/**
 * The guest list of one session of the host: its confirmed bookings, by lead guest's name. Null
 * when the session is missing or belongs to another host, so the two read alike. A cancelled
 * booking is not a guest on the day and is left out. Refused to everyone but the host's owner.
 */
export async function readHostGuestList(
  caller: Caller,
  hostId: string,
  sessionId: string,
): Promise<HostGuestListData | null> {
  const id = EntityIdSchema.parse(hostId);
  const sid = EntityIdSchema.parse(sessionId);
  requireRole(caller, Role.HostOwner, { hostId: id });

  const [session] = await db
    .select({
      hostName: hosts.name,
      id: sessions.id,
      experienceName: experiences.name,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      waiverRequired: sql<boolean>`${experiences.waiverDocumentId} is not null`,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(and(eq(sessions.id, sid), eq(experiences.hostId, id)));
  if (!session) return null;

  const bookings = await db
    .select({
      id: orders.id,
      reference: orders.reference,
      leadGuestName: orders.leadGuestName,
      seats: seatsOf,
      ageConfirmed: orders.ageConfirmed,
      childrenAges: orders.childrenAges,
      guardianName: orders.guardianName,
      guardianContact: orders.guardianContact,
      waiverAccepted: sql<boolean>`${orders.waiverDocumentId} is not null`,
      contactEmail: orders.contactEmail,
      contactPhone: orders.contactPhone,
    })
    .from(orders)
    .where(
      and(
        eq(orders.sessionId, sid),
        eq(orders.hostId, id),
        eq(orders.kind, 'booking'),
        eq(orders.status, 'confirmed'),
      ),
    )
    .orderBy(orders.leadGuestName, orders.id);

  return {
    session: HostGuestListSessionSchema.parse(session),
    bookings: HostGuestListBookingSchema.array().parse(bookings),
  };
}
