import { describe, expect, it } from 'vitest';
import {
  PaymentAttemptSchema,
  ProviderEventSchema,
  attemptProviderKey,
  attemptStatuses,
  attemptTransitions,
  canAttemptTransition,
  isFailureCode,
  isLiveAttempt,
  isProviderCurrency,
  maxFailedTries,
  paymentLimits,
  type AttemptStatus,
} from './payments';
import { isTerminal } from './transitions';

// Behaviours under test, one per decision, branch or risk.
// - attempt transitions: the design doc table; succeeded and canceled never change; a failed try can still succeed
// - live attempt: every status but the two terminal ones
// - attempt key and failure code shapes
// - PaymentAttemptSchema: valid rows pass; each row rule refuses its bad row
// - ProviderEventSchema: valid rows pass; amount and currency come together; the body is bounded and storable

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const orderId = id(1);
const created = new Date('2026-11-01T12:00:00Z');
const later = new Date('2026-11-01T12:05:00Z');

describe('attempt transitions', () => {
  const allowed: [AttemptStatus, AttemptStatus][] = [
    ['created', 'requires_action'],
    ['created', 'processing'],
    ['created', 'failed_try'],
    ['created', 'succeeded'],
    ['created', 'canceled'],
    ['requires_action', 'processing'],
    ['requires_action', 'failed_try'],
    ['requires_action', 'succeeded'],
    ['requires_action', 'canceled'],
    ['processing', 'requires_action'],
    ['processing', 'failed_try'],
    ['processing', 'succeeded'],
    ['processing', 'canceled'],
    ['failed_try', 'requires_action'],
    ['failed_try', 'processing'],
    ['failed_try', 'failed_try'],
    ['failed_try', 'succeeded'],
    ['failed_try', 'canceled'],
  ];

  it.each(allowed)('allows %s to %s', (from, to) => {
    expect(canAttemptTransition(from, to)).toBe(true);
  });

  it('refuses every other pair', () => {
    let allowedCount = 0;
    for (const from of attemptStatuses) {
      for (const to of attemptStatuses) {
        if (canAttemptTransition(from, to)) allowedCount += 1;
      }
    }
    expect(allowedCount).toBe(allowed.length);
  });

  it.each(['succeeded', 'canceled'] as const)(
    '%s is terminal: a later or repeated event never changes it',
    (status) => {
      expect(isTerminal(attemptTransitions, status)).toBe(true);
      for (const to of attemptStatuses) {
        expect(canAttemptTransition(status, to)).toBe(false);
      }
    },
  );

  it('never moves back to created', () => {
    for (const from of attemptStatuses) {
      expect(canAttemptTransition(from, 'created')).toBe(false);
    }
  });

  it.each([
    ['created', true],
    ['requires_action', true],
    ['processing', true],
    ['failed_try', true],
    ['succeeded', false],
    ['canceled', false],
  ] as const)('%s is live: %s', (status, live) => {
    expect(isLiveAttempt(status)).toBe(live);
  });
});

describe('attempt and failure shapes', () => {
  it('derives the provider key from the order and the attempt number', () => {
    expect(attemptProviderKey(orderId.toUpperCase(), 2)).toBe(
      `pay:${orderId}:2`,
    );
  });

  it.each([
    ['card_declined', true],
    ['insufficient_funds', true],
    ['Card Declined', false],
    ['', false],
    ['a'.repeat(65), false],
    [`${'a'.repeat(100_000)}!`, false],
  ])('judges failure code %j: %s', (value, expected) => {
    expect(isFailureCode(value)).toBe(expected);
  });
});

describe('PaymentAttemptSchema', () => {
  const attempt = {
    id: id(2),
    orderId,
    attemptNo: 1,
    provider: 'fake',
    providerKey: `pay:${orderId}:1`,
    providerPaymentId: null,
    amountMinor: 18509,
    currency: 'USD',
    failedTries: 0,
    method: null,
    status: 'created',
    failureCode: null,
    createdAt: created,
    updatedAt: created,
  };

  it.each([
    ['a new attempt', attempt],
    [
      'a failed try',
      {
        ...attempt,
        status: 'failed_try',
        failedTries: 1,
        failureCode: 'card_declined',
        updatedAt: later,
      },
    ],
    [
      'a canceled attempt at the try limit',
      { ...attempt, status: 'canceled', failedTries: maxFailedTries },
    ],
    [
      'a stored payment id and method',
      { ...attempt, providerPaymentId: 'pi_123', method: 'apple_pay' },
    ],
  ])('accepts %s', (_name, row) => {
    expect(PaymentAttemptSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    [
      'a key that is not from the order and number',
      { providerKey: `pay:${orderId}:2` },
    ],
    [
      'an attempt number of 0',
      { attemptNo: 0, providerKey: `pay:${orderId}:0` },
    ],
    [
      'an attempt number past the limit',
      { attemptNo: 51, providerKey: `pay:${orderId}:51` },
    ],
    ['a failed try with none counted', { status: 'failed_try' }],
    ['a failure code with no failed try', { failureCode: 'card_declined' }],
    [
      'a failure code that is not a code',
      { failedTries: 1, failureCode: 'Card Declined' },
    ],
    ['more failed tries than the limit', { failedTries: maxFailedTries + 1 }],
    ['a negative amount', { amountMinor: -1 }],
    ['a currency other than USD', { currency: 'EUR' }],
    [
      'an updated time before the created time',
      { updatedAt: new Date('2026-11-01T11:00:00Z') },
    ],
    ['an unknown provider', { provider: 'paypal' }],
    ['a blank provider payment id', { providerPaymentId: ' ' }],
  ])('refuses %s', (_name, change) => {
    expect(
      PaymentAttemptSchema.safeParse({ ...attempt, ...change }).success,
    ).toBe(false);
  });
});

describe('provider currency', () => {
  it.each([
    ['USD', true],
    ['EUR', true],
    ['usd', false],
    ['US', false],
    ['USDD', false],
  ])('judges %s: %s', (value, expected) => {
    expect(isProviderCurrency(value)).toBe(expected);
  });
});

describe('ProviderEventSchema', () => {
  const event = {
    id: id(3),
    provider: 'stripe',
    providerEventId: 'evt_123',
    type: 'payment.succeeded',
    objectId: 'pi_123',
    rambleOrderId: orderId,
    rambleRecordId: id(2),
    amountMinor: 18509,
    currency: 'USD',
    occurredAt: created,
    receivedAt: created,
    processedAt: null,
    attempts: 0,
    lastError: null,
    payload: { id: 'evt_123', type: 'payment_intent.succeeded' },
  };

  it.each([
    ['an event as received', event],
    [
      'an event with no amount or ids',
      {
        ...event,
        amountMinor: null,
        currency: null,
        rambleOrderId: null,
        rambleRecordId: null,
      },
    ],
    ['a handled event', { ...event, processedAt: later, attempts: 1 }],
    [
      'a body of the largest size that is mostly separators',
      { ...event, payload: { a: new Array<number>(8187).fill(1) } },
    ],
    [
      'a body with ordinary decimals and big integers',
      { ...event, payload: { a: 0.000001, b: 123456789012345680000, c: -1.5 } },
    ],
    [
      'a provider currency that differs from ours, so the mismatch can be seen',
      { ...event, currency: 'EUR' },
    ],
  ])('accepts %s', (_name, row) => {
    expect(ProviderEventSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    ['an amount with no currency', { currency: null }],
    ['a currency with no amount', { amountMinor: null }],
    [
      'a processed time before the received time',
      { processedAt: new Date('2026-11-01T11:00:00Z') },
    ],
    ['an unknown event type', { type: 'payment.refunded' }],
    ['a blank event id', { providerEventId: '' }],
    ['an event id over 255 characters', { providerEventId: 'e'.repeat(256) }],
    [
      'more handling tries than the cap',
      { attempts: paymentLimits.maxEventAttempts + 1 },
    ],
    ['a last error over 500 characters', { lastError: 'e'.repeat(501) }],
    ['a body that is not an object', { payload: [] }],
    [
      'a body over the byte limit',
      { payload: { text: 'x'.repeat(paymentLimits.payloadBytes) } },
    ],
    [
      'a body with a character Postgres cannot store',
      { payload: { text: 'a\u0000b' } },
    ],
    [
      'a small body of 1000 numbers that jsonb would store as 300 digits each',
      {
        payload: Object.fromEntries(
          Array.from({ length: 1000 }, (_, i) => [`k${String(i)}`, 1e-300]),
        ),
      },
    ],
    [
      'a number that needs an exponent, nested',
      { payload: { a: [{ b: 1e21 }] } },
    ],
    [
      'a 130,000-element array, without throwing',
      { payload: { data: new Array<number>(130_000).fill(1) } },
    ],
  ])('refuses %s', (_name, change) => {
    expect(ProviderEventSchema.safeParse({ ...event, ...change }).success).toBe(
      false,
    );
  });
});
