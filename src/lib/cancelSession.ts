import { z } from 'zod';
import type { CacheChange } from './cacheTags';
import { WriteIdSchema } from './catalog';
import { holdStatuses, requireAtMost, requireHoldTransition } from './holds';
import {
  orderStatuses,
  type OrderStatus,
  type orderCancelledBys,
} from './orders';
import { requireOrderTransition } from './providerEvents';
import type { RefundRequestRefusal, orderRefundReasons } from './refunds';
import { experiencePath, type ExperienceAddress } from './routes';
import { sessionCancelReasons, sessionStatuses } from './sessions';

// What cancelling a session decides (PRD-28, PRD-51): which sessions can be cancelled, what each
// order and hold on one does, the refund each guest gets, and where the email sends them for another
// date. The data layer locks, reads, writes, and acts on what these functions say.

export type SessionCancelReason = (typeof sessionCancelReasons)[number];
type SessionStatus = (typeof sessionStatuses)[number];
type HoldStatus = (typeof holdStatuses)[number];

export const CancelSessionInputSchema = z.strictObject({
  sessionId: WriteIdSchema,
  reason: z.enum(sessionCancelReasons),
});
export type CancelSessionInput = z.input<typeof CancelSessionInputSchema>;

/** The refund reason each cancelling party's refunds carry. */
const refundReasons = {
  host: 'host_cancel',
  weather: 'weather',
  ramble: 'ramble_cancel',
} as const satisfies Record<
  SessionCancelReason,
  (typeof orderRefundReasons)[number]
>;

export function sessionRefundReason(reason: SessionCancelReason) {
  return refundReasons[reason];
}

/** With the reason and the order, names the one refund of a session's cancellation. */
export const sessionRefundKey = 'session-cancel';

/** Orders and holds one session can carry; more means the table disagrees with the rules that bound it. */
export const fanOutLimit = 5000;

export type CancelSessionResult =
  | {
      status: 'cancelled' | 'already_cancelled';
      ordersRefunded: number;
      ordersVoided: number;
      holdsReleased: number;
      /** Payments the provider would not cancel (processing or succeeded): their event takes the refund path. */
      attemptsLeft: number;
    }
  | { status: 'not_found' }
  | { status: 'completed' };

export type SessionPlan =
  | { kind: 'stop'; result: { status: 'completed' } }
  | {
      kind: 'proceed';
      /** The reason the session carries: the one asked for, or the one it was cancelled with before. */
      reason: SessionCancelReason;
      /** False for a session that is already cancelled: its orders and holds are still tidied, its row is not rewritten. */
      writesSession: boolean;
    };

/**
 * What cancelling a session does with the session as it stands under its lock. A scheduled session
 * is cancelled with the reason asked for. A cancelled one keeps its own reason and is walked again
 * (a repeat after a failure finishes the work and writes nothing twice). A completed one is over.
 */
export function sessionCancelPlan(
  session: { status: SessionStatus; cancelReason: SessionCancelReason | null },
  asked: SessionCancelReason,
): SessionPlan {
  switch (session.status) {
    case 'scheduled':
      return { kind: 'proceed', reason: asked, writesSession: true };
    case 'cancelled':
      if (session.cancelReason === null) {
        throw new RangeError('A cancelled session has no reason');
      }
      return {
        kind: 'proceed',
        reason: session.cancelReason,
        writesSession: false,
      };
    case 'completed':
      return { kind: 'stop', result: { status: 'completed' } };
  }
}

export type OrderFanOut = 'refund' | 'void' | 'leave';

/**
 * What a cancelled session does to an order. A confirmed booking is cancelled and refunded in full.
 * An order still waiting for payment is voided (its payment, if one is in flight, is cancelled at
 * the provider after the commit), and a payment that lands anyway takes the refund path. Every other
 * order has already reached its end.
 */
export function orderFanOut(status: OrderStatus): OrderFanOut {
  switch (status) {
    case 'confirmed':
      return 'refund';
    case 'pending_payment':
    case 'payment_failed':
      return 'void';
    case 'void':
    case 'cancelled':
    case 'refunded_after_lapse':
      return 'leave';
  }
}

/** The order statuses the fan-out locks and writes; derived, so a status added to the table is decided above. */
export const fanOutOrderStatuses = orderStatuses.filter(
  (status) => orderFanOut(status) !== 'leave',
);

/** A hold on a cancelled session stops holding spaces: an open one is released, one that ended or became a booking is left. */
export function holdFanOut(status: HoldStatus): 'release' | 'leave' {
  switch (status) {
    case 'active':
    case 'paying':
      return 'release';
    case 'converted':
    case 'released':
      return 'leave';
  }
}

export const fanOutHoldStatuses = holdStatuses.filter(
  (status) => holdFanOut(status) === 'release',
);

/** The confirmed bookings to refund and the unpaid orders to void, each in the order given. */
export function partitionOrders<T extends { status: OrderStatus }>(
  rows: readonly T[],
): { toRefund: T[]; toVoid: T[] } {
  return {
    toRefund: rows.filter((row) => orderFanOut(row.status) === 'refund'),
    toVoid: rows.filter((row) => orderFanOut(row.status) === 'void'),
  };
}

/**
 * What the session row is written with, or null when there is nothing to write: a first
 * cancellation writes the status, and any cancellation that returned seats writes the count.
 */
export function sessionRowWrite(input: {
  writesSession: boolean;
  seatsReturned: number;
}): { cancels: boolean; seatsReturned: number } | null {
  return input.writesSession || input.seatsReturned > 0
    ? { cancels: input.writesSession, seatsReturned: input.seatsReturned }
    : null;
}

/** Whether the cache tags are invalidated: the session was cancelled now, or the walk changed a row. */
export function revalidatesCache(result: {
  status: 'cancelled' | 'already_cancelled';
  ordersRefunded: number;
  ordersVoided: number;
  holdsReleased: number;
}): boolean {
  return (
    result.status === 'cancelled' ||
    result.ordersRefunded + result.ordersVoided + result.holdsReleased > 0
  );
}

/** Every row the fan-out reads is bounded: more than `fanOutLimit` is refused, and nothing is decided on a part. */
export function requireWithinFanOut<T>(
  rows: readonly T[],
  what: string,
): readonly T[] {
  return requireAtMost(rows, fanOutLimit, what);
}

/** The writes a hold's release makes; throws for a hold that cannot be released. */
export function releasedHold(status: HoldStatus) {
  requireHoldTransition(status, 'released');
  return { status: 'released', releasedReason: 'session_cancelled' } as const;
}

/** The status a voided order moves to; throws for an order that cannot be voided. */
export function voidedStatus(status: OrderStatus): 'void' {
  requireOrderTransition(status, 'void');
  return 'void';
}

/** The status a refunded booking moves to; throws for an order that cannot be cancelled. */
export function cancelledStatus(status: OrderStatus): 'cancelled' {
  requireOrderTransition(status, 'cancelled');
  return 'cancelled';
}

type RequestedFullRefund =
  | {
      status: 'requested' | 'already_requested';
      refund: { refundId: string; amountMinor: number };
    }
  | { status: 'refused'; reason: RefundRequestRefusal };

/**
 * The refund a cancelled booking got. A refusal (a payment that cannot be sent back, or an order
 * paid in part by a gift) is not a state the cancellation can leave a guest in, so it throws and
 * the cancellation rolls back whole.
 */
export function requireSessionRefund(result: RequestedFullRefund) {
  if (result.status === 'refused') {
    throw new RangeError(
      `A booking on a cancelled session cannot be refunded in full: ${result.reason}`,
    );
  }
  return result.refund;
}

function auditActor(initiatedBy: string | null) {
  return initiatedBy === null
    ? ({ actorKind: 'system' } as const)
    : ({ actorKind: 'user', actorId: initiatedBy } as const);
}

/** The audit row of one cancelled booking: ids, codes, and amounts only. */
export function orderCancelledAudit(input: {
  orderId: string;
  sessionId: string;
  reason: SessionCancelReason;
  initiatedBy: string | null;
  refundMinor: number;
  refundId: string;
  seatsReturned: number;
}) {
  return {
    ...auditActor(input.initiatedBy),
    action: 'order.cancelled',
    subjectKind: 'order',
    subjectId: input.orderId,
    details: {
      cancelled_by: input.reason,
      session_id: input.sessionId,
      refund_minor: input.refundMinor,
      refund_id: input.refundId,
      seats_returned: input.seatsReturned,
    },
  } as const;
}

/** The audit row of the session's cancellation, with what it did. */
export function sessionCancelledAudit(input: {
  sessionId: string;
  reason: SessionCancelReason;
  initiatedBy: string | null;
  ordersRefunded: number;
  ordersVoided: number;
  holdsReleased: number;
}) {
  return {
    ...auditActor(input.initiatedBy),
    action: 'session.cancelled',
    subjectKind: 'session',
    subjectId: input.sessionId,
    details: {
      reason: input.reason,
      orders_refunded: input.ordersRefunded,
      orders_voided: input.ordersVoided,
      holds_released: input.holdsReleased,
    },
  } as const;
}

/** The spaces and the experience's schedule change when a session is cancelled. */
export function sessionCancelCacheChanges(ids: {
  sessionId: string;
  experienceId: string;
}): CacheChange[] {
  return [
    { kind: 'spaces', sessionId: ids.sessionId },
    { kind: 'schedule', experienceId: ids.experienceId },
  ];
}

/**
 * Where the cancellation email sends a guest for another date: the experience's page, when it has a
 * scheduled session to come. A guest who cancelled has no use for it, and an experience with no
 * other date has nothing to show.
 */
export function otherDatesPath(input: {
  cancelledBy: (typeof orderCancelledBys)[number];
  otherUpcomingSessions: number;
  experience: ExperienceAddress;
}): string | null {
  if (input.cancelledBy === 'guest' || input.otherUpcomingSessions < 1) {
    return null;
  }
  return experiencePath(input.experience);
}
