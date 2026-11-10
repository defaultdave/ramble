import { describe, expect, it } from 'vitest';
import {
  ProcessRefundPayloadSchema,
  RefundRequestSchema,
  isRefundableOrderStatus,
  orderRefundReasons,
  planRefund,
  processRefundDedupeKey,
  refundRequestIdentity,
  refundsReconcile,
  repeatsRequest,
  splitRefund,
  totalsAfterFailure,
  totalsAfterRequest,
  type RefundableOrder,
} from './refunds';
import { commissionMinor, taxMinor } from './pricing';
import { orderStatuses } from './orders';
import { id } from '../../tests/support/ids';

// Behaviours under test, one per decision, branch, or risk:
// - splitRefund: tax follows the ticket and rounds half up; the refund that takes the ticket to zero takes the exact tax
//   remainder; commission is recalculated on what the host keeps, so a full refund returns exactly the commission charged,
//   in one refund or in several; a ticket part the order cannot give back, and totals that do not add up, throw
// - planRefund: only orders that took cash are refundable; nothing left, more than remains, and more than the card paid
//   are typed refusals; `remaining` means everything the ticket still holds
// - the totals after a request and after a failure; a failure cannot give back more than was refunded
// - refundsReconcile over seeded random orders: after any sequence of refunds, failures included, the standing refunds
//   sum to the order's totals, never pass total_minor, and a full refund ends with exactly the commission charged
// - the request schema (reasons, key, ticket part, ids lower-cased) and the identity a repeat is recognised by
//   (the attempt a refund goes back to and the provider's events are in refunds-events.test.ts)

const worked: RefundableOrder = {
  status: 'confirmed',
  ticketSubtotalMinor: 13_000,
  taxMinor: 0,
  totalMinor: 13_000,
  amountDueMinor: 13_000,
  commissionMinor: 1_950,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
};

const taxable: RefundableOrder = {
  ...worked,
  ticketSubtotalMinor: 17_000,
  taxMinor: 1_509,
  totalMinor: 18_509,
  amountDueMinor: 18_509,
  commissionMinor: 2_550,
};

describe('splitRefund', () => {
  it('splits half of a non-taxable booking: no tax, half the commission, the rest to the host', () => {
    expect(splitRefund(worked, 6_500)).toEqual({
      ticketMinor: 6_500,
      taxMinor: 0,
      commissionReturnedMinor: 975,
      hostShareMinor: 5_525,
      amountMinor: 6_500,
    });
  });

  it('rounds the tax half up: half of $170 at 8.875 percent is 754.5 cents, so 755', () => {
    expect(splitRefund(taxable, 8_500)).toMatchObject({
      taxMinor: 755,
      commissionReturnedMinor: 1_275,
      amountMinor: 9_255,
    });
  });

  it.each([
    ['one refund', [17_000]],
    ['two halves', [8_500, 8_500]],
    ['three uneven parts', [1, 9_999, 7_000]],
  ])(
    'a full refund in %s returns exactly the tax and the commission charged',
    (_name, parts) => {
      let order = taxable;
      let tax = 0;
      let commission = 0;
      for (const part of parts) {
        const split = splitRefund(order, part);
        tax += split.taxMinor;
        commission += split.commissionReturnedMinor;
        order = { ...order, ...totalsAfterRequest(order, split) };
      }
      expect(tax).toBe(taxable.taxMinor);
      expect(commission).toBe(taxable.commissionMinor);
      expect(order.refundedTicketMinor).toBe(taxable.ticketSubtotalMinor);
    },
  );

  it('takes the exact tax remainder in the refund that finishes the ticket, not a rounded share', () => {
    const order = {
      ...taxable,
      refundedTicketMinor: 16_999,
      refundedTaxMinor: 1_508,
      commissionReturnedMinor: 2_550 - commissionMinor(1, 1_500),
    };
    expect(splitRefund(order, 1)).toMatchObject({
      taxMinor: 1,
      ticketMinor: 1,
    });
  });

  it.each([
    ['zero', 0],
    ['negative', -1],
    ['a fraction', 1.5],
    ['more than remains', 17_001],
    ['not a number', Number.NaN],
  ])('refuses a ticket part that is %s', (_name, part) => {
    expect(() => splitRefund(taxable, part)).toThrow(RangeError);
  });

  it.each([
    ['refunded ticket past the subtotal', { refundedTicketMinor: 17_001 }],
    ['negative refunded tax', { refundedTaxMinor: -1 }],
    ['refunded tax past the tax', { refundedTaxMinor: 1_510 }],
    [
      'commission returned past the commission',
      { commissionReturnedMinor: 2_551 },
    ],
    ['a total that is not subtotal plus tax', { totalMinor: 1 }],
  ])('throws on an order with %s', (_name, over) => {
    expect(() => splitRefund({ ...taxable, ...over }, 100)).toThrow(RangeError);
  });

  it('throws when earlier returns leave the commission above the ticket part, never repairing it', () => {
    const order = { ...worked, commissionReturnedMinor: 1_950 };
    expect(() => splitRefund(order, 100)).toThrow(RangeError);
  });

  it('holds on the largest order: the ticket times the tax passes 2^53', () => {
    const big: RefundableOrder = {
      ...worked,
      ticketSubtotalMinor: 1_000_000_000,
      taxMinor: 999_999_999,
      totalMinor: 1_999_999_999,
      amountDueMinor: 1_999_999_999,
      commissionMinor: commissionMinor(1_000_000_000, 1_500),
    };
    const split = splitRefund(big, 999_999_999);
    expect(split.taxMinor).toBe(999_999_998);
  });
});

describe('planRefund', () => {
  it.each(orderStatuses)('answers for an order that is %s', (status) => {
    const plan = planRefund({ ...worked, status }, 1_000);
    expect(plan.status).toBe(
      isRefundableOrderStatus(status) ? 'planned' : 'refused',
    );
    if (plan.status === 'refused') {
      expect(plan.reason).toBe('order_not_refundable');
    }
  });

  it('refunds only orders whose cash was taken', () => {
    expect(orderStatuses.filter(isRefundableOrderStatus)).toEqual([
      'confirmed',
      'cancelled',
      'refunded_after_lapse',
    ]);
  });

  it('plans everything the ticket still holds for `remaining`, after an earlier refund', () => {
    const first = splitRefund(taxable, 5_000);
    const order = { ...taxable, ...totalsAfterRequest(taxable, first) };
    const plan = planRefund(order, 'remaining');
    expect(plan).toMatchObject({
      status: 'planned',
      split: {
        ticketMinor: 12_000,
        taxMinor: taxable.taxMinor - first.taxMinor,
        commissionReturnedMinor:
          taxable.commissionMinor - first.commissionReturnedMinor,
      },
    });
  });

  it('refuses a ticket part past what remains and says what remains', () => {
    expect(
      planRefund({ ...worked, refundedTicketMinor: 12_000 }, 1_001),
    ).toEqual({
      status: 'refused',
      reason: 'exceeds_remaining',
      remainingTicketMinor: 1_000,
    });
  });

  it('refuses when every ticket part is already refunded', () => {
    const done = {
      ...worked,
      refundedTicketMinor: 13_000,
      commissionReturnedMinor: 1_950,
    };
    expect(planRefund(done, 'remaining')).toMatchObject({
      reason: 'nothing_left',
      remainingTicketMinor: 0,
    });
  });

  it('refuses more than the card paid when a gift paid part of the order', () => {
    const mixed = { ...worked, giftAppliedMinor: 5_000, amountDueMinor: 8_000 };
    expect(planRefund(mixed, 8_000)).toMatchObject({ status: 'planned' });
    expect(planRefund(mixed, 8_001)).toMatchObject({
      reason: 'exceeds_card_payment',
    });
    expect(planRefund(mixed, 'remaining')).toMatchObject({
      reason: 'exceeds_card_payment',
    });
  });

  it('throws, rather than refuses, for an order whose totals do not add up', () => {
    expect(() => planRefund({ ...worked, totalMinor: 1 }, 100)).toThrow(
      RangeError,
    );
  });
});

describe('the order totals after a refund', () => {
  const split = {
    ticketMinor: 5_000,
    taxMinor: 444,
    commissionReturnedMinor: 750,
  };

  it('adds the parts of a requested refund, and takes them back when it fails', () => {
    const requested = totalsAfterRequest(taxable, split);
    expect(requested).toEqual({
      refundedTicketMinor: 5_000,
      refundedTaxMinor: 444,
      commissionReturnedMinor: 750,
    });
    expect(totalsAfterFailure({ ...taxable, ...requested }, split)).toEqual({
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
      commissionReturnedMinor: 0,
    });
  });

  it('refuses to give back more than the order refunded', () => {
    expect(() => totalsAfterFailure(taxable, split)).toThrow(RangeError);
  });
});

// A small deterministic generator, so a failure names its seed.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 1_664_525 + 1_013_904_223) % 4_294_967_296;
    return state / 4_294_967_296;
  };
}

describe('refundsReconcile', () => {
  const standing = {
    status: 'pending',
    ticketMinor: 1,
    taxMinor: 1,
    commissionReturnedMinor: 0,
  } as const;

  it.each([
    ['ticket', { refundedTicketMinor: 2 }],
    ['tax', { refundedTaxMinor: 2 }],
    ['commission', { commissionReturnedMinor: 1 }],
    ['total', { totalMinor: 1 }],
  ])('is false when the %s does not agree', (_name, over) => {
    const order = {
      totalMinor: 10,
      refundedTicketMinor: 1,
      refundedTaxMinor: 1,
      commissionReturnedMinor: 0,
      ...over,
    };
    expect(refundsReconcile(order, [standing])).toBe(false);
  });

  it('counts every status but failed, and is true when the parts agree', () => {
    const order = {
      totalMinor: 10,
      refundedTicketMinor: 2,
      refundedTaxMinor: 2,
      commissionReturnedMinor: 0,
    };
    const lines = [
      standing,
      { ...standing, status: 'succeeded' as const },
      { ...standing, status: 'failed' as const },
    ];
    expect(refundsReconcile(order, lines)).toBe(true);
  });

  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])(
    'holds after random refunds and failures (seed %i)',
    (seed) => {
      const next = random(seed);
      const subtotal = 100 + Math.floor(next() * 200_000);
      const ratePpm = [0, 88_750, 100_000, 62_500][Math.floor(next() * 4)] ?? 0;
      const tax = taxMinor(subtotal, ratePpm);
      const bps = [0, 1_000, 1_500, 2_500][Math.floor(next() * 4)] ?? 0;
      let order: RefundableOrder = {
        ...worked,
        ticketSubtotalMinor: subtotal,
        taxMinor: tax,
        totalMinor: subtotal + tax,
        amountDueMinor: subtotal + tax,
        commissionMinor: commissionMinor(subtotal, bps),
        commissionRateBps: bps,
      };
      const refunds: {
        status: 'pending' | 'succeeded' | 'failed';
        ticketMinor: number;
        taxMinor: number;
        commissionReturnedMinor: number;
      }[] = [];
      for (let step = 0; step < 40; step += 1) {
        const remaining = order.ticketSubtotalMinor - order.refundedTicketMinor;
        if (remaining === 0) break;
        const ask =
          next() < 0.2 ? 'remaining' : 1 + Math.floor(next() * remaining);
        const plan = planRefund(order, ask);
        if (plan.status === 'refused') continue;
        const { split } = plan;
        order = { ...order, ...totalsAfterRequest(order, split) };
        refunds.push({
          status: next() < 0.5 ? 'succeeded' : 'pending',
          ticketMinor: split.ticketMinor,
          taxMinor: split.taxMinor,
          commissionReturnedMinor: split.commissionReturnedMinor,
        });
        if (next() < 0.25) {
          const last = refunds[refunds.length - 1];
          if (last) {
            order = { ...order, ...totalsAfterFailure(order, last) };
            last.status = 'failed';
          }
        }
        expect(refundsReconcile(order, refunds), `seed ${String(seed)}`).toBe(
          true,
        );
        expect(
          order.refundedTicketMinor + order.refundedTaxMinor,
        ).toBeLessThanOrEqual(order.totalMinor);
      }
      const rest = planRefund(order, 'remaining');
      if (rest.status === 'planned') {
        order = { ...order, ...totalsAfterRequest(order, rest.split) };
        expect(order.refundedTicketMinor).toBe(order.ticketSubtotalMinor);
        expect(order.refundedTaxMinor).toBe(order.taxMinor);
        expect(order.commissionReturnedMinor).toBe(order.commissionMinor);
      }
    },
  );
});

describe('the refund request', () => {
  const valid = {
    orderId: id(1).toUpperCase(),
    reason: 'guest_cancel',
    key: 'cancel',
    ticketMinor: 6_500,
  };

  it('lower-cases ids, and a request from the system has no initiator', () => {
    expect(RefundRequestSchema.parse(valid)).toEqual({
      ...valid,
      orderId: id(1),
      initiatedBy: null,
    });
    expect(
      RefundRequestSchema.parse({ ...valid, initiatedBy: id(2).toUpperCase() })
        .initiatedBy,
    ).toBe(id(2));
  });

  it('accepts `remaining` and every order reason', () => {
    for (const reason of orderRefundReasons) {
      expect(
        RefundRequestSchema.safeParse({
          ...valid,
          reason,
          ticketMinor: 'remaining',
        }).success,
      ).toBe(true);
    }
  });

  it.each([
    ['a gift reason', { reason: 'gift_unredeemed' }],
    ['the duplicate payment reason', { reason: 'duplicate_payment' }],
    ['an unknown reason', { reason: 'because' }],
    ['an empty key', { key: '' }],
    ['a key of 65 characters', { key: 'a'.repeat(65) }],
    ['a key with a space', { key: 'a b' }],
    ['a key that starts with a colon', { key: ':a' }],
    ['a zero ticket part', { ticketMinor: 0 }],
    ['a fractional ticket part', { ticketMinor: 1.5 }],
    ['a ticket part past the largest subtotal', { ticketMinor: 1_000_000_001 }],
    ['a word for the ticket part', { ticketMinor: 'all' }],
    ['an order id that is not a uuid', { orderId: 'nope' }],
    ['an unknown field', { amountMinor: 1 }],
  ])('refuses %s', (_name, over) => {
    expect(RefundRequestSchema.safeParse({ ...valid, ...over }).success).toBe(
      false,
    );
  });

  it('names a refund by its order, reason, and key, and by nothing else', () => {
    const base = RefundRequestSchema.parse(valid);
    expect(refundRequestIdentity(base)).toBe(
      `refund-request:v1:${id(1)}:guest_cancel:cancel`,
    );
    expect(
      refundRequestIdentity({ ...base, ticketMinor: 1 } as typeof base),
    ).toBe(refundRequestIdentity(base));
    expect(refundRequestIdentity({ ...base, key: 'other' })).not.toBe(
      refundRequestIdentity(base),
    );
    expect(refundRequestIdentity({ ...base, reason: 'goodwill' })).not.toBe(
      refundRequestIdentity(base),
    );
  });

  it.each([
    ['the same ticket part', 6_500, true],
    ['`remaining`', 'remaining', true],
    ['a different ticket part', 6_501, false],
  ] as const)(
    '%s repeats a refund of 6500: %s',
    (_name, ticketMinor, expected) => {
      expect(repeatsRequest({ ticketMinor: 6_500 }, { ticketMinor })).toBe(
        expected,
      );
    },
  );

  it('keys the job by the refund, in lower case, and parses its payload strictly', () => {
    expect(processRefundDedupeKey(id(9).toUpperCase())).toBe(
      `process-refund:${id(9)}`,
    );
    expect(
      ProcessRefundPayloadSchema.parse({ refundId: id(9).toUpperCase() }),
    ).toEqual({
      refundId: id(9),
    });
    expect(
      ProcessRefundPayloadSchema.safeParse({ refundId: id(9), x: 1 }).success,
    ).toBe(false);
  });
});
