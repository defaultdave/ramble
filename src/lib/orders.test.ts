import { describe, expect, it } from 'vitest';
import {
  OrderItemSchema,
  OrderSchema,
  bookingIdempotencyKey,
  canOrderTransition,
  isGiftPurchaseKey,
  isOrderReference,
  orderAmountDueMinor,
  orderInitialStatuses,
  orderStatuses,
  orderTransitions,
  type Order,
  type OrderStatus,
} from './orders';
import { isTerminal } from './transitions';

// Behaviours under test, one per decision, branch or risk.
// - reference: RMB- plus six Crockford characters, nothing else, bounded before the pattern runs
// - keys: a booking key is book: and the hold id in lower case; a gift purchase key is a lower-case uuid
// - transitions: exactly the design doc table, terminal states never change, a void order can still confirm
// - money: tax and commission round half up on integers, amount due never below zero
// - OrderSchema: a valid booking and a valid gift purchase pass; each row rule refuses its bad row
// - OrderItemSchema: bounds on quantity and price, and the line total

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const holdId = id(10);
const created = new Date('2026-11-01T12:00:00Z');
const later = new Date('2026-11-01T12:05:00Z');

const booking: Order = {
  id: id(1),
  reference: 'RMB-7K3M9Q',
  kind: 'booking',
  status: 'pending_payment',
  idempotencyKey: `book:${holdId}`,
  holdId,
  sessionId: id(11),
  experienceId: id(12),
  hostId: id(13),
  giftId: null,
  guestId: id(14),
  contactEmail: 'pat@example.com',
  contactPhone: null,
  leadGuestName: 'Pat Smith',
  ageConfirmed: null,
  childrenAges: null,
  guardianName: null,
  guardianContact: null,
  waiverDocumentId: null,
  termsDocumentId: id(15),
  currency: 'USD',
  ticketSubtotalMinor: 17000,
  taxTreatment: 'taxable',
  taxRatePpm: 88750,
  taxMinor: 1509,
  totalMinor: 18509,
  giftAppliedMinor: 0,
  amountDueMinor: 18509,
  commissionRateBps: 1500,
  commissionMinor: 2550,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  refundFailed: false,
  cancellationTierId: id(16),
  freeCancelUntil: null,
  cancelledBy: null,
  attributionSource: null,
  attributionCampaign: null,
  attributionIssue: null,
  manageTokenHash: null,
  manageTokenVersion: 1,
  synthetic: false,
  createdAt: created,
  confirmedAt: null,
  cancelledAt: null,
};

const giftPurchase: Order = {
  ...booking,
  kind: 'gift_purchase',
  idempotencyKey: id(20),
  holdId: null,
  sessionId: null,
  leadGuestName: null,
};

const confirmed: Order = {
  ...booking,
  status: 'confirmed',
  confirmedAt: later,
};

function refusedAt(order: unknown): string[] {
  const result = OrderSchema.safeParse(order);
  return result.success
    ? []
    : result.error.issues.map((issue) => issue.path.join('.'));
}

describe('order reference', () => {
  it.each(['RMB-000000', 'RMB-ZZZZZZ', 'RMB-7K3M9Q', 'RMB-ABCDEF'])(
    'accepts %s',
    (value) => {
      expect(isOrderReference(value)).toBe(true);
    },
  );

  it.each([
    ['lower case', 'rmb-7k3m9q'],
    ['a letter Crockford leaves out (I)', 'RMB-I00000'],
    ['a letter Crockford leaves out (L)', 'RMB-L00000'],
    ['a letter Crockford leaves out (O)', 'RMB-O00000'],
    ['a letter Crockford leaves out (U)', 'RMB-U00000'],
    ['five characters', 'RMB-7K3M9'],
    ['seven characters', 'RMB-7K3M9QQ'],
    ['no prefix', '7K3M9Q'],
    ['a trailing newline', 'RMB-7K3M9Q\n'],
    ['an unbounded string', `RMB-${'7'.repeat(100_000)}`],
  ])('refuses %s', (_name, value) => {
    expect(isOrderReference(value)).toBe(false);
  });
});

describe('idempotency keys', () => {
  it('derives a booking key from the hold, in lower case', () => {
    expect(bookingIdempotencyKey(holdId.toUpperCase())).toBe(`book:${holdId}`);
  });

  it.each([
    ['a lower-case uuid', id(20), true],
    ['an upper-case uuid', '0A0A0A0A-0000-4000-8000-00000000000A', false],
    ['a booking key', `book:${holdId}`, false],
    ['empty', '', false],
  ])('judges a gift purchase key that is %s', (_name, key, expected) => {
    expect(isGiftPurchaseKey(key)).toBe(expected);
  });
});

describe('order transitions', () => {
  const allowed: [OrderStatus, OrderStatus][] = [
    ['pending_payment', 'confirmed'],
    ['pending_payment', 'payment_failed'],
    ['pending_payment', 'void'],
    ['pending_payment', 'refunded_after_lapse'],
    ['payment_failed', 'pending_payment'],
    ['payment_failed', 'confirmed'],
    ['payment_failed', 'void'],
    ['payment_failed', 'refunded_after_lapse'],
    ['void', 'confirmed'],
    ['void', 'refunded_after_lapse'],
    ['confirmed', 'cancelled'],
  ];

  it.each(allowed)('allows %s to %s', (from, to) => {
    expect(canOrderTransition(from, to)).toBe(true);
  });

  it('refuses every other pair', () => {
    const refused = orderStatuses.flatMap((from) =>
      orderStatuses
        .filter((to) => !canOrderTransition(from, to))
        .map((to) => `${from}>${to}`),
    );
    expect(refused).toHaveLength(
      orderStatuses.length * orderStatuses.length - allowed.length,
    );
  });

  it.each(['cancelled', 'refunded_after_lapse'] as const)(
    '%s is terminal: it never changes',
    (status) => {
      expect(isTerminal(orderTransitions, status)).toBe(true);
      for (const to of orderStatuses) {
        expect(canOrderTransition(status, to)).toBe(false);
      }
    },
  );

  it('keeps void open, because a late payment still lands', () => {
    expect(isTerminal(orderTransitions, 'void')).toBe(false);
  });

  it('starts an order pending or, for a redemption with nothing due, confirmed', () => {
    expect(orderInitialStatuses).toEqual(['pending_payment', 'confirmed']);
  });
});

describe('order money', () => {
  it.each([
    [18509, 0, 18509],
    [18509, 5000, 13509],
    [18509, 18509, 0],
    [100, 500, 0],
  ])('amount due of %i with %i gift applied is %i', (total, gift, expected) => {
    expect(orderAmountDueMinor(total, gift)).toBe(expected);
  });
});

describe('OrderSchema', () => {
  it.each([
    ['a booking', booking],
    ['a confirmed booking', confirmed],
    ['a gift purchase', giftPurchase],
    [
      'a cancelled booking',
      {
        ...confirmed,
        status: 'cancelled',
        cancelledAt: later,
        cancelledBy: 'guest',
      },
    ],
    [
      'a not-taxable booking',
      {
        ...booking,
        taxTreatment: 'not_taxable',
        taxRatePpm: 0,
        taxMinor: 0,
        totalMinor: 17000,
        amountDueMinor: 17000,
      },
    ],
    [
      'a booking paid partly by a gift',
      {
        ...booking,
        giftId: id(30),
        giftAppliedMinor: 5000,
        amountDueMinor: 13509,
      },
    ],
    [
      'a booking with children and a guardian',
      {
        ...booking,
        childrenAges: [4, 9],
        guardianName: 'Pat',
        guardianContact: '555 0100',
      },
    ],
    [
      'a confirmed booking with a manage hash',
      { ...confirmed, manageTokenHash: 'a'.repeat(64) },
    ],
  ])('accepts %s', (_name, order) => {
    expect(OrderSchema.safeParse(order).success).toBe(true);
  });

  it.each([
    [
      'a total that is not subtotal plus tax',
      { totalMinor: 18510, amountDueMinor: 18510 },
      'totalMinor',
    ],
    [
      'a tax that is not the rounded rate',
      { taxMinor: 1508, totalMinor: 18508, amountDueMinor: 18508 },
      'taxMinor',
    ],
    [
      'a tax rate on a not-taxable order',
      { taxTreatment: 'not_taxable' },
      'taxRatePpm',
    ],
    [
      'an amount due that is not the total less the gift',
      { giftId: id(30), giftAppliedMinor: 1000, amountDueMinor: 18509 },
      'amountDueMinor',
    ],
    [
      'a gift applied above the total',
      { giftId: id(30), giftAppliedMinor: 18510, amountDueMinor: 0 },
      'amountDueMinor',
    ],
    [
      'a gift applied with no gift',
      { giftAppliedMinor: 1000, amountDueMinor: 17509 },
      'giftId',
    ],
    [
      'a commission that is not the rounded rate',
      { commissionMinor: 2549 },
      'commissionMinor',
    ],
    [
      'tickets refunded above the subtotal',
      { refundedTicketMinor: 17001 },
      'refundedTicketMinor',
    ],
    [
      'tax refunded above the tax',
      { refundedTaxMinor: 1510 },
      'refundedTaxMinor',
    ],
    [
      'commission returned above the commission',
      { commissionReturnedMinor: 2551 },
      'commissionReturnedMinor',
    ],
    ['a booking with no hold', { holdId: null }, 'holdId'],
    ['a booking with no session', { sessionId: null }, 'sessionId'],
    ['a booking with no lead guest', { leadGuestName: null }, 'leadGuestName'],
    [
      'a booking key that is not from its hold',
      { idempotencyKey: id(20) },
      'idempotencyKey',
    ],
    ['a currency other than USD', { currency: 'EUR' }, 'currency'],
    ['children with no guardian', { childrenAges: [4] }, 'guardianName'],
    [
      'a guardian name with no contact',
      { guardianName: 'Pat' },
      'guardianContact',
    ],
    [
      'a child older than 17',
      { childrenAges: [18], guardianName: 'Pat', guardianContact: 'x' },
      'childrenAges.0',
    ],
    ['a malformed manage hash', { manageTokenHash: 'ABC' }, 'manageTokenHash'],
    ['a malformed reference', { reference: 'RMB-ILOU00' }, 'reference'],
    [
      'a confirmed order with no confirmed time',
      { status: 'confirmed' },
      'confirmedAt',
    ],
    [
      'a confirmed time on a pending order',
      { confirmedAt: later },
      'confirmedAt',
    ],
    [
      'a cancelled order with no cancel time',
      { status: 'cancelled', confirmedAt: later, cancelledBy: 'guest' },
      'cancelledAt',
    ],
    [
      'a cancelled order with no canceller',
      { status: 'cancelled', confirmedAt: later, cancelledAt: later },
      'cancelledBy',
    ],
    [
      'a canceller on an order that is not cancelled',
      { cancelledBy: 'guest' },
      'cancelledBy',
    ],
    [
      'a confirmed time before the created time',
      { status: 'confirmed', confirmedAt: new Date('2026-11-01T11:00:00Z') },
      'confirmedAt',
    ],
    ['a token version of 0', { manageTokenVersion: 0 }, 'manageTokenVersion'],
  ])('refuses %s', (_name, change, path) => {
    expect(refusedAt({ ...booking, ...change })).toContain(path);
  });

  it.each([
    ['a gift purchase with a hold', { holdId }, 'holdId'],
    [
      'a gift purchase with a booking key',
      { idempotencyKey: `book:${holdId}` },
      'idempotencyKey',
    ],
    [
      'a gift purchase that applies a gift',
      { giftId: id(30), giftAppliedMinor: 1000, amountDueMinor: 17509 },
      'giftAppliedMinor',
    ],
  ])('refuses %s', (_name, change, path) => {
    expect(refusedAt({ ...giftPurchase, ...change })).toContain(path);
  });

  it('does not stack money issues on a value that is not an integer', () => {
    expect(refusedAt({ ...booking, ticketSubtotalMinor: 1.5 })).toEqual([
      'ticketSubtotalMinor',
    ]);
  });
});

describe('OrderItemSchema', () => {
  const item = {
    orderId: id(1),
    priceOptionId: id(40),
    label: 'Adult',
    quantity: 2,
    unitPriceMinor: 8500,
    usesSpace: true,
    lineTotalMinor: 17000,
  };

  it('accepts a priced line', () => {
    expect(OrderItemSchema.safeParse(item).success).toBe(true);
  });

  it.each([
    ['a quantity of 0', { quantity: 0, lineTotalMinor: 0 }],
    ['a quantity above the cap', { quantity: 101, lineTotalMinor: 858_500 }],
    ['a negative price', { unitPriceMinor: -1, lineTotalMinor: -2 }],
    [
      'a price above the cap',
      { unitPriceMinor: 10_000_001, lineTotalMinor: 20_000_002 },
    ],
    [
      'a line total that is not quantity times price',
      { lineTotalMinor: 17001 },
    ],
    ['a blank label', { label: '  ' }],
    ['a label over 80 characters', { label: 'a'.repeat(81) }],
  ])('refuses %s', (_name, change) => {
    expect(OrderItemSchema.safeParse({ ...item, ...change }).success).toBe(
      false,
    );
  });
});
