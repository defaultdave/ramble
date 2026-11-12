import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { bookingEmailKey } from '@/lib/bookingEmails';
import {
  CancelOrderInputSchema,
  cancelPlan,
  cancelRefundKey,
  cancelRefundReason,
  cancellationAuditEntry,
  cancelledByFor,
  guestCancelActor,
  opsCancelRequestedEntry,
  giftReinstated,
  cancelCacheChanges,
  cancelStart,
  reconcileReadLimit,
  refundEtaLine,
  refundRequestOutcome,
  refundsReconcileWithin,
  type CancelActor,
  type CancelBookingResult,
  type CancelOrderInput,
} from '@/lib/cancelBooking';
import type { CapabilityTokenKind } from '@/lib/capabilityTokens';
import { locksCoverOrder, type LockedAttempt } from '@/lib/orderLocks';
import { requireOrderTransition } from '@/lib/providerEvents';
import { revalidateTagsForChanges } from '@/server/cache/invalidate';
import { enqueue } from '@/server/jobs/enqueue';
import { untilLocksCoverOrder } from './lockRetry';
import { db, type Transaction } from './client';
import { writeAudit } from './audit';
import {
  lockHoldRow,
  lockOrderById,
  lockSessionRow,
  readOrderLockIds,
} from './locks';
import type { ResolvedManageToken } from './orderTokens';
import { readCancelFacts } from './ordersCancelFacts';
import { orders, refunds, sessions } from './schema';
import { requestRefund } from './refunds';
import { readDatabaseTime } from './time';

// Cancelling a booking by its manage link (design doc 5.4). Every decision (the refund the tier
// gives, whether it is what the guest saw, what a refusal answers, whether the refunds reconcile)
// is a function in `src/lib/cancelBooking.ts`; this file locks, reads, writes, and executes what
// those say.

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
  if (!order || !refundsReconcileWithin(order, lines, reconcileReadLimit)) {
    throw new Error(
      'The order refunds do not reconcile after the cancellation',
    );
  }
}

type Cancelled = { result: CancelBookingResult; sessionId: string | null };

async function cancelInTransaction(
  tx: Transaction,
  input: CancelOrderInput & {
    tokenKind: CapabilityTokenKind;
    actor: CancelActor;
  },
): Promise<LockedAttempt<Cancelled>> {
  const start = cancelStart({
    tokenKind: input.tokenKind,
    ids: await readOrderLockIds(tx, input.orderId),
  });
  if (start.kind === 'stop') {
    return { kind: 'done', value: { result: start.result, sessionId: null } };
  }
  const { sessionId } = start;
  // Lock order: session, hold, order (db/locks.ts); `requestRefund` takes the order's lock again.
  await lockSessionRow(tx, sessionId);
  await lockHoldRow(tx, start.holdId);
  const locked = await lockOrderById(tx, input.orderId);
  // A move can change the order's session between the read and the lock; these locks are then the old session's.
  if (!locksCoverOrder({ sessionId, holdId: start.holdId }, locked)) {
    return { kind: 'stale' };
  }
  const found = await readCancelFacts(tx, input.orderId);
  const plan = cancelPlan({
    facts: found?.facts ?? null,
    openedTokenVersion: input.openedTokenVersion,
    expectedRefundMinor: input.expectedRefundMinor,
    now: await readDatabaseTime(tx),
  });
  if (plan.kind === 'stop') {
    return { kind: 'done', value: { result: plan.result, sessionId: null } };
  }
  const { facts } = plan;

  let refundId: string | null = null;
  if (plan.requestsRefund) {
    const outcome = refundRequestOutcome(
      await requestRefund(tx, {
        orderId: input.orderId,
        reason: cancelRefundReason,
        key: cancelRefundKey,
        ticketMinor: 'remaining',
      }),
      plan.refundMinor,
    );
    if (outcome.kind === 'refused') {
      return {
        kind: 'done',
        value: { result: outcome.result, sessionId: null },
      };
    }
    refundId = outcome.refundId;
  }

  requireOrderTransition(facts.status, 'cancelled');
  await tx
    .update(orders)
    .set({
      status: 'cancelled',
      cancelledBy: cancelledByFor(input.actor),
      // Not the decision time: that is whole milliseconds, which can read earlier than the order's microsecond `confirmed_at`.
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
    cancellationAuditEntry(
      {
        orderId: input.orderId,
        sessionId,
        refundMinor: plan.refundMinor,
        refundId,
        seatsReturned: facts.seats,
        giftReinstated: reinstated,
      },
      input.actor,
    ),
  );
  if (input.actor.kind === 'ops') {
    await writeAudit(
      tx,
      opsCancelRequestedEntry(input.actor.userId, input.orderId),
    );
  }
  await enqueue(tx, {
    kind: 'guest-cancellation',
    payload: {
      orderId: input.orderId,
      cancelledBy: cancelledByFor(input.actor),
      refundMinor: plan.refundMinor,
    },
    dedupeKey: bookingEmailKey('guest-cancellation', input.orderId),
  });
  await enqueue(tx, {
    kind: 'host-cancellation-notice',
    payload: {
      orderId: input.orderId,
      cancelledBy: cancelledByFor(input.actor),
    },
    dedupeKey: bookingEmailKey('host-cancellation-notice', input.orderId),
  });
  return {
    kind: 'done',
    value: {
      result: {
        status: 'cancelled',
        refundMinor: plan.refundMinor,
        giftReinstated: reinstated,
        refundEta: refundEtaLine(plan.refundMinor),
      },
      sessionId,
    },
  };
}

/**
 * Cancels the booking a manage token opened, as the system: the token is the guest's right, and the
 * only way to hold one here is `resolveManageToken`, so the order and the version it was opened at
 * come from it and not from the caller. The order is judged again under the session, hold, and
 * order locks, so a cancellation that lost a race to another one answers `already_cancelled` and
 * writes nothing. A refusal writes nothing at all. The refund request, the order, the spaces, the
 * audit row, and the email jobs commit together or not at all.
 */
export async function cancelBookingOrder(input: {
  token: ResolvedManageToken;
  expectedRefundMinor: number;
  /** Who cancels; the guest unless ops acts for Ramble, in which case the order and its audit rows name ops. */
  actor?: CancelActor;
}): Promise<CancelBookingResult> {
  const parsed = CancelOrderInputSchema.parse({
    orderId: input.token.id,
    openedTokenVersion: input.token.version,
    expectedRefundMinor: input.expectedRefundMinor,
  });
  const { result, sessionId } = await untilLocksCoverOrder(() =>
    db.transaction((tx) =>
      cancelInTransaction(tx, {
        ...parsed,
        tokenKind: input.token.kind,
        actor: input.actor ?? guestCancelActor,
      }),
    ),
  );
  revalidateTagsForChanges(cancelCacheChanges(result, sessionId));
  return result;
}
