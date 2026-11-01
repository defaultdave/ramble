import { z } from 'zod';
import { WriteIdSchema } from './catalog';
import { backoffSeconds } from './jobs';
import { orderLimits, canOrderTransition, type OrderStatus } from './orders';
import type { RateLimitDecision } from './rateLimits';
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

const providerEventAlerts = {
  unmatched: 'payment-event-unmatched',
  confirmUnavailable: 'payment-confirm-unavailable',
  duplicatePayment: 'payment-duplicate',
} as const;

/** Ramble's ids on a provider object, parsed the way every write schema parses an id (lower-cased). */
export const EventMetadataSchema = z.object({
  orderId: WriteIdSchema,
  recordId: WriteIdSchema,
});
export type EventMetadata = z.output<typeof EventMetadataSchema>;

/** What the job's lookup step hands the handler: the ids the provider reported, or none. */
export function parsePreparedMetadata(prepared: unknown): EventMetadata | null {
  return EventMetadataSchema.nullable().parse(prepared ?? null);
}

/** A stored event of another provider than the port's has no adapter to ask. */
export function isProviderMismatch(
  portProvider: string,
  eventProvider: string,
): boolean {
  return portProvider !== eventProvider;
}

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

export type PaymentEventType = Extract<ProviderEventType, `payment.${string}`>;

/** Refund, transfer, and dispute events belong to later units: stored, then left alone. */
export function isPaymentEventType(
  type: ProviderEventType,
): type is PaymentEventType {
  return type.startsWith('payment.');
}

export function isDeferredEventType(type: ProviderEventType): boolean {
  return !isPaymentEventType(type);
}

/** The ids an event is handled under: its own, or the ones the provider reported when it carried none. */
export function eventIds(
  stored: { rambleOrderId: string | null; rambleRecordId: string | null },
  lookedUp: EventMetadata | null,
): { orderId: string | null; recordId: string | null; adopted: boolean } {
  if (stored.rambleOrderId === null && lookedUp !== null) {
    return { ...lookedUp, adopted: true };
  }
  return {
    orderId: stored.rambleOrderId,
    recordId: stored.rambleRecordId,
    adopted: false,
  };
}

/** An unprocessed payment event that names no order is looked up at the provider before its job runs. */
export function needsMetadataLookup(event: {
  type: ProviderEventType;
  rambleOrderId: string | null;
  processedAt: Date | null;
}): boolean {
  return (
    isPaymentEventType(event.type) &&
    event.rambleOrderId === null &&
    event.processedAt === null
  );
}

/** A signature check that refuses the delivery (as opposed to a provider fault, which surfaces). */
export function isRefusedSignature(code: string): boolean {
  return code === 'invalid_signature' || code === 'invalid_input';
}

/** How a delivery ended, before it becomes an HTTP answer. */
export type IntakeOutcome =
  | { kind: 'too_large' }
  | { kind: 'refused'; failures: RateLimitDecision }
  | { kind: 'over_budget'; budget: RateLimitDecision }
  | { kind: 'unstorable' }
  | { kind: 'accepted' };

export type IntakeResponse =
  { status: 200 | 400 | 413 } | { status: 429; retryAfterSeconds: number };

/** The one place a webhook outcome becomes a status: 2xx for what was taken or deliberately ignored, 4xx for the rest. */
export function intakeResponse(outcome: IntakeOutcome): IntakeResponse {
  switch (outcome.kind) {
    case 'too_large':
      return { status: 413 };
    case 'refused':
      return outcome.failures.allowed
        ? { status: 400 }
        : {
            status: 429,
            retryAfterSeconds: outcome.failures.retryAfterSeconds,
          };
    case 'over_budget':
      return outcome.budget.allowed
        ? { status: 200 }
        : { status: 429, retryAfterSeconds: outcome.budget.retryAfterSeconds };
    case 'unstorable':
      return { status: 400 };
    case 'accepted':
      return { status: 200 };
  }
}

/** A delivery the intake took (2xx), as opposed to one it refused or asked to be repeated later. */
export function isDeliveryTaken(status: number): boolean {
  return status >= 200 && status < 300;
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
  const ids = event.metadata && EventMetadataSchema.safeParse(event.metadata);
  if (ids && !ids.success) return null;
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
    rambleOrderId: ids?.data.orderId ?? null,
    rambleRecordId: ids?.data.recordId ?? null,
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
  method: PaymentMethod | null;
};

export type EventHold = {
  id: string;
  status: 'active' | 'paying' | 'converted' | 'released';
  expiresAt: Date;
  payingUntil: Date | null;
};

export type EventOrder = {
  id: string;
  status: OrderStatus;
  hold: EventHold | null;
};

export type EventFacts = {
  type: PaymentEventType;
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
  attemptFrom: AttemptStatus;
  attemptStatus: 'failed_try' | 'canceled';
  failedTries: number;
  failureCode: string | null;
  /** The order's move, or null when only the attempt's row changes. */
  orderMove: {
    id: string;
    from: OrderStatus;
    to: 'payment_failed' | 'void';
  } | null;
  /** The hold to put back from `paying` to `active`, or null when it stays as it is. */
  reopenHoldId: string | null;
};

export type ProviderEventAction =
  /** Nothing to match to: retried with backoff, alert after 5. */
  | { kind: 'unmatched' }
  /** Handled, nothing to change. */
  | { kind: 'noop' }
  | {
      kind: 'confirm';
      orderId: string;
      attemptId: string;
      attemptFrom: AttemptStatus;
      /** False when an earlier run already moved the attempt to `succeeded` and confirming did not finish. */
      markSucceeded: boolean;
      method: PaymentMethod | null;
    }
  /** A success for a payment that is not the live attempt: alert, leave unprocessed for U-109's refund. */
  | { kind: 'duplicate_payment' }
  | FailedTryAction
  | {
      kind: 'requires_action';
      attemptId: string;
      attemptFrom: AttemptStatus;
      /** The paying hold whose deadline moves, or null when there is none. */
      extendHold: { id: string; payingUntil: Date | null } | null;
    }
  | { kind: 'cancel_attempt'; attemptId: string; attemptFrom: AttemptStatus };

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
  const orderTo = exhausted ? 'void' : 'payment_failed';
  return {
    kind: 'payment_failed',
    attemptId: attempt.id,
    attemptFrom: attempt.status,
    attemptStatus,
    failedTries,
    failureCode,
    orderMove:
      ownsOrder && canOrderTransition(order.status, orderTo)
        ? { id: order.id, from: order.status, to: orderTo }
        : null,
    reopenHoldId:
      ownsOrder &&
      order.hold?.status === 'paying' &&
      order.hold.expiresAt.getTime() > now.getTime()
        ? order.hold.id
        : null,
  };
}

/**
 * What one payment event does, from the order's state at processing time. `now` is the time the
 * transaction runs, never the provider's `occurred_at` (rule 2). A terminal attempt never changes
 * (rule 3), and a success for any payment but the order's live attempt is not confirmed (rule 4).
 * `order` is null when the event names no order, or one that does not exist, and a match of kind
 * `none` is no attempt found: both make the event unmatched.
 */
export function providerEventAction(
  event: EventFacts,
  match: AttemptMatch,
  order: EventOrder | null,
  now: Date,
): ProviderEventAction {
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
        orderId: order.id,
        attemptId: attempt.id,
        attemptFrom: attempt.status,
        markSucceeded: attempt.status !== 'succeeded',
        method: event.method ?? attempt.method,
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
        attemptFrom: attempt.status,
        extendHold:
          order.hold?.status === 'paying'
            ? { id: order.hold.id, payingUntil: order.hold.payingUntil }
            : null,
      };
    }
    case 'payment.canceled':
      return canAttemptTransition(attempt.status, 'canceled')
        ? {
            kind: 'cancel_attempt',
            attemptId: attempt.id,
            attemptFrom: attempt.status,
          }
        : { kind: 'noop' };
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

export type RetryReason = 'unmatched' | 'confirm_unavailable';

export const retryErrors = {
  unmatched: 'No matching payment attempt',
  confirm_unavailable: 'Order confirmation is not available yet',
} as const satisfies Record<RetryReason, string>;

export type EventRetry = {
  /** The event's `attempts` after this try. */
  tries: number;
  /** When the next job runs, or null when the last try has been spent. */
  runAfter: Date | null;
  alert: 'unmatched' | 'gave_up' | null;
  lastError: string;
};

/**
 * What to do after one more failed try on an event: count it, and retry with backoff until the
 * table's last try. An unmatched event alerts on the 5th try (design doc 4.2.3); both reasons alert
 * once more when the last try is spent. A success waiting for the confirm step alerts only then.
 */
export function eventRetry(
  reason: RetryReason,
  attempts: number,
  eventId: string,
  now: Date,
): EventRetry {
  const tries = Math.min(attempts + 1, paymentLimits.maxEventAttempts);
  const last = tries >= paymentLimits.maxEventAttempts;
  const alertsOnFifth =
    reason === 'unmatched' && tries === alertAfterEventAttempts;
  return {
    tries,
    runAfter: last
      ? null
      : new Date(now.getTime() + backoffSeconds(tries, eventId) * 1000),
    alert: last ? 'gave_up' : alertsOnFifth ? 'unmatched' : null,
    lastError: retryErrors[reason],
  };
}

/** Whether the event is finished once the confirm step has answered, or comes back for another try. */
export function afterConfirm(
  status: 'confirmed' | 'already_confirmed' | 'unavailable',
): 'finish' | 'retry' {
  return status === 'unavailable' ? 'retry' : 'finish';
}

export type ProviderEventResult =
  | { status: 'processed' }
  | { status: 'already_processed' }
  /** Left unprocessed for the unit that owns it; the job is done. */
  | {
      status: 'left';
      reason: 'deferred_type' | 'duplicate_payment';
      orderId: string | null;
    }
  | {
      status: 'retry';
      reason: RetryReason;
      tries: number;
      alert: 'unmatched' | 'gave_up' | null;
    };

export type EventAlert = {
  kind: string;
  key: string;
  context: Record<string, unknown>;
};

/** The alert a result calls for, if any. Context carries ids only, never the event body. */
export function alertFor(
  result: ProviderEventResult,
  eventId: string,
): EventAlert | null {
  const key = eventAlertKey(eventId);
  if (result.status === 'left' && result.reason === 'duplicate_payment') {
    return {
      kind: providerEventAlerts.duplicatePayment,
      key,
      context: { eventId, orderId: result.orderId },
    };
  }
  if (result.status === 'retry' && result.alert !== null) {
    return {
      kind:
        result.reason === 'unmatched'
          ? providerEventAlerts.unmatched
          : providerEventAlerts.confirmUnavailable,
      key: result.alert === 'gave_up' ? `${key}:gave-up` : key,
      context: { eventId, tries: result.tries },
    };
  }
  return null;
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
