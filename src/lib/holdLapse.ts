import { isOpenHold, type HoldTimes } from './holds';
import { type OrderStatus } from './orders';
import { isLiveAttempt, type AttemptStatus } from './payments';

// What the holds sweep does with a `paying` hold that ran past `paying_until` (design doc 4.2.3,
// Hold transitions): the live attempt is cancelled at the provider, the order is voided, and the
// hold is released as `payment_abandoned`. A payment that still succeeds lands through `confirmOrder`.

/** Orders a lapse may void or leave void. Any other status means the order's own outcome owns the hold. */
const lapsableOrderStatuses: readonly OrderStatus[] = [
  'pending_payment',
  'payment_failed',
  'void',
];

type LapseAttempt = {
  id: string;
  providerKey: string;
  status: AttemptStatus;
  providerPaymentId: string | null;
};

export type LapseState = {
  hold: HoldTimes;
  order: { id: string; status: OrderStatus } | null;
  /** The order's attempt with the highest number. */
  attempt: LapseAttempt | null;
};

/** Where to find the payment to cancel: by the id Ramble stored, or by Ramble's ids when it never stored one (rule 7). */
export type LapseTarget =
  | { kind: 'payment'; paymentId: string }
  | { kind: 'metadata'; orderId: string; recordId: string };

export type PayingLapse =
  | { kind: 'skip' }
  | {
      kind: 'cancel_first';
      attemptId: string;
      idempotencyKey: string;
      target: LapseTarget;
    }
  | {
      kind: 'release';
      voidOrderId: string | null;
      cancelAttempt: { id: string; from: AttemptStatus } | null;
    };

/**
 * What to do with a hold the sweep found, judged under the locks at database time `at`.
 * `settledAttemptId` is the attempt the provider has already confirmed cancelled (null on the first
 * look). In order:
 *
 * 1. A hold that is not `paying`, or is still open at `at`, is left alone.
 * 2. A hold with no order is released as it is.
 * 3. An order that is confirmed, cancelled, or refunded owns the hold's outcome: left alone.
 * 4. An attempt that already succeeded is a payment on its way to `confirmOrder`: left alone.
 * 5. A live attempt is cancelled at the provider first (`cancel_first`); once the provider says it is
 *    cancelled, the hold is released, the order voided, and the attempt marked cancelled. An attempt
 *    that is cancelled already, or none, needs no provider call.
 */
export function payingLapse(
  state: LapseState,
  at: Date,
  settledAttemptId: string | null,
): PayingLapse {
  const { hold, order, attempt } = state;
  if (hold.status !== 'paying' || isOpenHold(hold, at)) return { kind: 'skip' };
  if (order === null) {
    return { kind: 'release', voidOrderId: null, cancelAttempt: null };
  }
  if (!lapsableOrderStatuses.includes(order.status)) return { kind: 'skip' };
  if (attempt?.status === 'succeeded') return { kind: 'skip' };
  const voidOrderId = order.status === 'void' ? null : order.id;
  if (attempt === null || !isLiveAttempt(attempt.status)) {
    return { kind: 'release', voidOrderId, cancelAttempt: null };
  }
  if (settledAttemptId === attempt.id) {
    return {
      kind: 'release',
      voidOrderId,
      cancelAttempt: { id: attempt.id, from: attempt.status },
    };
  }
  return {
    kind: 'cancel_first',
    attemptId: attempt.id,
    idempotencyKey: cancelAttemptKey(attempt.providerKey),
    target:
      attempt.providerPaymentId === null
        ? { kind: 'metadata', orderId: order.id, recordId: attempt.id }
        : { kind: 'payment', paymentId: attempt.providerPaymentId },
  };
}

/**
 * Whether the provider no longer holds a live payment for the attempt, from the payment's status
 * after the cancel was tried (null: the provider has none). A payment found only by Ramble's ids may
 * be missing, because the attempt never stored one. A payment Ramble stored an id for that is gone
 * is not settled, because Ramble cannot say what became of it. Any other status, a payment in
 * `processing` or one that `succeeded`, is not cancelled and the hold is left for the next run.
 */
export function providerSettled(
  target: LapseTarget,
  status: AttemptStatus | null,
): boolean {
  if (status === null) return target.kind === 'metadata';
  return status === 'canceled';
}

/** The idempotency key of the cancel, derived from the attempt's own key so a repeated sweep repeats one call (FORM-8). */
function cancelAttemptKey(attemptProviderKey: string): string {
  return `cancel:${attemptProviderKey}`;
}

/**
 * Whether a refused cancel only says what the payment's state is: the payment cannot be cancelled
 * from where it is (`invalid_state`), or the provider has no such payment (`not_found`). The sweep
 * reads the payment then and lets `providerSettled` decide. Any other refusal (the provider is
 * unavailable, the key clashed) is thrown, and the sweep stops and tries again on the next pulse.
 */
export function isCancelRefusal(code: string): boolean {
  return code === 'invalid_state' || code === 'not_found';
}
