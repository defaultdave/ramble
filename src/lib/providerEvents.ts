import { z } from 'zod';
import { backoffSeconds } from './jobs';
import { orderLimits, canOrderTransition, type OrderStatus } from './orders';
import {
  ProviderEventPayloadSchema,
  canAttemptTransition,
  isFailureCode,
  isLiveAttempt,
  maxFailedTries,
  paymentLimits,
  type AttemptStatus,
  type PaymentProvider,
  type ProviderEventType,
  paymentMethods,
} from './payments';

// What each provider event does to an order and its attempt (design doc 4.2.3, "What each event
// does"), as plain functions the webhook intake and the `process-provider-event` job call. The
// functions decide; `src/server/db/providerEvents.ts` locks, reads, and writes what they say.

type PaymentMethod = (typeof paymentMethods)[number];

/** The job kind. The design doc calls it `process_provider_event`; a job kind is a hyphenated slug. */
export const processProviderEventKind = 'process-provider-event';

/** The job's payload: the stored event's row id. */
export const ProcessProviderEventPayloadSchema = z.strictObject({
  eventId: z.uuid().transform((id) => id.toLowerCase()),
});

/** Unmatched events raise an alert on this try (design doc 4.2.3: "an alert after 5"). */
export const alertAfterEventAttempts = 5;

export const providerEventAlerts = {
  unmatched: 'payment-event-unmatched',
  duplicatePayment: 'payment-duplicate',
} as const;

/** Rule 8: one advisory lock per order serializes its provider events. */
export function orderEventsLockKey(orderId: string): string {
  return `order-events:${orderId.toLowerCase()}`;
}

/** One job per event and try, so a retry is a new job and an intake repeat enqueues nothing. */
export function processEventDedupeKey(eventId: string, tries: number): string {
  return `${processProviderEventKind}:${eventId.toLowerCase()}:${String(tries)}`;
}

export function eventAlertKey(eventId: string): string {
  return `event:${eventId.toLowerCase()}`;
}

/** Refund, transfer, and dispute events belong to later units: stored, then left alone. */
export function isDeferredEventType(type: ProviderEventType): boolean {
  return !type.startsWith('payment.');
}

// -- Intake -----------------------------------------------------------------------------------

/** What the payments port hands over for a verified delivery. */
export type IncomingProviderEvent = {
  id: string;
  provider: PaymentProvider;
  type: ProviderEventType;
  objectId: string;
  metadata: { orderId: string; recordId: string } | null;
  amountMinor: number | null;
  currency: string | null;
  feeMinor: number | null;
  failureCode: string | null;
  method: PaymentMethod | null;
  occurredAt: Date;
};

export type ProviderEventRow = {
  provider: PaymentProvider;
  providerEventId: string;
  type: ProviderEventType;
  objectId: string;
  rambleOrderId: string | null;
  rambleRecordId: string | null;
  amountMinor: number | null;
  currency: string | null;
  occurredAt: Date;
  payload: Record<string, unknown>;
};

/** `provider_events` columns hold years 1000 to 9999 only. */
function isReadableTime(at: Date): boolean {
  const year = at.getUTCFullYear();
  return year >= 1000 && year <= 9999;
}

/**
 * The row to store for a verified event, or null when the database would refuse it (an amount no
 * order can reach, a time outside the readable years, a body over the size bound). The signature
 * was genuine, so nothing is repaired: the caller refuses the delivery.
 */
export function providerEventRow(
  event: IncomingProviderEvent,
): ProviderEventRow | null {
  const amountFits =
    event.amountMinor === null || event.amountMinor <= orderLimits.maxMinor;
  if (!amountFits || !isReadableTime(event.occurredAt)) return null;
  const payload = ProviderEventPayloadSchema.safeParse({
    id: event.id,
    provider: event.provider,
    type: event.type,
    objectId: event.objectId,
    metadata: event.metadata,
    amountMinor: event.amountMinor,
    currency: event.currency,
    feeMinor: event.feeMinor,
    failureCode: event.failureCode,
    method: event.method,
    occurredAt: event.occurredAt.toISOString(),
  });
  if (!payload.success) return null;
  return {
    provider: event.provider,
    providerEventId: event.id,
    type: event.type,
    objectId: event.objectId,
    rambleOrderId: event.metadata?.orderId.toLowerCase() ?? null,
    rambleRecordId: event.metadata?.recordId.toLowerCase() ?? null,
    amountMinor: event.amountMinor,
    currency: event.currency,
    occurredAt: event.occurredAt,
    payload: payload.data,
  };
}

// -- Processing -------------------------------------------------------------------------------

export type EventAttempt = {
  id: string;
  status: AttemptStatus;
  failedTries: number;
  providerPaymentId: string | null;
};

export type EventHold = {
  status: 'active' | 'paying' | 'converted' | 'released';
  expiresAt: Date;
};

export type EventOrder = { status: OrderStatus; hold: EventHold | null };

export type EventFacts = {
  type: ProviderEventType;
  objectId: string;
  rambleRecordId: string | null;
  method: PaymentMethod | null;
  failureCode: string | null;
};

const PayloadFactsSchema = z.object({
  method: z.enum(paymentMethods).nullable(),
  failureCode: z.string().nullable(),
  feeMinor: z.int().nonnegative().nullable(),
});

/** What the stored body carries beyond the columns: how the guest paid, why it failed, the fee kept. */
export function payloadFacts(payload: Record<string, unknown>) {
  return PayloadFactsSchema.parse(payload);
}

/**
 * Which of the order's attempts a payment event is about. The provider's payment id is the sure
 * match. The record id in metadata (the attempt's id) covers an attempt whose provider id was never
 * stored; when that attempt already names a different payment, the event is about another payment
 * for the same order.
 */
export type AttemptMatch =
  | { kind: 'payment'; attempt: EventAttempt }
  | { kind: 'other'; attempt: EventAttempt }
  | { kind: 'none' };

export function matchEventAttempt(
  event: Pick<EventFacts, 'objectId' | 'rambleRecordId'>,
  attempts: readonly EventAttempt[],
): AttemptMatch {
  const byPayment = attempts.find(
    (attempt) => attempt.providerPaymentId === event.objectId,
  );
  if (byPayment) return { kind: 'payment', attempt: byPayment };
  const byRecord = attempts.find(
    (attempt) =>
      event.rambleRecordId !== null && attempt.id === event.rambleRecordId,
  );
  if (!byRecord) return { kind: 'none' };
  return byRecord.providerPaymentId === null
    ? { kind: 'payment', attempt: byRecord }
    : { kind: 'other', attempt: byRecord };
}

/** The order states a success confirms from; `void` is here because a late success still lands. */
const confirmableOrderStatuses = [
  'pending_payment',
  'payment_failed',
  'void',
] as const satisfies readonly OrderStatus[];

function isConfirmable(status: OrderStatus): boolean {
  return (confirmableOrderStatuses as readonly string[]).includes(status);
}

export type FailedTryAction = {
  kind: 'payment_failed';
  attemptId: string;
  attemptStatus: 'failed_try' | 'canceled';
  failedTries: number;
  failureCode: string | null;
  /** The order's new status, or null when only the attempt's row changes. */
  orderStatus: 'payment_failed' | 'void' | null;
  /** The hold goes from `paying` back to `active`. */
  reopenHold: boolean;
};

export type ProviderEventAction =
  /** Not this unit's type: left unprocessed, no retry, no alert. */
  | { kind: 'wait' }
  /** Nothing to match to: retried with backoff, alert after 5. */
  | { kind: 'unmatched' }
  /** Handled, nothing to change. */
  | { kind: 'noop' }
  | {
      kind: 'confirm';
      attemptId: string;
      /** False when an earlier run already moved the attempt to `succeeded` and confirming did not finish. */
      markSucceeded: boolean;
      method: PaymentMethod | null;
    }
  /** A success for a payment that is not the live attempt: alert, leave unprocessed for U-109's refund. */
  | { kind: 'duplicate_payment' }
  | FailedTryAction
  | { kind: 'requires_action'; attemptId: string; extendPaying: boolean }
  | { kind: 'cancel_attempt'; attemptId: string };

function failedTry(
  event: EventFacts,
  attempt: EventAttempt,
  order: EventOrder,
  now: Date,
): ProviderEventAction {
  if (!isLiveAttempt(attempt.status)) return { kind: 'noop' };
  const failedTries = attempt.failedTries + 1;
  const exhausted = failedTries >= maxFailedTries;
  const attemptStatus = exhausted ? 'canceled' : 'failed_try';
  if (!canAttemptTransition(attempt.status, attemptStatus)) {
    return { kind: 'noop' };
  }
  const failureCode =
    event.failureCode !== null && isFailureCode(event.failureCode)
      ? event.failureCode
      : null;
  const ownsOrder = order.status === 'pending_payment';
  const orderStatus = ownsOrder && exhausted ? 'void' : 'payment_failed';
  return {
    kind: 'payment_failed',
    attemptId: attempt.id,
    attemptStatus,
    failedTries,
    failureCode,
    orderStatus:
      ownsOrder && canOrderTransition(order.status, orderStatus)
        ? orderStatus
        : null,
    reopenHold:
      ownsOrder &&
      order.hold?.status === 'paying' &&
      order.hold.expiresAt.getTime() > now.getTime(),
  };
}

/**
 * What one payment event does, from the order's state at processing time. `now` is the time the
 * transaction runs, never the provider's `occurred_at` (rule 2). A terminal attempt never changes
 * (rule 3), and a success for any payment but the order's live attempt is not confirmed (rule 4).
 * `order` is null when the event names no order that exists.
 */
export function providerEventAction(
  event: EventFacts,
  match: AttemptMatch,
  order: EventOrder | null,
  now: Date,
): ProviderEventAction {
  if (isDeferredEventType(event.type)) return { kind: 'wait' };
  if (order === null || match.kind === 'none') return { kind: 'unmatched' };

  if (match.kind === 'other') {
    return event.type === 'payment.succeeded'
      ? { kind: 'duplicate_payment' }
      : { kind: 'noop' };
  }
  const { attempt } = match;

  switch (event.type) {
    case 'payment.succeeded': {
      if (attempt.status === 'canceled') return { kind: 'duplicate_payment' };
      if (!isConfirmable(order.status)) {
        return attempt.status === 'succeeded'
          ? { kind: 'noop' }
          : { kind: 'duplicate_payment' };
      }
      return {
        kind: 'confirm',
        attemptId: attempt.id,
        markSucceeded: attempt.status !== 'succeeded',
        method: event.method,
      };
    }
    case 'payment.failed':
      return failedTry(event, attempt, order, now);
    case 'payment.requires_action': {
      const live = isLiveAttempt(attempt.status);
      if (
        !live ||
        order.status !== 'pending_payment' ||
        !canAttemptTransition(attempt.status, 'requires_action')
      ) {
        return { kind: 'noop' };
      }
      return {
        kind: 'requires_action',
        attemptId: attempt.id,
        extendPaying: order.hold?.status === 'paying',
      };
    }
    case 'payment.canceled':
      return canAttemptTransition(attempt.status, 'canceled')
        ? { kind: 'cancel_attempt', attemptId: attempt.id }
        : { kind: 'noop' };
    default:
      return { kind: 'wait' };
  }
}

export function requireAttemptTransition(
  from: AttemptStatus,
  to: AttemptStatus,
): void {
  if (!canAttemptTransition(from, to)) {
    throw new Error(`An attempt does not move from ${from} to ${to}`);
  }
}

export function requireOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): void {
  if (!canOrderTransition(from, to)) {
    throw new Error(`An order does not move from ${from} to ${to}`);
  }
}

export type UnmatchedOutcome = {
  /** Seconds until the next try, or null when the last try has been spent. */
  retryAfterSeconds: number | null;
  alert: 'unmatched' | 'gave_up' | null;
};

/** What to do after the `tries`th failed match of one event: retry with backoff, and alert on the 5th and on the last. */
export function unmatchedOutcome(
  tries: number,
  eventId: string,
): UnmatchedOutcome {
  const last = tries >= paymentLimits.maxEventAttempts;
  if (last) return { retryAfterSeconds: null, alert: 'gave_up' };
  return {
    retryAfterSeconds: backoffSeconds(tries, eventId),
    alert: tries === alertAfterEventAttempts ? 'unmatched' : null,
  };
}

/**
 * `paying_until` after a challenge: `now + grace`, never earlier than it already was, so the
 * extension cannot shorten the hold and keeps `paying_until >= expires_at`.
 */
export function extendedPayingUntil(
  current: Date | null,
  now: Date,
  graceMinutes: number,
): Date {
  const extended = new Date(now.getTime() + graceMinutes * 60_000);
  return current !== null && current.getTime() > extended.getTime()
    ? current
    : extended;
}
