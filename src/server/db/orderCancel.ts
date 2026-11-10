import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { bookingEmailKey } from '@/lib/bookingEmails';
import {
  cancelRefundKey,
  cancelRefundReason,
  cancelVerdict,
  cancellationAuditEntry,
  giftReinstated,
  refundEtaLine,
  refundRequestOutcome,
  refusalResult,
  type CancelBookingResult,
} from '@/lib/cancelBooking';
import { requireOrderTransition } from '@/lib/providerEvents';
import { refundsReconcile } from '@/lib/refunds';
import { revalidateTagsForChanges } from '@/server/cache/invalidate';
import { enqueue } from '@/server/jobs/enqueue';
import { db, type Transaction } from './client';
import { writeAudit } from './audit';
import { lockHoldRow, lockOrderById, lockSessionRow } from './locks';
import { readCancelFacts } from './ordersCancelFacts';
import { orders, refunds, sessions } from './schema';
import { requestRefund } from './refunds';
import { readDatabaseTime } from './time';

// Cancelling a booking by its manage link (design doc 5.4). Every decision (the refund the tier
// gives, whether it is what the guest saw, what a refusal answers) is a function in
// `src/lib/cancelBooking.ts`; this file locks, reads, writes, and acts on what those say.

/** The most refund rows one order is read with: more than an order can have, and one more to see a breach. */
const reconcileReadLimit = 101;

/** The ids the locks are taken from, read without a lock: the order's session and hold. */
async function readLockIds(
  orderId: string,
): Promise<{ sessionId: string; holdId: string } | null> {
  const [row] = await db
    .select({ sessionId: orders.sessionId, holdId: orders.holdId })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!row || row.sessionId === null || row.holdId === null) return null;
  return { sessionId: row.sessionId, holdId: row.holdId };
}

/** The standing refunds reconcile with the order's totals (design doc 4.2.3), or the cancellation rolls back. */
async function requireRefundsReconcile(
  tx: Transaction,
  orderId: string,
): Promise<void> {
  const [order] = await tx
    .select({
      totalMinor: orders.totalMinor,
      refundedTicketMinor: orders.refundedTicketMinor,
      refundedTaxMinor: orders.refundedTaxMinor,
      commissionReturnedMinor: orders.commissionReturnedMinor,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  const lines = await tx
    .select({
      status: refunds.status,
      ticketMinor: refunds.ticketMinor,
      taxMinor: refunds.taxMinor,
      commissionReturnedMinor: refunds.commissionReturnedMinor,
    })
    .from(refunds)
    .where(eq(refunds.orderId, orderId))
    .orderBy(asc(refunds.createdAt))
    .limit(reconcileReadLimit);
  if (
    !order ||
    lines.length === reconcileReadLimit ||
    !refundsReconcile(order, lines)
  ) {
    throw new Error(
      'The order refunds do not reconcile after the cancellation',
    );
  }
}

type Cancelled = { result: CancelBookingResult; spacesOf: string | null };

async function cancelInTransaction(
  tx: Transaction,
  input: {
    orderId: string;
    sessionId: string;
    holdId: string;
    openedTokenVersion: number;
    expectedRefundMinor: number;
  },
): Promise<Cancelled> {
  // Lock order: session, hold, order (db/locks.ts); `requestRefund` takes the order's lock again.
  await lockSessionRow(tx, input.sessionId);
  await lockHoldRow(tx, input.holdId);
  await lockOrderById(tx, input.orderId);
  const found = await readCancelFacts(tx, input.orderId);
  if (found === null)
    return { result: { status: 'not_found' }, spacesOf: null };
  const { facts, sessionId } = found;
  const at = await readDatabaseTime(tx);
  const verdict = cancelVerdict({
    facts,
    openedTokenVersion: input.openedTokenVersion,
    expectedRefundMinor: input.expectedRefundMinor,
    now: at,
  });
  if (verdict.kind !== 'proceed') {
    return {
      result: refusalResult(verdict, facts.freeCancelUntil),
      spacesOf: null,
    };
  }

  let refundId: string | null = null;
  if (verdict.refundMinor > 0) {
    const outcome = refundRequestOutcome(
      await requestRefund(tx, {
        orderId: input.orderId,
        reason: cancelRefundReason,
        key: cancelRefundKey,
        ticketMinor: 'remaining',
      }),
      verdict.refundMinor,
    );
    if (outcome.kind === 'refused') {
      return {
        result: { status: 'refund_unavailable', reason: outcome.reason },
        spacesOf: null,
      };
    }
    refundId = outcome.refundId;
  }

  requireOrderTransition(facts.status, 'cancelled');
  await tx
    .update(orders)
    .set({
      status: 'cancelled',
      cancelledBy: 'guest',
      // Not `at`: that is whole milliseconds, which can read earlier than the order's microsecond `confirmed_at`.
      cancelledAt: sql`clock_timestamp()`,
    })
    .where(eq(orders.id, input.orderId));
  await tx
    .update(sessions)
    .set({ seatsSold: sql`${sessions.seatsSold} - ${facts.seats}` })
    .where(eq(sessions.id, sessionId));
  await requireRefundsReconcile(tx, input.orderId);

  const reinstated = giftReinstated();
  await writeAudit(
    tx,
    cancellationAuditEntry({
      orderId: input.orderId,
      sessionId,
      refundMinor: verdict.refundMinor,
      refundId,
      seatsReturned: facts.seats,
      giftReinstated: reinstated,
    }),
  );
  await enqueue(tx, {
    kind: 'guest-cancellation',
    payload: {
      orderId: input.orderId,
      cancelledBy: 'guest',
      refundMinor: verdict.refundMinor,
    },
    dedupeKey: bookingEmailKey('guest-cancellation', input.orderId),
  });
  await enqueue(tx, {
    kind: 'host-cancellation-notice',
    payload: { orderId: input.orderId, cancelledBy: 'guest' },
    dedupeKey: bookingEmailKey('host-cancellation-notice', input.orderId),
  });
  return {
    result: {
      status: 'cancelled',
      refundMinor: verdict.refundMinor,
      giftReinstated: reinstated,
      refundEta: refundEtaLine(verdict.refundMinor),
    },
    spacesOf: sessionId,
  };
}

/**
 * Cancels the booking a manage token opened, as the system: the token is the guest's right and the
 * caller has already checked it. The order is judged again under the session, hold, and order
 * locks, so a cancellation that lost a race to another one answers `already_cancelled` and writes
 * nothing. A refusal writes nothing at all. The refund request, the order, the spaces, the audit
 * row, and the email jobs commit together or not at all.
 */
export async function cancelBookingOrder(input: {
  orderId: string;
  openedTokenVersion: number;
  expectedRefundMinor: number;
}): Promise<CancelBookingResult> {
  const ids = await readLockIds(input.orderId);
  if (ids === null) return { status: 'not_found' };
  const { result, spacesOf } = await db.transaction((tx) =>
    cancelInTransaction(tx, { ...input, ...ids }),
  );
  if (spacesOf !== null) {
    revalidateTagsForChanges([{ kind: 'spaces', sessionId: spacesOf }]);
  }
  return result;
}
