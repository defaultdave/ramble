import 'server-only';
import { and, desc, eq, or, type SQL } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import { splitPage } from '@/lib/pagination';
import {
  bookingsListEntry,
  bookingViewedEntry,
  buildOpsBookingDetail,
  buildOpsBookingRows,
  opsBookingsPageSize,
  type BookingFilter,
  type BookingSearch,
  type OpsBookingDetail,
  type OpsBookingRow,
} from '@/lib/opsBookings';
import type { Caller } from '@/server/auth/caller';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { experiences, guests, orders, refunds, sessions } from './schema';

// For the ops role alone: each function checks it before it reads, and each read records its audit
// row before it returns anything.

const refundsShownLimit = 50;

export type OpsBookingsPage = {
  rows: OpsBookingRow[];
  nextCursor: string | null;
};

function searchCondition(search: BookingSearch): SQL | undefined {
  switch (search.kind) {
    case 'email':
      return or(
        eq(orders.contactEmail, search.email),
        eq(guests.email, search.email),
      );
    case 'reference':
      return eq(orders.reference, search.reference);
    case 'none':
    case 'invalid':
      return undefined;
  }
}

/**
 * One page of bookings, newest first: the one a reference names, or every booking of a guest by the
 * address they booked with or signed in with. A term that is neither finds nothing, and nothing is
 * read for it. Gift purchases have no session and are not listed.
 */
export async function readOpsBookings(
  caller: Caller,
  options: {
    search: BookingSearch;
    filter: BookingFilter | null;
    cursor: string | null;
  },
): Promise<OpsBookingsPage> {
  const userId = requireOpsUserId(caller);
  if (options.search.kind === 'invalid') {
    await recordAudit(bookingsListEntry(userId));
    return { rows: [], nextCursor: null };
  }
  const fetched = await dbRead
    .select({
      id: orders.id,
      reference: orders.reference,
      status: orders.status,
      refundFailed: orders.refundFailed,
      leadGuestName: orders.leadGuestName,
      contactEmail: orders.contactEmail,
      experienceName: experiences.name,
      sessionStartsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      totalMinor: orders.totalMinor,
    })
    .from(orders)
    .innerJoin(guests, eq(guests.id, orders.guestId))
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .where(
      and(
        eq(orders.kind, 'booking'),
        searchCondition(options.search),
        options.filter === 'refund_failed'
          ? eq(orders.refundFailed, true)
          : undefined,
        pastKeysetCursor(orders, orders.createdAt, 'desc', options.cursor),
      ),
    )
    .orderBy(...byColumnThenId(orders, orders.createdAt, 'desc'))
    .limit(opsBookingsPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, opsBookingsPageSize);
  await recordAudit(bookingsListEntry(userId));
  return { rows: buildOpsBookingRows(items), nextCursor };
}

/** One booking with its refunds, read in one snapshot with the audit row for the read. Null when there is no such booking. */
export async function readOpsBooking(
  caller: Caller,
  orderId: string,
): Promise<OpsBookingDetail | null> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  return db.transaction(async (tx) => {
    const [booking] = await tx
      .select({
        id: orders.id,
        reference: orders.reference,
        status: orders.status,
        refundFailed: orders.refundFailed,
        leadGuestName: orders.leadGuestName,
        contactEmail: orders.contactEmail,
        experienceName: experiences.name,
        sessionStartsAt: sessions.startsAt,
        timeZone: sessions.timeZone,
        totalMinor: orders.totalMinor,
        cancelledBy: orders.cancelledBy,
        createdAt: orders.createdAt,
        confirmedAt: orders.confirmedAt,
        cancelledAt: orders.cancelledAt,
        refundedTicketMinor: orders.refundedTicketMinor,
        refundedTaxMinor: orders.refundedTaxMinor,
      })
      .from(orders)
      .innerJoin(experiences, eq(experiences.id, orders.experienceId))
      .innerJoin(sessions, eq(sessions.id, orders.sessionId))
      .where(and(eq(orders.id, id), eq(orders.kind, 'booking')));
    if (!booking) return null;
    await writeAudit(tx, bookingViewedEntry(userId, id));
    return buildOpsBookingDetail({
      booking,
      refunds: await tx
        .select({
          id: refunds.id,
          amountMinor: refunds.amountMinor,
          reason: refunds.reason,
          status: refunds.status,
          createdAt: refunds.createdAt,
        })
        .from(refunds)
        .where(eq(refunds.orderId, id))
        .orderBy(desc(refunds.createdAt), desc(refunds.id))
        .limit(refundsShownLimit),
    });
  });
}
