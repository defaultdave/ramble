import { z } from 'zod';
import { refundArrivalLine } from './bookingEmails';
import { isCapabilityTokenShape } from './capabilityTokens';
import { orderLimits, type OrderKind } from './orders';
import {
  planRefund,
  type RefundableOrder,
  type RefundRequestRefusal,
} from './refunds';

// What cancelling a booking by its manage link decides (design doc 4.2.3, `cancelBooking`; PRD-10,
// PRD-46). The cancellation tiers give all or nothing: a full refund of what the order still holds
// until the order's `free_cancel_until`, nothing after. The data layer reads the order under its
// locks and acts on what these functions say; the page shows the same quote the action checks.

/** The refund row's reason and key for a guest's cancellation: one refund per order, so a retry asks again and changes nothing. */
export const cancelRefundReason = 'guest_cancel';
export const cancelRefundKey = 'guest-cancel';

export const CancelBookingInputSchema = z.strictObject({
  manageToken: z.string().refine(isCapabilityTokenShape),
  /** The refund the guest was shown, in minor units. */
  expectedRefundMinor: z.int().min(0).max(orderLimits.maxMinor),
});
export type CancelBookingInput = z.input<typeof CancelBookingInputSchema>;

/** What the order holds and what the cancellation is judged on. */
export type CancelFacts = RefundableOrder & {
  kind: OrderKind;
  giftAppliedMinor: number;
  freeCancelUntil: Date | null;
  manageTokenVersion: number;
  sessionStartsAt: Date;
  /** The spaces the booking's hold took, which the session gets back. */
  seats: number;
};

/** Why the refund is the amount it is, so the page can say it in words. */
export type RefundBasis =
  'full' | 'window_closed' | 'gift_paid' | 'already_refunded';

export type CancelQuote =
  | { kind: 'cancellable'; refundMinor: number; basis: RefundBasis }
  | { kind: 'already_cancelled' }
  | { kind: 'not_cancellable' };

/** Free up to and including the deadline, like `cancellationWindow`; an order with no deadline snapshot is never free. */
export function tierRefundsInFull(
  freeCancelUntil: Date | null,
  now: Date,
): boolean {
  return freeCancelUntil !== null && now.getTime() <= freeCancelUntil.getTime();
}

/**
 * What cancelling at `now` refunds, and why. A gift paid for any part of the order refunds nothing
 * (the gift is not reinstated in this build). Past the deadline nothing is refunded. Otherwise it
 * is exactly what `requestRefund` would give for the rest of the ticket; a refusal there that is
 * not "nothing left" means the order cannot say what it holds, and is an error, never a zero.
 */
function refundOnCancel(
  facts: CancelFacts,
  now: Date,
): { refundMinor: number; basis: RefundBasis } {
  if (facts.giftAppliedMinor > 0) return { refundMinor: 0, basis: 'gift_paid' };
  if (!tierRefundsInFull(facts.freeCancelUntil, now)) {
    return { refundMinor: 0, basis: 'window_closed' };
  }
  const plan = planRefund(facts, 'remaining');
  if (plan.status === 'planned') {
    return { refundMinor: plan.split.amountMinor, basis: 'full' };
  }
  if (plan.reason === 'nothing_left') {
    return { refundMinor: 0, basis: 'already_refunded' };
  }
  throw new RangeError(
    `The order cannot be refunded on cancel: ${plan.reason}`,
  );
}

/**
 * Whether the booking can be cancelled now and what that refunds. Only a confirmed booking whose
 * session has not started can be cancelled; a cancelled one is `already_cancelled`.
 */
export function cancelQuote(facts: CancelFacts, now: Date): CancelQuote {
  if (facts.status === 'cancelled') return { kind: 'already_cancelled' };
  if (
    facts.status !== 'confirmed' ||
    facts.kind !== 'booking' ||
    now.getTime() >= facts.sessionStartsAt.getTime()
  ) {
    return { kind: 'not_cancellable' };
  }
  return { kind: 'cancellable', ...refundOnCancel(facts, now) };
}

export type CancelVerdict =
  | { kind: 'proceed'; refundMinor: number }
  /** What the tier now gives is not what the guest was shown. */
  | { kind: 'terms_changed'; refundMinor: number }
  | { kind: 'already_cancelled' }
  | { kind: 'not_cancellable' }
  /** The order's links were voided after the token was read. */
  | { kind: 'token_stale' };

/**
 * The one decision of the cancel action, made on the locked order: a token from before a bump opens
 * nothing; then the order's own state; then the refund the guest saw against the refund the tier
 * gives now, which must match to the minor unit.
 */
export function cancelVerdict(input: {
  facts: CancelFacts;
  openedTokenVersion: number;
  expectedRefundMinor: number;
  now: Date;
}): CancelVerdict {
  const { facts, openedTokenVersion, expectedRefundMinor, now } = input;
  if (facts.manageTokenVersion !== openedTokenVersion) {
    return { kind: 'token_stale' };
  }
  const quote = cancelQuote(facts, now);
  if (quote.kind !== 'cancellable') return { kind: quote.kind };
  return quote.refundMinor === expectedRefundMinor
    ? { kind: 'proceed', refundMinor: quote.refundMinor }
    : { kind: 'terms_changed', refundMinor: quote.refundMinor };
}

export type CancelBookingResult =
  | {
      status: 'cancelled';
      refundMinor: number;
      giftReinstated: boolean;
      /** When the money shows up; null when nothing is refunded. */
      refundEta: string | null;
    }
  | { status: 'terms_changed'; refundMinor: number }
  /** The booking cannot be cancelled now (it is not confirmed, or the session has started). */
  | { status: 'not_refundable'; freeCancelUntil: string | null }
  | { status: 'already_cancelled' }
  /** The refund could not be requested, so nothing was cancelled. */
  | { status: 'refund_unavailable'; reason: RefundRequestRefusal }
  /** A malformed token, a token that opens nothing, and a stale one all end here, alike. */
  | { status: 'not_found' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

/** The answer for a verdict that cancels nothing. */
export function refusalResult(
  verdict: Exclude<CancelVerdict, { kind: 'proceed' }>,
  freeCancelUntil: Date | null,
): CancelBookingResult {
  switch (verdict.kind) {
    case 'terms_changed':
      return { status: 'terms_changed', refundMinor: verdict.refundMinor };
    case 'already_cancelled':
      return { status: 'already_cancelled' };
    case 'not_cancellable':
      return {
        status: 'not_refundable',
        freeCancelUntil: freeCancelUntil?.toISOString() ?? null,
      };
    case 'token_stale':
      return { status: 'not_found' };
  }
}

/**
 * The hook gift reinstatement plugs into: a booking paid by a gift gives the gift back instead of
 * refunding a card. Not built, so no gift is ever reinstated and a gift-paid cancellation refunds 0.
 */
// TODO(U-066b): reinstate the gift of a gift-paid booking and answer true.
export function giftReinstated(): boolean {
  return false;
}

export type RefundRequestOutcome =
  | { kind: 'go'; refundId: string }
  | { kind: 'refused'; reason: RefundRequestRefusal };

/**
 * What `requestRefund` answered, as the cancel acts on it. A refund made for this cancellation (now
 * or by an earlier try) goes on, but only if it is the amount the guest was shown: any other amount
 * is order data that cannot be right, and throws so the cancellation rolls back whole.
 */
export function refundRequestOutcome(
  result:
    | {
        status: 'requested' | 'already_requested';
        refund: { refundId: string; amountMinor: number };
      }
    | { status: 'refused'; reason: RefundRequestRefusal },
  refundMinor: number,
): RefundRequestOutcome {
  if (result.status === 'refused') {
    return { kind: 'refused', reason: result.reason };
  }
  if (result.refund.amountMinor !== refundMinor) {
    throw new RangeError('The refund is not the amount the guest was shown');
  }
  return { kind: 'go', refundId: result.refund.refundId };
}

/** The line that says when the money arrives, or null when none is coming. */
export function refundEtaLine(refundMinor: number): string | null {
  return refundMinor > 0 ? refundArrivalLine : null;
}

/** The audit row of a cancellation: ids, codes, and amounts only. */
export function cancellationAuditEntry(input: {
  orderId: string;
  sessionId: string;
  refundMinor: number;
  refundId: string | null;
  seatsReturned: number;
  giftReinstated: boolean;
}) {
  return {
    actorKind: 'guest',
    action: 'order.cancelled',
    subjectKind: 'order',
    subjectId: input.orderId,
    details: {
      cancelled_by: 'guest',
      session_id: input.sessionId,
      refund_minor: input.refundMinor,
      refund_id: input.refundId,
      seats_returned: input.seatsReturned,
      gift_reinstated: input.giftReinstated,
    },
  } as const;
}
