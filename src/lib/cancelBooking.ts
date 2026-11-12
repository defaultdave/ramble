import { z } from 'zod';
import { userActor, userOrderEntry, type AuditEntryInput } from './audit';
import { refundArrivalLine } from './bookingEmails';
import type { CacheChange } from './cacheTags';
import {
  CapabilityTokenSchema,
  maxTokenVersion,
  type CapabilityTokenKind,
} from './capabilityTokens';
import { WriteIdSchema } from './catalog';
import { isWithinFreeWindow } from './cancellation';
import { orderCancelledBys, type OrderKind } from './orders';
import type { RateLimitDecision } from './rateLimits';
import {
  planRefund,
  RefundMinorSchema,
  refundsReconcile,
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

const CancelBookingInputSchema = z.strictObject({
  manageToken: CapabilityTokenSchema,
  /** The refund the guest was shown, in minor units. */
  expectedRefundMinor: RefundMinorSchema,
});
export type CancelBookingInput = z.input<typeof CancelBookingInputSchema>;

/** What the data layer cancels: the order the token opened, at the version it opened, with the refund shown. */
export const CancelOrderInputSchema = z.strictObject({
  orderId: WriteIdSchema,
  openedTokenVersion: z.int().min(1).max(maxTokenVersion),
  expectedRefundMinor: RefundMinorSchema,
});
export type CancelOrderInput = z.input<typeof CancelOrderInputSchema>;

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
  if (
    facts.freeCancelUntil === null ||
    !isWithinFreeWindow(facts.freeCancelUntil, now)
  ) {
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

type CancelVerdict =
  | { kind: 'proceed'; refundMinor: number; requestsRefund: boolean }
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
function cancelVerdict(input: {
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
    ? {
        kind: 'proceed',
        refundMinor: quote.refundMinor,
        requestsRefund: quote.refundMinor > 0,
      }
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
function refusalResult(
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
      return missingOrderResult;
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
  | { kind: 'refused'; result: CancelBookingResult };

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
    return {
      kind: 'refused',
      result: { status: 'refund_unavailable', reason: result.reason },
    };
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

/** Who cancels: the guest by their manage link (the default), or an ops user acting for Ramble. */
export type CancelActor = { kind: 'guest' } | { kind: 'ops'; userId: string };

export const guestCancelActor: CancelActor = { kind: 'guest' };

/** What the order records as the canceller: an ops cancel is Ramble's. */
export function cancelledByFor(
  actor: CancelActor,
): (typeof orderCancelledBys)[number] {
  return actor.kind === 'ops' ? 'ramble' : 'guest';
}

/** The audit row of a cancellation: ids, codes, and amounts only, naming the ops user when ops cancelled. */
export function cancellationAuditEntry(
  input: {
    orderId: string;
    sessionId: string;
    refundMinor: number;
    refundId: string | null;
    seatsReturned: number;
    giftReinstated: boolean;
  },
  actor: CancelActor = guestCancelActor,
): AuditEntryInput {
  return {
    ...(actor.kind === 'ops'
      ? userActor(actor.userId)
      : ({ actorKind: 'guest' } as const)),
    action: 'order.cancelled',
    subjectKind: 'order',
    subjectId: input.orderId,
    details: {
      cancelled_by: cancelledByFor(actor),
      session_id: input.sessionId,
      refund_minor: input.refundMinor,
      refund_id: input.refundId,
      seats_returned: input.seatsReturned,
      gift_reinstated: input.giftReinstated,
    },
  };
}

/** Ops cancelled a booking: written with the cancellation, in its transaction, beside `order.cancelled`. */
export const opsCancelRequestedEntry = (userId: string, orderId: string) =>
  userOrderEntry(userId, 'booking.ops_cancel_requested', orderId);

export type CancelPlan =
  | {
      kind: 'proceed';
      refundMinor: number;
      requestsRefund: boolean;
      /** The locked order the plan was made on, for the writes that follow. */
      facts: CancelFacts;
    }
  /** Nothing is cancelled: this is the answer. */
  | { kind: 'stop'; result: CancelBookingResult };

/** The answer when no booking stands behind the order: the same as every other refusal of a link. */
export const missingOrderResult = {
  status: 'not_found',
} as const satisfies CancelBookingResult;

/**
 * Whether a cancellation may start, from the kind of token it was opened with and the lock ids read
 * for its order: only a manage token cancels, and only an order with a session and a hold behind it.
 * Anything else is the answer for a missing order, before any lock is taken.
 */
export function cancelStart(input: {
  tokenKind: CapabilityTokenKind;
  ids: { sessionId: string | null; holdId: string | null } | null;
}):
  | { kind: 'lock'; sessionId: string; holdId: string }
  | { kind: 'stop'; result: CancelBookingResult } {
  const { ids } = input;
  if (input.tokenKind !== 'manage' || ids === null || !isBookingRow(ids)) {
    return { kind: 'stop', result: missingOrderResult };
  }
  return { kind: 'lock', sessionId: ids.sessionId, holdId: ids.holdId };
}

/**
 * What the data layer does with the locked order (null when it is gone): a missing order or a
 * refused verdict is its typed answer; otherwise the cancellation goes on, asking for a refund only
 * when one is due. The data layer executes this and decides nothing.
 */
export function cancelPlan(input: {
  facts: CancelFacts | null;
  openedTokenVersion: number;
  expectedRefundMinor: number;
  now: Date;
}): CancelPlan {
  const { facts, ...rest } = input;
  if (facts === null) return { kind: 'stop', result: missingOrderResult };
  const verdict = cancelVerdict({ facts, ...rest });
  if (verdict.kind === 'proceed') return { ...verdict, facts };
  return {
    kind: 'stop',
    result: refusalResult(verdict, facts.freeCancelUntil),
  };
}

/** An order row is a booking only with both a session and a hold behind it. */
export function isBookingRow<
  Row extends { sessionId: string | null; holdId: string | null },
>(row: Row): row is Row & { sessionId: string; holdId: string } {
  return row.sessionId !== null && row.holdId !== null;
}

/** The most refund rows one order is read with: more than an order can have, and one more to see a breach. */
export const reconcileReadLimit = 101;

/**
 * The per-order check after a cancellation: the standing refunds reconcile with the order's totals,
 * and the read was not cut off at its limit (a cut-off read cannot say they reconcile).
 */
export function refundsReconcileWithin(
  order: Parameters<typeof refundsReconcile>[0],
  lines: Parameters<typeof refundsReconcile>[1],
  readLimit: number,
): boolean {
  return lines.length < readLimit && refundsReconcile(order, lines);
}

/** Only a cancellation that went through returns spaces to sale, so only it invalidates the spaces cache. */
export function cancelCacheChanges(
  result: CancelBookingResult,
  sessionId: string | null,
): CacheChange[] {
  return result.status === 'cancelled' && sessionId !== null
    ? [{ kind: 'spaces', sessionId }]
    : [];
}

/** Why a try at a manage link was refused before it reached the order. */
export type GateRefusal =
  | { status: 'not_found' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type ManageGate<Row> =
  { kind: 'opened'; row: Row } | { kind: 'refused'; refusal: GateRefusal };

/**
 * The one gate in front of every manage link, for the page and the action alike: a token of the
 * wrong shape does no work and spends no try; a token over the count is told to wait; a token that
 * opens nothing is not found. `steps` does the counting and the lookup, in that order.
 */
export async function openManageGate<Row>(
  token: unknown,
  steps: {
    spendTry: (token: string) => Promise<RateLimitDecision>;
    open: (token: string) => Promise<Row | null>;
  },
): Promise<ManageGate<Row>> {
  const parsed = CapabilityTokenSchema.safeParse(token);
  if (!parsed.success) {
    return { kind: 'refused', refusal: missingOrderResult };
  }
  const spent = await steps.spendTry(parsed.data);
  if (!spent.allowed) {
    return {
      kind: 'refused',
      refusal: {
        status: 'rate_limited',
        retryAfterSeconds: spent.retryAfterSeconds,
      },
    };
  }
  const row = await steps.open(parsed.data);
  return row === null
    ? { kind: 'refused', refusal: missingOrderResult }
    : { kind: 'opened', row };
}

/** The action's input, or the answer for input that cannot be one (it is not found: nothing says why). */
export function parseCancelInput(
  input: unknown,
):
  | { kind: 'ok'; input: z.output<typeof CancelBookingInputSchema> }
  | { kind: 'refused'; result: CancelBookingResult } {
  const parsed = CancelBookingInputSchema.safeParse(input);
  return parsed.success
    ? { kind: 'ok', input: parsed.data }
    : { kind: 'refused', result: missingOrderResult };
}

/** What a form refund that is not digits becomes: below zero, so the schema refuses it. */
const invalidRefundMinor = -1;

/** The refund a form carried, in minor units: digits only, so anything else is below zero and the schema refuses it. */
export function refundMinorFromText(raw: unknown): number {
  return typeof raw === 'string' && /^\d{1,10}$/.test(raw)
    ? Number(raw)
    : invalidRefundMinor;
}

/** The form's two fields as the action's input; the refund travels as digits and is parsed strictly. */
export function cancelInputFromForm(fields: {
  manageToken: unknown;
  expectedRefundMinor: unknown;
}): CancelBookingInput {
  const { manageToken, expectedRefundMinor } = fields;
  return {
    manageToken: typeof manageToken === 'string' ? manageToken : '',
    expectedRefundMinor: refundMinorFromText(expectedRefundMinor),
  };
}

// The jobs a cancellation queues (ids and amounts only, so a job row holds no address or name).

export const GuestCancellationPayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  cancelledBy: z.enum(orderCancelledBys),
  /** What the guest gets back, as the cancellation decided it. */
  refundMinor: RefundMinorSchema,
});

export const HostCancellationPayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  cancelledBy: z.enum(orderCancelledBys),
});

export const GuestRefundPayloadSchema = z.strictObject({
  refundId: WriteIdSchema,
});
