import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, desc, eq, inArray, or, type SQL } from 'drizzle-orm';
import { confirmationDecision, resendEmailKey } from '@/lib/bookingEmails';
import type { CancelBookingResult } from '@/lib/cancelBooking';
import { WriteIdSchema } from '@/lib/catalog';
import { splitPage } from '@/lib/pagination';
import { opsListPageSize } from '@/lib/tableQuery';
import {
  bookingsListEntry,
  bookingViewedEntry,
  buildOpsBookingDetail,
  buildOpsBookingRow,
  linksVoidedEntry,
  opsHistoryActions,
  confirmationResentEntry,
  ExpectedRefundInputSchema,
  opsRefundVerdict,
  resendJobKind,
  type BookingFilter,
  type BookingSearch,
  type OpsBookingDetail,
  type OpsBookingRow,
} from '@/lib/opsBookings';
import { opsFullRefundRequest, refundAuditEntry } from '@/lib/refundRetry';
import type { Caller } from '@/server/auth/caller';
import {
  BookingEmailError,
  guestConfirmationRequest,
} from '@/server/jobs/bookingEmails';
import { enqueue } from '@/server/jobs/enqueue';
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
import { requestAuditedRefund } from './refunds';
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
const historyShownLimit = 50;

export type OpsBookingsPage = {
  rows: OpsBookingRow[];
  nextCursor: string | null;
};

const bookingFields = {
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
};

/** A booking with its experience and session: the one source of every booking read. */
function selectBookings(reader: Pick<typeof db, 'select'>) {
  return reader
    .select(bookingFields)
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId));
}

function searchCondition(search: BookingSearch): SQL | undefined {
  switch (search.kind) {
    case 'email':
      return or(
        eq(orders.contactEmail, search.email),
        inArray(
          orders.guestId,
          dbRead
            .select({ id: guests.id })
            .from(guests)
            .where(eq(guests.email, search.email)),
        ),
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
  const cursor =
    options.cursor === null ? null : WriteIdSchema.parse(options.cursor);
  if (options.search.kind === 'invalid') {
    await recordAudit(bookingsListEntry(userId));
    return { rows: [], nextCursor: null };
  }
  const fetched = await selectBookings(dbRead)
    .where(
      and(
        eq(orders.kind, 'booking'),
        searchCondition(options.search),
        options.filter === 'refund_failed'
          ? eq(orders.refundFailed, true)
          : undefined,
        pastKeysetCursor(orders, orders.createdAt, 'desc', cursor),
      ),
    )
    .orderBy(...byColumnThenId(orders, orders.createdAt, 'desc'))
    .limit(opsListPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, opsListPageSize);
  await recordAudit(bookingsListEntry(userId));
  return { rows: items.map(buildOpsBookingRow), nextCursor };
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
    const [booking] = await selectBookings(tx).where(
      and(eq(orders.id, id), eq(orders.kind, 'booking')),
    );
    const found = await readCancelFacts(tx, id);
    if (!booking || !found) return null;
    await writeAudit(tx, bookingViewedEntry(userId, id));
    const email = await readBookingEmailOrder(tx, id);
    return buildOpsBookingDetail({
      booking,
      facts: found.facts,
      emailSource: email?.source ?? null,
      resendId: randomUUID(),
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
        .limit(historyShownLimit),
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
): Promise<CancelBookingResult | { status: 'try_again' }> {
  const userId = requireOpsUserId(caller);
  const { orderId: id, expectedRefundMinor } =
    ExpectedRefundInputSchema.parse(input);
  const [order] = await db
    .select({ version: orders.manageTokenVersion })
    .from(orders)
    .where(eq(orders.id, id));
  if (!order) return { status: 'not_found' };
  const token = await resolveManageToken(
    capabilityToken('manage', id, order.version),
  );
  if (token === null) return { status: 'try_again' };
  return cancelBookingOrder({
    token,
    expectedRefundMinor,
    actor: { kind: 'ops', userId },
  });
}

type OpsRefundOutcome =
  'requested' | 'already_requested' | 'refused' | 'terms_changed' | 'not_found';

/** Refunds the whole rest of a cancelled booking's order, once, if it is the amount ops was shown: the refund, the order's totals, the ledger postings, the job, and the audit row commit together. */
export async function refundBookingAsOps(
  caller: Caller,
  input: { orderId: string; expectedRefundMinor: number },
): Promise<OpsRefundOutcome> {
  const userId = requireOpsUserId(caller);
  const { orderId: id, expectedRefundMinor } =
    ExpectedRefundInputSchema.parse(input);
  return db.transaction(async (tx) => {
    if (!(await lockOrderById(tx, id))) return 'not_found';
    const [order] = await tx
      .select({
        kind: orders.kind,
        status: orders.status,
        refundFailed: orders.refundFailed,
      })
      .from(orders)
      .where(eq(orders.id, id));
    const found = await readCancelFacts(tx, id);
    const verdict =
      order && found
        ? opsRefundVerdict(order, found.facts, expectedRefundMinor)
        : 'refused';
    if (verdict !== 'go') return verdict;
    const result = await requestAuditedRefund(
      tx,
      opsFullRefundRequest(id, userId),
      (refundId) =>
        refundAuditEntry('booking.ops_refund_requested', userId, id, refundId),
    );
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

type ResendOutcome = 'queued' | 'not_found' | 'not_resendable';

/**
 * Queues the booking's confirmation again, with a manage link rebuilt at the order's current token
 * version and the `.ics`, for the address on the booking and no other: the address is read from the
 * order when the job runs, never from the request. The job and the audit row commit in one
 * transaction, so the audit log never records a resend that was not queued, and the resend's id keys
 * the job, so a form posted twice queues one email. A booking with no live manage link is not resendable.
 */
export async function resendBookingConfirmation(
  caller: Caller,
  input: { orderId: string; resendId: string },
): Promise<ResendOutcome> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.parse(input.orderId);
  const resendId = WriteIdSchema.parse(input.resendId);
  return db.transaction(async (tx) => {
    const order = await readBookingEmailOrder(tx, id);
    if (order === null) return 'not_found';
    if (confirmationDecision(order.source) !== 'send') return 'not_resendable';
    try {
      guestConfirmationRequest(order, resendEmailKey(resendId));
    } catch (error) {
      if (error instanceof BookingEmailError) return 'not_resendable';
      throw error;
    }
    const queued = await enqueue(tx, {
      kind: resendJobKind,
      payload: { orderId: id, resendId },
      dedupeKey: resendEmailKey(resendId),
    });
    if (queued !== null) {
      await writeAudit(tx, confirmationResentEntry(userId, id, resendId));
    }
    return 'queued';
  });
}
