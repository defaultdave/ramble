import { describe, expect, it } from 'vitest';
import { orderStatuses, type OrderStatus } from './orders';
import {
  OrderStatusInputSchema,
  maxPollAttempts,
  orderStatusState,
  pollDelayMs,
  pollStep,
  type OrderStatusState,
} from './orderStatus';

// Behaviours under test, one per decision, branch, or risk.
// - every order status folds into one answer; only a pending payment is pending
// - the poll delay grows, never shrinks, stops growing at a ceiling, and ends at the cap
// - a bad attempt number gets no poll
// - the poller asks again after a pending answer or a lost one, and shows the page for every other answer
// - the action's input takes a reference and a token of the right shape and nothing else

describe('orderStatusState', () => {
  const expected: Record<OrderStatus, OrderStatusState> = {
    pending_payment: 'pending',
    confirmed: 'confirmed',
    payment_failed: 'failed',
    refunded_after_lapse: 'refunded_after_lapse',
    void: 'closed',
    cancelled: 'closed',
  };

  it.each(orderStatuses)('answers for %s', (status) => {
    expect(orderStatusState(status)).toBe(expected[status]);
  });

  it('refuses a status it does not know', () => {
    expect(() => orderStatusState('lost' as OrderStatus)).toThrow(RangeError);
  });
});

describe('pollDelayMs', () => {
  const delays = Array.from({ length: maxPollAttempts }, (_, attempt) =>
    pollDelayMs(attempt),
  );

  it('grows, never shrinks, and settles at a ceiling', () => {
    const numbers = delays.map((delay) => delay ?? Number.NaN);
    expect(numbers.every((delay) => delay > 0)).toBe(true);
    expect(numbers).toEqual([...numbers].sort((a, b) => a - b));
    expect(numbers.at(-1)).toBe(numbers.at(-2));
    expect(numbers[0]).toBeLessThan(numbers.at(-1) ?? 0);
  });

  it('keeps the whole run to a few minutes', () => {
    const total = delays.reduce<number>((sum, delay) => sum + (delay ?? 0), 0);
    expect(total).toBeLessThanOrEqual(5 * 60 * 1000);
  });

  it.each([maxPollAttempts, maxPollAttempts + 1, -1, 1.5, Number.NaN])(
    'gives no poll for attempt %s',
    (attempt) => {
      expect(pollDelayMs(attempt)).toBeNull();
    },
  );
});

describe('pollStep', () => {
  it.each([
    ['a pending order', { state: 'pending' }, 'again'],
    ['a lost answer', 'error', 'again'],
    ['a confirmed order', { state: 'confirmed' }, 'show'],
    ['a failed payment', { state: 'failed' }, 'show'],
    ['a refund after a lapse', { state: 'refunded_after_lapse' }, 'show'],
    ['a closed order', { state: 'closed' }, 'show'],
    ['a refused token', { state: 'unknown' }, 'show'],
  ] as const)('after %s: %s', (_name, result, expected) => {
    expect(pollStep(result)).toBe(expected);
  });
});

describe('OrderStatusInputSchema', () => {
  const good = { reference: 'RMB-A3K7MN', token: 'A'.repeat(43) };

  it('takes a reference and a token', () => {
    expect(OrderStatusInputSchema.safeParse(good).success).toBe(true);
  });

  it.each([
    ['a reference that is not one', { ...good, reference: 'sample' }],
    ['a token of the wrong shape', { ...good, token: 'short' }],
    ['a missing token', { reference: good.reference }],
    ['an extra field', { ...good, orderId: 'x' }],
  ])('refuses %s', (_name, input) => {
    expect(OrderStatusInputSchema.safeParse(input).success).toBe(false);
  });
});
