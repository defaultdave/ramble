import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { orderCurrency, orderLimits } from './orders';
import {
  everyJsonNode,
  isStorableJson,
  optionalText,
  requiredText,
} from './text';
import { addRuleIssues, type RuleIssue } from './rules';
import { canTransition, type TransitionTable } from './transitions';

// What a payment attempt and a provider event are, and the rules around them. The pgEnums and
// CHECKs on `payment_attempts` and `provider_events` are built from these tuples and constants
// (design doc 4.2.3, Payment in flight).

export const paymentProviders = ['fake', 'stripe'] as const;
export type PaymentProvider = (typeof paymentProviders)[number];

export const paymentMethods = ['card', 'apple_pay', 'google_pay'] as const;

export const attemptStatuses = [
  'created',
  'requires_action',
  'processing',
  'failed_try',
  'succeeded',
  'canceled',
] as const;
export type AttemptStatus = (typeof attemptStatuses)[number];

/** Rule 3 of design doc 4.2.3: a terminal attempt is never overwritten by a later or repeated event. */
export const terminalAttemptStatuses = [
  'succeeded',
  'canceled',
] as const satisfies readonly AttemptStatus[];

/** An order has at most one attempt that is not terminal (rule 4). */
export function isLiveAttempt(status: AttemptStatus): boolean {
  return !(terminalAttemptStatuses as readonly string[]).includes(status);
}

/** Failed tries on one attempt before it is canceled (ADR 0002 amendment). */
export const maxFailedTries = 5;

/**
 * An attempt starts as `created`. A `failed_try` can still succeed when the guest retries, and a
 * second failure on the same attempt is another `failed_try`.
 */
export const attemptTransitions = {
  created: [
    'requires_action',
    'processing',
    'failed_try',
    'succeeded',
    'canceled',
  ],
  requires_action: ['processing', 'failed_try', 'succeeded', 'canceled'],
  processing: ['requires_action', 'failed_try', 'succeeded', 'canceled'],
  failed_try: [
    'requires_action',
    'processing',
    'failed_try',
    'succeeded',
    'canceled',
  ],
  succeeded: [],
  canceled: [],
} as const satisfies TransitionTable<AttemptStatus>;

export function canAttemptTransition(
  from: AttemptStatus,
  to: AttemptStatus,
): boolean {
  return canTransition(attemptTransitions, from, to);
}

export const paymentLimits = {
  providerId: 255,
  failureCode: 64,
  lastError: 500,
  /** Bytes of the trimmed body as `JSON.stringify` writes it. */
  payloadBytes: 16_384,
  /** What Postgres stores the body as: jsonb adds a space after every colon and comma, so this is the looser backstop. */
  payloadStoredBytes: 32_768,
  /** Handling tries on one event; an alert is raised after 5 (design doc 4.2.3). */
  maxEventAttempts: 25,
  /** Attempts on one order: five failed tries cancel one, so a handful is all a real order uses. */
  maxAttemptNo: 50,
} as const;

/** `pay:{order_id}:{attempt_no}` (FORM-8): the provider's idempotency key for this attempt. */
export function attemptProviderKey(orderId: string, attemptNo: number): string {
  return `pay:${orderId.toLowerCase()}:${String(attemptNo)}`;
}

/** Provider failure codes are short snake_case words (`card_declined`); anything else is not stored. */
export const failureCodePattern = String.raw`^[a-z0-9_]+$`;
const failureCodeRegex = new RegExp(failureCodePattern);

export function isFailureCode(value: string): boolean {
  return (
    value.length <= paymentLimits.failureCode && failureCodeRegex.test(value)
  );
}

export const ProviderIdSchema = requiredText(paymentLimits.providerId);

type AttemptRuleFields = {
  orderId: string;
  attemptNo: number;
  providerKey: string;
  status: AttemptStatus;
  failedTries: number;
  failureCode: string | null;
  createdAt: Date;
  updatedAt: Date;
};

/** Rules that tie an attempt's fields together; the CHECKs on `payment_attempts` state the same rules. */
function attemptRuleIssues(attempt: AttemptRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (
    attempt.providerKey !==
    attemptProviderKey(attempt.orderId, attempt.attemptNo)
  ) {
    issues.push({
      path: 'providerKey',
      message: 'The key is pay: with the order id and the attempt number',
    });
  }
  if (attempt.status === 'failed_try' && attempt.failedTries < 1) {
    issues.push({
      path: 'failedTries',
      message: 'A failed try has at least one failed try counted',
    });
  }
  if (attempt.failureCode !== null && attempt.failedTries < 1) {
    issues.push({
      path: 'failureCode',
      message: 'A failure code needs a failed try',
    });
  }
  if (attempt.updatedAt < attempt.createdAt) {
    issues.push({ path: 'updatedAt', message: 'Not before it was created' });
  }
  return issues;
}

// TODO(U-047a): first caller, the attempt read in startPayment.
export const PaymentAttemptSchema = z
  .object({
    id: EntityIdSchema,
    orderId: EntityIdSchema,
    attemptNo: z.int().min(1).max(paymentLimits.maxAttemptNo),
    provider: z.enum(paymentProviders),
    providerKey: z.string().max(100),
    providerPaymentId: optionalText(paymentLimits.providerId),
    amountMinor: z.int().min(0).max(orderLimits.maxMinor),
    currency: z.literal(orderCurrency),
    failedTries: z.int().min(0).max(maxFailedTries),
    method: z.enum(paymentMethods).nullable(),
    status: z.enum(attemptStatuses),
    failureCode: z
      .string()
      .refine(isFailureCode, { message: 'Not a failure code' })
      .nullable(),
    createdAt: z.date(),
    updatedAt: z.date(),
  })
  .superRefine((attempt, ctx) => {
    addRuleIssues(attemptRuleIssues(attempt), ctx);
  });

export const providerEventTypes = [
  'payment.succeeded',
  'payment.failed',
  'payment.requires_action',
  'payment.canceled',
  'refund.succeeded',
  'refund.failed',
  'transfer.paid',
  'transfer.failed',
  'transfer.reversed',
  'dispute.opened',
  'dispute.won',
  'dispute.lost',
] as const;
export type ProviderEventType = (typeof providerEventTypes)[number];

/** An ISO currency code as a provider reports it, which can differ from ours: the mismatch is the thing to catch. */
export const providerCurrencyPattern = '^[A-Z]{3}$';
const providerCurrencyRegex = new RegExp(providerCurrencyPattern);

export function isProviderCurrency(value: string): boolean {
  return value.length === 3 && providerCurrencyRegex.test(value);
}

const textEncoder = new TextEncoder();

function compactBytes(payload: unknown): number {
  return textEncoder.encode(JSON.stringify(payload)).length;
}

/** The checks that walk the body run only on one that fits, so an oversize body is refused without being walked. */
const fits = (payload: unknown) =>
  compactBytes(payload) <= paymentLimits.payloadBytes;

/**
 * jsonb prints a number out in full where `JSON.stringify` writes an exponent (`1e-300` is stored
 * as 300 digits), so a small body could outgrow the stored-size CHECK. A number that needs an
 * exponent is refused; every other number is stored as it is written. Apart from that, jsonb adds
 * only a space after each colon and comma, at most half again the compact size, which the stored
 * limit (twice the compact one) covers.
 */
const hasPlainNumbers = (payload: unknown) =>
  everyJsonNode(
    payload,
    (node) => typeof node !== 'number' || !String(node).includes('e'),
  );

export const ProviderEventPayloadSchema = z
  .record(z.string(), z.unknown())
  .refine(fits, {
    message: `The body is at most ${String(paymentLimits.payloadBytes)} bytes`,
  })
  .refine((payload) => !fits(payload) || isStorableJson(payload), {
    message: 'The body holds a character that cannot be stored',
  })
  .refine((payload) => !fits(payload) || hasPlainNumbers(payload), {
    message: 'The body holds a number that needs an exponent',
  });

type EventRuleFields = {
  amountMinor: number | null;
  currency: string | null;
  receivedAt: Date;
  processedAt: Date | null;
};

/** Rules that tie a provider event's fields together; the CHECKs on `provider_events` state the same rules. */
function providerEventRuleIssues(event: EventRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if ((event.amountMinor === null) !== (event.currency === null)) {
    issues.push({
      path: 'currency',
      message: 'An amount and its currency come together',
    });
  }
  if (event.processedAt !== null && event.processedAt < event.receivedAt) {
    issues.push({ path: 'processedAt', message: 'Not before it was received' });
  }
  return issues;
}

export const ProviderEventSchema = z
  .object({
    id: EntityIdSchema,
    provider: z.enum(paymentProviders),
    providerEventId: ProviderIdSchema,
    type: z.enum(providerEventTypes),
    objectId: ProviderIdSchema,
    rambleOrderId: EntityIdSchema.nullable(),
    rambleRecordId: EntityIdSchema.nullable(),
    amountMinor: z.int().min(0).max(orderLimits.maxMinor).nullable(),
    currency: z
      .string()
      .refine(isProviderCurrency, { message: 'Not a currency code' })
      .nullable(),
    occurredAt: z.date(),
    receivedAt: z.date(),
    processedAt: z.date().nullable(),
    attempts: z.int().min(0).max(paymentLimits.maxEventAttempts),
    lastError: optionalText(paymentLimits.lastError),
    payload: ProviderEventPayloadSchema,
  })
  .superRefine((event, ctx) => {
    addRuleIssues(providerEventRuleIssues(event), ctx);
  });
