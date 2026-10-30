import { isOpenHold, remainingSpaces, type HoldTimes } from './holds';
import { orderTransitions, type OrderKind, type OrderStatus } from './orders';
import type { PaymentProvider } from './payments';
import { sessionStatuses } from './sessions';
import { isTerminal } from './transitions';

// The decisions of `confirmOrder` (design doc 4.2.3): what a succeeded payment does to its order.
// The data layer reads the rows, calls `confirmDecision`, and writes what it says.

export const refundPathReasons = [
  'amount_mismatch',
  'currency_mismatch',
  'session_cancelled',
  'sold_out_after_lapse',
] as const;
export type RefundPathReason = (typeof refundPathReasons)[number];

/** The confirmations that belong to later units; a payment that reaches one is a bug until they land. */
export const notBuiltBranches = [
  'gift_purchase',
  'zero_due',
  'exchange',
] as const;
export type NotBuiltBranch = (typeof notBuiltBranches)[number];

const notBuiltUnits = {
  gift_purchase: 'U-062a',
  zero_due: 'U-064a',
  exchange: 'U-065a',
} as const satisfies Record<NotBuiltBranch, string>;

/** Thrown by a confirmation no unit has built yet. The message names the unit that will. */
export class NotBuiltError extends Error {
  constructor(branch: NotBuiltBranch) {
    super(
      `Confirming a ${branch.replace('_', ' ')} order is not built yet: ${notBuiltUnits[branch]}`,
    );
    this.name = 'NotBuiltError';
  }
}

type SessionStatus = (typeof sessionStatuses)[number];

export type ConfirmDecisionInput = {
  order: {
    status: OrderStatus;
    kind: OrderKind;
    amountDueMinor: number;
    giftAppliedMinor: number;
    currency: string;
  };
  /** What the provider reports it took; null where the event did not carry it. */
  payment: { amountMinor: number | null; currency: string | null };
  /** The rows a booking rests on, read under the locks. Null for an order that is not a booking. */
  booking: {
    session: { status: SessionStatus; allocation: number; seatsSold: number };
    hold: HoldTimes & { seats: number };
    /** The seats of every open hold on the session at `at`, this one's included while it is open. */
    openHeldSeats: number;
  } | null;
  at: Date;
};

export type ConfirmDecision =
  | { kind: 'already_confirmed' }
  | { kind: 'confirm' }
  | { kind: 'refund_path'; reason: RefundPathReason }
  | { kind: 'not_built'; branch: NotBuiltBranch };

/**
 * What a succeeded payment does to its order, in the order of design doc 4.2.3. A confirmed order
 * is left alone. The confirmations no unit has built yet are named before the amount is compared,
 * because their refund path is not a booking's. The payment must equal what was due, to the cent
 * and the currency (a currency that differs is reported as that, whatever the amount). A booking
 * needs a scheduled session; its hold, while open, already counts its seats, and a hold that
 * lapsed confirms only when the session still has room for the party after every other open hold.
 *
 * Throws for a state that cannot occur: an order that is cancelled or refunded cannot be
 * confirmed, and a converted hold belongs to a confirmed order. A terminal state is never written over.
 */
export function confirmDecision(input: ConfirmDecisionInput): ConfirmDecision {
  const { order, payment, booking, at } = input;
  if (order.status === 'confirmed') return { kind: 'already_confirmed' };
  if (isTerminal(orderTransitions, order.status)) {
    throw new RangeError(
      `An order that is ${order.status} cannot be confirmed`,
    );
  }
  if (order.kind === 'gift_purchase') {
    return { kind: 'not_built', branch: 'gift_purchase' };
  }
  if (order.amountDueMinor === 0 || order.giftAppliedMinor > 0) {
    return { kind: 'not_built', branch: 'zero_due' };
  }
  if (payment.currency !== order.currency) {
    return { kind: 'refund_path', reason: 'currency_mismatch' };
  }
  if (payment.amountMinor !== order.amountDueMinor) {
    return { kind: 'refund_path', reason: 'amount_mismatch' };
  }

  if (booking === null) {
    throw new RangeError('A booking order needs its session and hold');
  }
  const { session, hold } = booking;
  if (hold.status === 'converted') {
    throw new RangeError('A converted hold belongs to a confirmed order');
  }
  if (session.status !== 'scheduled') {
    return { kind: 'refund_path', reason: 'session_cancelled' };
  }
  if (isOpenHold(hold, at)) return { kind: 'confirm' };
  return remainingSpaces(session, booking.openHeldSeats) >= hold.seats
    ? { kind: 'confirm' }
    : { kind: 'refund_path', reason: 'sold_out_after_lapse' };
}

/** A payment that is not what was due is reported once per order; the other reasons are ordinary. */
export function isPaymentMismatch(reason: RefundPathReason): boolean {
  return reason === 'amount_mismatch' || reason === 'currency_mismatch';
}

/** The CHECK under the hold logic: seats sold never pass the allocation (design doc 4.2.3, step 3). */
const seatsSoldCheck = 'sessions_seats_sold_within_allocation';

/**
 * Whether the database refused a write because it would sell more seats than the session has. The
 * driver's error sits under the query error that wraps it. Any other refusal is a bug and is not
 * mistaken for a sold-out session.
 */
export function isSeatsSoldRefusal(error: unknown): boolean {
  for (
    let current: unknown = error, depth = 0;
    current instanceof Error && depth < 4;
    depth += 1
  ) {
    const { code, constraint } = current as {
      code?: unknown;
      constraint?: unknown;
    };
    if (code === '23514' && constraint === seatsSoldCheck) return true;
    current = current.cause;
  }
  return false;
}

/** Money from the fake gateway is not real money, and the ledger says so on every row it posts. */
export function isSimulatedPayment(provider: PaymentProvider): boolean {
  return provider === 'fake';
}
