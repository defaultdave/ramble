import { describe, expect, it } from 'vitest';
import {
  isRefundEventType,
  refundEventAction,
  refundableAttempt,
  requireRefundTransition,
  type RefundEventFacts,
} from './refunds';
import { id } from '../../tests/support/ids';

// Behaviours under test, one per decision, branch, or risk:
// - the one attempt a refund goes back to: none, only attempts that did not succeed, two, or one with no provider payment is no answer
// - the refund event table: a pending refund succeeds or fails; a repeat is a no-op; an event that contradicts a finished
//   refund, names another amount, another provider id, or a reinstated gift is a conflict; another record or order is unmatched
// - the event types, and the refund transition guard

describe('refundableAttempt', () => {
  const attempt = (status: string, providerPaymentId: string | null) => ({
    status,
    providerPaymentId,
  });

  it.each([
    ['no attempt', []],
    [
      'only attempts that did not succeed',
      [attempt('canceled', 'pay_1'), attempt('failed_try', 'pay_2')],
    ],
    [
      'two succeeded attempts',
      [attempt('succeeded', 'pay_1'), attempt('succeeded', 'pay_2')],
    ],
    [
      'a succeeded attempt with no provider payment',
      [attempt('succeeded', null)],
    ],
  ])('is none for %s', (_name, attempts) => {
    expect(refundableAttempt(attempts)).toBeNull();
  });

  it('is the one succeeded attempt among the others', () => {
    expect(
      refundableAttempt([
        attempt('canceled', 'pay_1'),
        attempt('succeeded', 'pay_2'),
      ]),
    ).toEqual(attempt('succeeded', 'pay_2'));
  });
});

describe('refundEventAction', () => {
  type Row = Parameters<typeof refundEventAction>[1];
  const refund: Row = {
    id: id(5),
    orderId: id(6),
    status: 'pending',
    amountMinor: 9_255,
    providerRefundId: null,
  };
  const event = (over: Partial<RefundEventFacts> = {}): RefundEventFacts => ({
    type: 'refund.succeeded',
    objectId: 're_1',
    amountMinor: 9_255,
    orderId: id(6),
    recordId: id(5),
    ...over,
  });

  const cases: [string, RefundEventFacts, Row, string][] = [
    ['succeeds a pending refund', event(), refund, 'succeed'],
    [
      'fails a pending refund',
      event({ type: 'refund.failed' }),
      refund,
      'fail',
    ],
    [
      'fails a pending refund whose failure carries no amount',
      event({ type: 'refund.failed', amountMinor: null }),
      refund,
      'fail',
    ],
    [
      'succeeds a pending refund whose id is already kept',
      event(),
      { ...refund, providerRefundId: 're_1' },
      'succeed',
    ],
    [
      'ignores a repeat of a success',
      event(),
      { ...refund, status: 'succeeded' },
      'noop',
    ],
    [
      'ignores a repeat of a failure',
      event({ type: 'refund.failed' }),
      { ...refund, status: 'failed' },
      'noop',
    ],
    [
      'refuses a failure after a success',
      event({ type: 'refund.failed' }),
      { ...refund, status: 'succeeded' },
      'conflict',
    ],
    [
      'refuses a success after a failure',
      event(),
      { ...refund, status: 'failed' },
      'conflict',
    ],
    [
      'refuses an event for a reinstated gift',
      event(),
      { ...refund, status: 'gift_reinstated' },
      'conflict',
    ],
    [
      'refuses a success of another amount',
      event({ amountMinor: 9_254 }),
      refund,
      'conflict',
    ],
    [
      'refuses a success with no amount',
      event({ amountMinor: null }),
      refund,
      'conflict',
    ],
    [
      'refuses a failure of another amount',
      event({ type: 'refund.failed', amountMinor: 1 }),
      refund,
      'conflict',
    ],
    [
      'refuses another provider refund',
      event({ objectId: 're_2' }),
      { ...refund, providerRefundId: 're_1' },
      'conflict',
    ],
    [
      'does not match another refund record',
      event({ recordId: id(7) }),
      refund,
      'unmatched',
    ],
    [
      'does not match another order',
      event({ orderId: id(8) }),
      refund,
      'unmatched',
    ],
    [
      'does not match an event with no order',
      event({ orderId: null }),
      refund,
      'unmatched',
    ],
    [
      'does not match an event with no record',
      event({ recordId: null }),
      refund,
      'unmatched',
    ],
  ];

  it.each(cases)('%s', (_name, facts, row, kind) => {
    expect(refundEventAction(facts, row).kind).toBe(kind);
  });

  it('knows the refund event types', () => {
    expect(isRefundEventType('refund.succeeded')).toBe(true);
    expect(isRefundEventType('refund.failed')).toBe(true);
    expect(isRefundEventType('payment.succeeded')).toBe(false);
  });

  it('moves a refund only along its table', () => {
    expect(() => {
      requireRefundTransition('pending', 'succeeded');
    }).not.toThrow();
    expect(() => {
      requireRefundTransition('succeeded', 'failed');
    }).toThrow();
  });
});
