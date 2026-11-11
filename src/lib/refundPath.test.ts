import { describe, expect, it } from 'vitest';
import { refundPathReasons } from './confirmOrder';
import { holdStatuses } from './holds';
import { orderStatuses } from './orders';
import { afterConfirm } from './providerEvents';
import {
  PaidAfterLapsePayloadSchema,
  isRefundPathBuilt,
  lateRefundPlan,
  paidAfterLapseDedupeKey,
} from './refundPath';

// Behaviours under test, one per decision, branch, or risk:
// - only the session_cancelled refund path is built; every other reason is not
// - a late payment moves an unpaid order (pending, failed, void) to refunded_after_lapse and throws for any order that cannot
// - an open hold is released and one that ended, converted, or is missing is not
// - the confirm step finishes the event after a refund path, and retries it only while the path is unavailable
// - the guest email's payload is an order id, one of the two lapse reasons, and a refund of at least one minor unit
// - one email per order, whatever the case of the id

const id = '5f1b9d4e-8a3c-4c1e-9d2a-7b6f0c3e1a24';

describe('which refund paths are built', () => {
  it.each(refundPathReasons)('%s', (reason) => {
    expect(isRefundPathBuilt(reason)).toBe(reason === 'session_cancelled');
  });
});

describe('what a late payment does to the order', () => {
  it.each(['pending_payment', 'payment_failed', 'void'] as const)(
    'moves a %s order to refunded_after_lapse',
    (orderStatus) => {
      expect(lateRefundPlan({ orderStatus, holdStatus: null })).toMatchObject({
        orderStatus: 'refunded_after_lapse',
      });
    },
  );

  it.each(
    orderStatuses.filter(
      (status) =>
        !['pending_payment', 'payment_failed', 'void'].includes(status),
    ),
  )('throws for a %s order', (orderStatus) => {
    expect(() => lateRefundPlan({ orderStatus, holdStatus: null })).toThrow(
      `does not move from ${orderStatus}`,
    );
  });
});

describe('what a late payment does to the hold', () => {
  it.each([
    ['active', true],
    ['paying', true],
    ['converted', false],
    ['released', false],
    [null, false],
  ] as const)('a %s hold is released: %s', (holdStatus, releases) => {
    expect(
      lateRefundPlan({ orderStatus: 'void', holdStatus }).releaseHold,
    ).toBe(releases);
  });

  it('decides every hold status', () => {
    expect(
      holdStatuses.map(
        (holdStatus) =>
          lateRefundPlan({ orderStatus: 'void', holdStatus }).releaseHold,
      ),
    ).toEqual([true, true, false, false]);
  });
});

describe('after the confirm step', () => {
  it.each([
    ['confirmed', 'finish'],
    ['already_confirmed', 'finish'],
    ['refunded', 'finish'],
    ['unavailable', 'retry'],
  ] as const)('%s means %s', (status, expected) => {
    expect(afterConfirm(status)).toBe(expected);
  });
});

describe('the email payload', () => {
  const payload = { orderId: id, reason: 'session_cancelled', amountMinor: 1 };

  it('takes an order, a lapse reason, and a refund of one minor unit or more', () => {
    expect(PaidAfterLapsePayloadSchema.parse(payload)).toEqual(payload);
    expect(
      PaidAfterLapsePayloadSchema.parse({
        ...payload,
        reason: 'sold_out_after_lapse',
      }).reason,
    ).toBe('sold_out_after_lapse');
  });

  it.each([
    ['no refund', { amountMinor: 0 }],
    ['a refund that is not whole', { amountMinor: 1.5 }],
    ['a reason that is not a lapse', { reason: 'amount_mismatch' }],
    ['an id that is not one', { orderId: 'nope' }],
    ['an extra field', { to: 'pat@example.com' }],
  ])('refuses %s', (_name, over) => {
    expect(
      PaidAfterLapsePayloadSchema.safeParse({ ...payload, ...over }).success,
    ).toBe(false);
  });
});

describe('the email key', () => {
  it('is one per order, in lower case', () => {
    expect(paidAfterLapseDedupeKey(id.toUpperCase())).toBe(
      `guest-paid-after-lapse:${id}`,
    );
  });
});
