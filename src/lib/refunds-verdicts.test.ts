import { describe, expect, it } from 'vitest';
import { paymentLimits } from './payments';
import { commissionMinor } from './pricing';
import {
  attemptReadLimit,
  handsOverProviderEvents,
  planRefund,
  providerRefundIdAction,
  refundCashPostIsFirst,
  refundEventAction,
  refundEventRoute,
  refundIdFromDigest,
  refundRequestVerdict,
  refundToSend,
  splitRefund,
  totalsAfterRequest,
  type RefundableOrder,
  type RefundEventAction,
} from './refunds';
import { id } from '../../tests/support/ids';

// Behaviours under test, one per decision, branch, or risk:
// - the tax cap in splitRefund: earlier half-up roundings can already have used the tax before the last refund, so a
//   refund in the middle of a sequence never takes more than remains; checked on the witness (ticket 6, tax 3), on the
//   sequence of 1-minor refunds, and on many small orders, where the tax taken never passes the tax at any step
// - the refund id made from a digest: version 5 layout, variant bits, lower-case hex only, stable
// - the read limit for an order's attempts
// - refundRequestVerdict: the order of its checks (no order, a repeat, no payment, the plan) and what each answers
// - refundToSend (send, skip, invalid), providerRefundIdAction (keep, record, conflict), when events are handed over,
//   and the cash posting rule
// - refundEventAction with no refund, and the route an action takes (retry or finish)

function orderOf(
  subtotal: number,
  tax: number,
  over: Partial<RefundableOrder> = {},
): RefundableOrder {
  return {
    status: 'confirmed',
    ticketSubtotalMinor: subtotal,
    taxMinor: tax,
    totalMinor: subtotal + tax,
    amountDueMinor: subtotal + tax,
    commissionMinor: commissionMinor(subtotal, 1_500),
    commissionRateBps: 1_500,
    refundedTicketMinor: 0,
    refundedTaxMinor: 0,
    commissionReturnedMinor: 0,
    ...over,
  };
}

describe('the tax cap in splitRefund', () => {
  it('takes no tax when earlier rounding used it all: ticket 6, tax 3, 3 refunded, refund 1', () => {
    const order = orderOf(6, 3, {
      refundedTicketMinor: 3,
      refundedTaxMinor: 3,
      commissionReturnedMinor: 1,
    });

    expect(splitRefund(order, 1)).toMatchObject({
      ticketMinor: 1,
      taxMinor: 0,
    });
    expect(planRefund(order, 1)).toMatchObject({
      status: 'planned',
      split: { taxMinor: 0 },
    });
  });

  it('takes the tax that remains, and no more, when the rounding would pass it', () => {
    const order = orderOf(6, 3, {
      refundedTicketMinor: 2,
      refundedTaxMinor: 2,
      commissionReturnedMinor: 0,
    });
    // The share of 1 in 6 of the tax of 3 is 0.5, which rounds up to 1: one left, one taken.
    expect(splitRefund(order, 1).taxMinor).toBe(1);
    const almost = { ...order, refundedTaxMinor: 3 };
    expect(splitRefund(almost, 1).taxMinor).toBe(0);
  });

  it('refunds ticket 6, tax 3 in six parts of 1 and takes 1, 1, 1, 0, 0, 0', () => {
    let order = orderOf(6, 3);
    const taxes: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      const plan = planRefund(order, 1);
      if (plan.status !== 'planned') throw new Error('not planned');
      taxes.push(plan.split.taxMinor);
      order = { ...order, ...totalsAfterRequest(order, plan.split) };
    }
    expect(taxes).toEqual([1, 1, 1, 0, 0, 0]);
    expect(order.refundedTaxMinor).toBe(3);
  });

  it('never takes more tax than the order has at any step of many small refunds', () => {
    for (let subtotal = 1; subtotal <= 40; subtotal += 1) {
      for (let tax = 0; tax <= subtotal; tax += 1) {
        let order = orderOf(subtotal, tax);
        for (let step = 0; step < subtotal; step += 1) {
          const split = splitRefund(order, 1);
          order = { ...order, ...totalsAfterRequest(order, split) };
          expect(
            order.refundedTaxMinor,
            `subtotal ${String(subtotal)} tax ${String(tax)} step ${String(step)}`,
          ).toBeLessThanOrEqual(tax);
        }
        expect(order.refundedTaxMinor).toBe(tax);
      }
    }
  });
});

describe('refundIdFromDigest', () => {
  const digest = 'ab'.repeat(32);

  it('lays the digest out as a version 5 UUID with a variant of 8 to b', () => {
    expect(refundIdFromDigest(digest)).toBe(
      'abababab-abab-5bab-abab-abababababab',
    );
    for (const nibble of '0123456789abcdef') {
      expect(
        refundIdFromDigest(`${'0'.repeat(16)}${nibble}${'1'.repeat(47)}`),
      ).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    }
  });

  it('is stable, and a different digest is a different id', () => {
    expect(refundIdFromDigest(digest)).toBe(refundIdFromDigest(digest));
    expect(refundIdFromDigest('cd'.repeat(32))).not.toBe(
      refundIdFromDigest(digest),
    );
  });

  it('reads one more attempt than an order can have', () => {
    expect(attemptReadLimit).toBe(paymentLimits.maxAttemptNo + 1);
  });
});

describe('refundRequestVerdict', () => {
  const order = orderOf(13_000, 0);
  const attempts = [{ status: 'succeeded', providerPaymentId: 'pay_1' }];
  const verdict = (
    over: Partial<Parameters<typeof refundRequestVerdict>[0]> = {},
  ) =>
    refundRequestVerdict({
      request: { ticketMinor: 'remaining' },
      order,
      existing: null,
      attempts,
      ...over,
    });

  it('refuses a request for an order that does not exist, before anything else', () => {
    expect(
      verdict({ order: null, existing: { ticketMinor: 1 }, attempts: [] }),
    ).toEqual({
      kind: 'refused',
      reason: 'order_not_found',
      remainingTicketMinor: null,
    });
  });

  it.each([
    ['the same ticket part', 6_500, 'already_requested'],
    ['`remaining`', 'remaining', 'already_requested'],
    ['another ticket part', 6_501, 'request_changed'],
  ] as const)(
    'answers a repeat asking for %s as %s',
    (_name, ticketMinor, answer) => {
      const result = verdict({
        request: { ticketMinor },
        existing: { ticketMinor: 6_500 },
        attempts: [],
      });
      expect(result.kind).toBe(
        answer === 'request_changed' ? 'refused' : answer,
      );
      if (result.kind === 'refused') expect(result.reason).toBe(answer);
    },
  );

  it('refuses when the order has no one succeeded payment', () => {
    expect(verdict({ attempts: [] })).toMatchObject({
      kind: 'refused',
      reason: 'no_payment',
    });
  });

  it('passes the plan refusals on with what remains', () => {
    expect(verdict({ request: { ticketMinor: 13_001 } })).toEqual({
      kind: 'refused',
      reason: 'exceeds_remaining',
      remainingTicketMinor: 13_000,
    });
  });

  it('plans with the attempt to refund', () => {
    expect(verdict({ request: { ticketMinor: 6_500 } })).toMatchObject({
      kind: 'planned',
      split: { ticketMinor: 6_500 },
      attempt: { providerPaymentId: 'pay_1' },
    });
  });
});

describe('what the refund job and its events do', () => {
  const refund = {
    id: id(1),
    orderId: id(2),
    status: 'pending',
    providerKey: `refund:${id(1)}`,
    amountMinor: 500,
  } as const;

  it('sends a pending refund with the payment it goes back to', () => {
    expect(refundToSend(refund, 'pay_1')).toEqual({
      kind: 'send',
      refundId: id(1),
      orderId: id(2),
      providerKey: `refund:${id(1)}`,
      amountMinor: 500,
      providerPaymentId: 'pay_1',
    });
  });

  it.each(['succeeded', 'failed', 'gift_reinstated'] as const)(
    'skips a refund that is %s, even with no payment',
    (status) => {
      expect(refundToSend({ ...refund, status }, null)).toEqual({
        kind: 'skip',
      });
    },
  );

  it('calls a pending refund with no payment invalid', () => {
    expect(refundToSend(refund, null)).toEqual({ kind: 'invalid' });
  });

  it.each([
    [null, 're_1', 'record'],
    ['re_1', 're_1', 'keep'],
    ['re_1', 're_2', 'conflict'],
  ] as const)(
    'with %s kept and %s arriving, the provider id is %s',
    (kept, incoming, action) => {
      expect(providerRefundIdAction(kept, incoming)).toBe(action);
    },
  );

  it('hands over the events of the fake and no other provider', () => {
    expect(handsOverProviderEvents('fake')).toBe(true);
    expect(handsOverProviderEvents('stripe')).toBe(false);
  });

  it('accepts a cash post that is the first, and refuses one that was posted before', () => {
    expect(refundCashPostIsFirst('posted')).toBe(true);
    expect(refundCashPostIsFirst('already_posted')).toBe(false);
  });

  it('finds no refund unmatched, whatever the event says', () => {
    expect(
      refundEventAction(
        {
          type: 'refund.succeeded',
          objectId: 're_1',
          amountMinor: 500,
          orderId: id(2),
          recordId: id(1),
        },
        null,
      ),
    ).toEqual({ kind: 'unmatched' });
  });

  it.each([
    [{ kind: 'unmatched' }, 'retry'],
    [{ kind: 'conflict' }, 'retry'],
    [{ kind: 'noop' }, 'finish'],
    [{ kind: 'succeed' }, 'finish'],
    [{ kind: 'fail' }, 'finish'],
  ] as [RefundEventAction, string][])('routes %j to %s', (action, route) => {
    expect(refundEventRoute(action)).toBe(route);
  });
});
