import 'server-only';
import { and, asc, eq, inArray, sql } from 'drizzle-orm';
import { bookingEmailKey } from '@/lib/bookingEmails';
import {
  CancelSessionInputSchema,
  cancelledStatus,
  cancelsAsStaff,
  fanOutHoldStatuses,
  fanOutLimit,
  fanOutOrderStatuses,
  orderCancelledAudit,
  orderFanOut,
  releasedHold,
  requireSessionRefund,
  requireWithinFanOut,
  sessionCancelCacheChanges,
  sessionCancelPlan,
  sessionCancelledAudit,
  sessionRefundKey,
  sessionRefundReason,
  voidedStatus,
  type CancelSessionInput,
  type CancelSessionResult,
  type SessionCancelReason,
} from '@/lib/cancelSession';
import {
  afterAttemptWrite,
  attemptCancelTarget,
  cancelAttemptKey,
  liveAttemptStatuses,
} from '@/lib/holdLapse';
import { requireAttemptTransition } from '@/lib/providerEvents';
import { revalidateTagsForChanges } from '@/server/cache/invalidate';
import {
  ForbiddenError,
  requireRole,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { enqueue } from '@/server/jobs/enqueue';
import type { PaymentsPort } from '@/server/ports/payments';
import { getPaymentsPort } from '@/server/ports/payments/gateway';
import { writeAudit } from './audit';
import { db, type Transaction } from './client';
import { lockOrderById, lockSessionRow } from './locks';
import { settleAtProvider } from './ordersLapse';
import { requestRefund } from './refunds';
import { holds, orders, paymentAttempts, sessions } from './schema';
import { readDatabaseTime } from './time';

// Cancelling a session (PRD-28, PRD-51). Every decision (what each order and hold does, the refund
// reason, who may cancel, where the email sends a guest) is a function in `src/lib/cancelSession.ts`;
// this file locks, reads, writes, and acts on what those say. It runs in two steps because the
// provider is never called inside a transaction (design doc 4.2.3, rule 6): the first commits the
// session, its holds, its orders, the refunds, and the email jobs together, and the second cancels
// the payments still in flight. A payment the provider cannot cancel, or one that lands after the
// first step, finds its order voided and a session that is not scheduled, so it takes the refund
// path (`db/refundPath.ts`).

type Walked =
  | {
      kind: 'stop';
      result: Exclude<CancelSessionResult, { attemptsLeft: number }>;
    }
  | {
      kind: 'walked';
      result: Extract<CancelSessionResult, { attemptsLeft: number }>;
      experienceId: string;
    };

type FanOutOrder = {
  id: string;
  status: (typeof orders.$inferSelect)['status'];
  seats: number;
};

/** Cancels the session's refunds' bookings and voids its unpaid orders, in the order's lock order: session, holds, orders. */
async function walkSession(
  tx: Transaction,
  caller: Caller,
  input: { sessionId: string; reason: SessionCancelReason },
): Promise<Walked> {
  const locked = await lockSessionRow(tx, input.sessionId);
  if (!locked) {
    if (!cancelsAsStaff(caller.roles)) throw new ForbiddenError(Role.HostOwner);
    return { kind: 'stop', result: { status: 'not_found' } };
  }
  if (!cancelsAsStaff(caller.roles)) {
    requireRole(caller, Role.HostOwner, { hostId: locked.hostId });
  }
  const plan = sessionCancelPlan(locked.session, input.reason);
  if (plan.kind === 'stop') return { kind: 'stop', result: plan.result };
  const { reason } = plan;
  const initiatedBy = caller.userId;
  const at = await readDatabaseTime(tx);

  const openHolds = requireWithinFanOut(
    await tx
      .select({ id: holds.id, status: holds.status })
      .from(holds)
      .where(
        and(
          eq(holds.sessionId, input.sessionId),
          inArray(holds.status, fanOutHoldStatuses),
        ),
      )
      .orderBy(asc(holds.id))
      .limit(fanOutLimit + 1)
      .for('update'),
    'open holds',
  );
  const fanOutOrders: readonly FanOutOrder[] = requireWithinFanOut(
    await tx
      .select({ id: orders.id, status: orders.status, seats: holds.seats })
      .from(orders)
      .innerJoin(holds, eq(holds.id, orders.holdId))
      .where(
        and(
          eq(orders.sessionId, input.sessionId),
          inArray(orders.status, fanOutOrderStatuses),
        ),
      )
      .orderBy(asc(orders.id))
      .limit(fanOutLimit + 1)
      .for('update', { of: orders }),
    'orders',
  );

  const released = openHolds.map((hold) => releasedHold(hold.status));
  if (released[0]) {
    await tx
      .update(holds)
      .set({ ...released[0], updatedAt: at })
      .where(
        inArray(
          holds.id,
          openHolds.map((hold) => hold.id),
        ),
      );
  }

  const unpaid = fanOutOrders.filter(
    (order) => orderFanOut(order.status) === 'void',
  );
  const voided = unpaid.map((order) => voidedStatus(order.status));
  if (voided[0]) {
    await tx
      .update(orders)
      .set({ status: voided[0] })
      .where(
        inArray(
          orders.id,
          unpaid.map((order) => order.id),
        ),
      );
  }

  let seatsReturned = 0;
  let ordersRefunded = 0;
  for (const order of fanOutOrders) {
    if (orderFanOut(order.status) !== 'refund') continue;
    const refund = requireSessionRefund(
      await requestRefund(tx, {
        orderId: order.id,
        reason: sessionRefundReason(reason),
        key: sessionRefundKey,
        ticketMinor: 'remaining',
        initiatedBy,
      }),
    );
    await tx
      .update(orders)
      .set({
        status: cancelledStatus(order.status),
        cancelledBy: reason,
        // Not the decision time: that is whole milliseconds, which can read earlier than the order's microsecond `confirmed_at`.
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(orders.id, order.id));
    seatsReturned += order.seats;
    ordersRefunded += 1;
    await writeAudit(
      tx,
      orderCancelledAudit({
        orderId: order.id,
        sessionId: input.sessionId,
        reason,
        initiatedBy,
        refundMinor: refund.amountMinor,
        refundId: refund.refundId,
        seatsReturned: order.seats,
      }),
    );
    await enqueue(tx, {
      kind: 'guest-cancellation',
      payload: {
        orderId: order.id,
        cancelledBy: reason,
        refundMinor: refund.amountMinor,
      },
      dedupeKey: bookingEmailKey('guest-cancellation', order.id),
    });
  }

  if (plan.writesSession || seatsReturned > 0) {
    await tx
      .update(sessions)
      .set({
        ...(plan.writesSession
          ? {
              status: 'cancelled' as const,
              cancelReason: reason,
              version: sql`${sessions.version} + 1`,
            }
          : {}),
        seatsSold: sql`${sessions.seatsSold} - ${seatsReturned}`,
      })
      .where(eq(sessions.id, input.sessionId));
  }
  if (plan.writesSession) {
    await writeAudit(
      tx,
      sessionCancelledAudit({
        sessionId: input.sessionId,
        reason,
        initiatedBy,
        ordersRefunded,
        ordersVoided: unpaid.length,
        holdsReleased: openHolds.length,
      }),
    );
  }
  return {
    kind: 'walked',
    experienceId: locked.session.experienceId,
    result: {
      status: plan.writesSession ? 'cancelled' : 'already_cancelled',
      ordersRefunded,
      ordersVoided: unpaid.length,
      holdsReleased: openHolds.length,
      attemptsLeft: 0,
    },
  };
}

/**
 * Cancels the payments still in flight for the session's orders, after the first step has
 * committed. The provider is read first and `cancelStep` decides; a cancel that fails is not caught:
 * the repeat of the whole call reads the payment again. Returns how many attempts the provider (or
 * a payment event that came first) would not let go of.
 */
async function cancelLiveAttempts(
  payments: PaymentsPort,
  sessionId: string,
): Promise<number> {
  const live = requireWithinFanOut(
    await db
      .select({
        id: paymentAttempts.id,
        orderId: paymentAttempts.orderId,
        status: paymentAttempts.status,
        providerKey: paymentAttempts.providerKey,
        providerPaymentId: paymentAttempts.providerPaymentId,
      })
      .from(paymentAttempts)
      .innerJoin(orders, eq(orders.id, paymentAttempts.orderId))
      .where(
        and(
          eq(orders.sessionId, sessionId),
          inArray(paymentAttempts.status, liveAttemptStatuses),
        ),
      )
      .orderBy(asc(paymentAttempts.id))
      .limit(fanOutLimit + 1),
    'live payment attempts',
  );
  let left = 0;
  for (const attempt of live) {
    const settled = await settleAtProvider(payments, {
      attemptId: attempt.id,
      idempotencyKey: cancelAttemptKey(attempt.providerKey),
      target: attemptCancelTarget(attempt.orderId, attempt),
    });
    if (!settled || !(await markAttemptCanceled(attempt))) left += 1;
  }
  return left;
}

/**
 * Marks the attempt cancelled once the provider holds its payment cancelled. The attempt row is not
 * locked (design doc 4.2.3: only the payment's second transaction takes it), so the order's lock is
 * taken and the write only lands while the attempt is still live: a payment event that moved it
 * first wins, and the attempt is reported as left.
 */
async function markAttemptCanceled(attempt: {
  id: string;
  orderId: string;
  status: (typeof paymentAttempts.$inferSelect)['status'];
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    await lockOrderById(tx, attempt.orderId);
    requireAttemptTransition(attempt.status, 'canceled');
    const moved = await tx
      .update(paymentAttempts)
      .set({ status: 'canceled', updatedAt: await readDatabaseTime(tx) })
      .where(
        and(
          eq(paymentAttempts.id, attempt.id),
          inArray(paymentAttempts.status, liveAttemptStatuses),
        ),
      )
      .returning({ id: paymentAttempts.id });
    return afterAttemptWrite(moved.length) === 'release';
  });
}

/**
 * Cancels a session as a host owner (their own) or ops: the session is cancelled with the reason, its
 * open holds are released, each confirmed booking is cancelled and refunded in full (one refund job
 * per order), each unpaid order is voided, and each guest with a booking is queued an email, with
 * other dates when the experience has any. Safe to run twice: a session already cancelled is walked
 * again, finishing what a failed run left, and writes nothing a second time. Runs in a Server Action
 * only (it invalidates cache tags). Commission return and gift reinstatement are not part of it.
 */
export async function cancelSession(
  caller: Caller,
  input: CancelSessionInput,
  payments: PaymentsPort = getPaymentsPort(),
): Promise<CancelSessionResult> {
  const parsed = CancelSessionInputSchema.parse(input);
  const walked = await db.transaction((tx) => walkSession(tx, caller, parsed));
  if (walked.kind === 'stop') return walked.result;
  const { result } = walked;
  if (
    result.status === 'cancelled' ||
    result.ordersRefunded + result.ordersVoided + result.holdsReleased > 0
  ) {
    revalidateTagsForChanges(
      sessionCancelCacheChanges({
        sessionId: parsed.sessionId,
        experienceId: walked.experienceId,
      }),
    );
  }
  return {
    ...result,
    attemptsLeft: await cancelLiveAttempts(payments, parsed.sessionId),
  };
}
