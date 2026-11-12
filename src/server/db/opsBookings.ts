import 'server-only';
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import type { CancelBookingResult } from '@/lib/cancelBooking';
import { WriteIdSchema } from '@/lib/catalog';
import { splitPage } from '@/lib/pagination';
import {
  bookingsListEntry,
  bookingViewedEntry,
  buildOpsBookingDetail,
  buildOpsBookingRows,
  linksVoidedEntry,
  opsBookingsPageSize,
  opsHistoryActions,
  opsRefundDecision,
  opsRefundRequest,
  refundRequestedEntry,
  type BookingFilter,
  type BookingSearch,
  type OpsBookingDetail,
  type OpsBookingRow,
} from '@/lib/opsBookings';
import type { Caller } from '@/server/auth/caller';
import {
  bumpTokenVersion,
  capabilityToken,
  resolveManageToken,
} from '@/server/tokens';
import { readBookingEmailOrder } from './bookingEmails';
import { cancelBookingOrder } from './orderCancel';
import { recordAudit, requireOpsUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { lockOrderById } from './locks';
import { readCancelFacts } from './ordersCancelFacts';
import { requestRefund } from './refunds';
import {
  auditLog,
  experiences,
  guests,
  orders,
  refunds,
  sessions,
} from './schema';
import { readDatabaseTime } from './time';

// For the ops role alone: each function checks it before it reads or writes, and each read records
// its audit row before it returns anything. Money moves only through `requestRefund` and the guest
// cancel; nothing here decides an amount. A failed retry of a refund is in `./orderRefundRetry`.

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

/** One booking with its refunds and what ops did to it, read in one snapshot with the audit row for the read. Null when there is no such booking. */
export async function readOpsBooking(
  caller: Caller,
  orderId: string,
): Promise<OpsBookingDetail | null> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  return db.transaction(async (tx) => {
    const now = await readDatabaseTime(tx);
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
    const found = await readCancelFacts(tx, id);
    if (!booking || !found) return null;
    await writeAudit(tx, bookingViewedEntry(userId, id));
    const email = await readBookingEmailOrder(tx, id);
    return buildOpsBookingDetail({
      booking,
      facts: found.facts,
      emailSource: email?.source ?? null,
      now,
      history: await tx
        .select({ action: auditLog.action, recordedAt: auditLog.recordedAt })
        .from(auditLog)
        .where(
          and(
            eq(auditLog.subjectKind, 'order'),
            eq(auditLog.subjectId, id),
            inArray(auditLog.action, opsHistoryActions),
          ),
        )
        .orderBy(desc(auditLog.recordedAt), desc(auditLog.id))
        .limit(refundsShownLimit),
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

/**
 * Cancels the booking through the guest's own cancel: the manage token is rebuilt from the order
 * (the server can, as for the confirmation email) and opened the way a guest's link is, so the
 * order, the spaces, the refund the tier gives, and the emails are the guest cancel's. Ops acts as
 * the cancel's actor, so the order records Ramble as the canceller and the cancellation and both audit
 * rows (`order.cancelled` and `booking.ops_cancel_requested`, each naming the ops user) commit in
 * its one transaction. `expectedRefundMinor` is the refund ops was shown.
 */
export async function cancelBookingAsOps(
  caller: Caller,
  input: { orderId: string; expectedRefundMinor: number },
): Promise<CancelBookingResult> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(input.orderId);
  const [order] = await db
    .select({ version: orders.manageTokenVersion })
    .from(orders)
    .where(eq(orders.id, id));
  const token = order
    ? await resolveManageToken(capabilityToken('manage', id, order.version))
    : null;
  if (token === null) return { status: 'not_found' };
  return cancelBookingOrder({
    token,
    expectedRefundMinor: input.expectedRefundMinor,
    actor: { kind: 'ops', userId },
  });
}

type OpsRefundOutcome =
  'requested' | 'already_requested' | 'refused' | 'not_found';

/** Refunds the whole rest of a cancelled booking's order, once: the refund, the order's totals, the ledger postings, the job, and the audit row commit together. */
export async function refundBookingAsOps(
  caller: Caller,
  orderId: string,
): Promise<OpsRefundOutcome> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  return db.transaction(async (tx) => {
    const locked = await lockOrderById(tx, id);
    if (!locked) return 'not_found';
    const [order] = await tx
      .select({
        kind: orders.kind,
        status: orders.status,
        refundFailed: orders.refundFailed,
      })
      .from(orders)
      .where(eq(orders.id, id));
    if (!order || opsRefundDecision(order) === 'refused') return 'refused';
    const result = await requestRefund(tx, opsRefundRequest(id, userId));
    if (result.status === 'requested') {
      await writeAudit(
        tx,
        refundRequestedEntry(userId, id, result.refund.refundId),
      );
    }
    return result.status;
  });
}

/** Voids the booking's earlier manage and confirmation links by raising its token version, with the audit row in the same transaction. Null when there is no such booking. */
export async function voidBookingLinks(
  caller: Caller,
  orderId: string,
): Promise<{ version: number } | null> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(orderId);
  return db.transaction(async (tx) => {
    if (!(await readCancelFacts(tx, id))) return null;
    const bumped = await bumpTokenVersion(tx, 'manage', id);
    if (bumped !== null) {
      await writeAudit(tx, linksVoidedEntry(userId, id, bumped.version));
    }
    return bumped;
  });
}
