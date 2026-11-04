import { describe, expect, it } from 'vitest';
import {
  alreadyConfirmedResult,
  amountDueNow,
  childCount,
  newOrderReference,
  orderFields,
  orderItemRows,
  orderSnapshot,
  orderTokenFor,
  paymentTriesRefusal,
  priceHold,
  spendsPaymentTry,
  requiresPaymentResult,
  statusOnRetry,
  tooManyTries,
  type HeldItem,
  type PaymentTryState,
} from './checkout';
import { OrderItemSchema, OrderSchema, orderStatuses } from './orders';
import { maxFailedTries } from './payments';
import { defaultCommissionRateBps } from './pricing';
import { at } from './testClock';
import {
  holdId,
  termsId,
  waiverId,
  sessionId,
  parsed,
} from './checkout.fixtures';

//   when the experience requires one, and is that experience's own published document
// - the party's children are the quantity on the child price option
// - the hold is priced from the unit prices it snapshotted, with tax by treatment (unknown charges none)
// - every column of the order snapshot: key, money, tax and commission snapshots, tier and free-cancel
//   time, attribution; it passes the order schema; lines carry their label and priced total
// - the tries limit refuses over the limit and passes within it
// - the order token goes only to the device that holds the hold

const adult: HeldItem = {
  priceOptionId: '7c9e6679-7425-40de-944b-e07fc1f90ae7',
  kind: 'adult',
  quantity: 2,
  unitPriceMinor: 8500,
  usesSpace: true,
};
const child: HeldItem = {
  priceOptionId: 'f47ac10b-58cc-4372-a567-0e02b2c3d479',
  kind: 'child',
  quantity: 1,
  unitPriceMinor: 4000,
  usesSpace: false,
};

describe('the party and its price', () => {
  it('counts the children as the quantity on the child option', () => {
    expect(childCount([adult])).toBe(0);
    expect(childCount([adult, child])).toBe(1);
    expect(childCount([adult, { ...child, quantity: 3 }])).toBe(3);
  });

  it.each([
    ['taxable', 88_750, 21_000, 1_864],
    ['not_taxable', 88_750, 21_000, 0],
    ['unknown', 88_750, 21_000, 0],
  ] as const)(
    'prices a hold from its own unit prices, a %s experience at the settings rate',
    (treatment, rate, subtotal, tax) => {
      const priced = priceHold([adult, child], treatment, rate);

      expect(priced.ticketSubtotalMinor).toBe(subtotal);
      expect(priced.taxMinor).toBe(tax);
      expect(priced.totalMinor).toBe(subtotal + tax);
      expect(priced.lines.map((line) => line.unitPriceMinor)).toEqual([
        8500, 4000,
      ]);
    },
  );

  it('takes the amount due from the order, else the new order, else nothing', () => {
    const priced = priceHold([adult], 'taxable', 88_750);

    expect(amountDueNow({ amountDueMinor: 123 }, priced)).toBe(123);
    expect(amountDueNow(null, priced)).toBe(priced.totalMinor);
    expect(amountDueNow(null, null)).toBe(0);
  });
});

describe('the order snapshot', () => {
  const session = {
    id: sessionId,
    experienceId: '0f8fad5b-d9cb-469f-a165-70867728950e',
    startsAt: new Date('2026-11-10T15:00:00.000Z'),
    timeZone: 'America/New_York',
  };
  const tier = {
    id: 'a3bb189e-8bf9-3888-9912-ace4e6543002',
    fullRefundHoursBefore: 24,
  };
  const guestId = '886313e1-3b8a-5372-9b90-0c9aee199e5d';
  const priced = priceHold([adult, child], 'taxable', 88_750);

  const snapshot = (
    change: Partial<Parameters<typeof orderSnapshot>[0]> = {},
  ) =>
    orderSnapshot({
      reference: 'RMB-7K2M9P',
      holdId,
      session,
      hostId: '21b6d6e4-2b6c-4a48-8a64-6a4a8f1d9c10',
      taxTreatment: 'taxable',
      tier,
      priced,
      fields: orderFields(
        parsed({
          attendees: {
            ageConfirmed: true,
            childrenAges: [9],
            guardian: { name: 'Pat Smith', contact: 'pat@example.com' },
          },
          waiverDocumentId: waiverId,
        }),
        guestId,
      ),
      attribution: undefined,
      at,
      ...change,
    });

  it('snapshots the key, the money, the tax and commission rates, and the tier', () => {
    expect(snapshot()).toMatchObject({
      reference: 'RMB-7K2M9P',
      kind: 'booking',
      status: 'pending_payment',
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId,
      experienceId: session.experienceId,
      currency: 'USD',
      ticketSubtotalMinor: 21_000,
      taxTreatment: 'taxable',
      taxRatePpm: 88_750,
      taxMinor: 1_864,
      totalMinor: 22_864,
      giftAppliedMinor: 0,
      amountDueMinor: 22_864,
      commissionRateBps: defaultCommissionRateBps,
      commissionMinor: 3_150,
      cancellationTierId: tier.id,
    });
  });

  it('puts the last free cancel the tier hours before the start', () => {
    expect(snapshot().freeCancelUntil).toEqual(
      new Date('2026-11-09T15:00:00.000Z'),
    );
    expect(
      snapshot({ tier: { id: tier.id, fullRefundHoursBefore: 168 } })
        .freeCancelUntil,
    ).toEqual(new Date('2026-11-03T15:00:00.000Z'));
  });

  it.each([
    [{ source: 'news', campaign: 'fall', issue: '12' }, 'news', 'fall', '12'],
    [{ source: 'news' }, 'news', null, null],
    [undefined, null, null, null],
  ])(
    'copies the attribution from the form %j',
    (attribution, source, campaign, issue) => {
      expect(snapshot({ attribution })).toMatchObject({
        attributionSource: source,
        attributionCampaign: campaign,
        attributionIssue: issue,
      });
    },
  );

  it('charges no tax and records the treatment on a not-taxable or unknown experience', () => {
    const untaxed = priceHold([adult], 'unknown', 88_750);
    expect(
      snapshot({ taxTreatment: 'unknown', priced: untaxed }),
    ).toMatchObject({
      taxTreatment: 'unknown',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 17_000,
    });
  });

  it('carries the guest, contact, and attendee fields of the form', () => {
    expect(snapshot()).toMatchObject({
      guestId,
      contactEmail: 'pat@example.com',
      contactPhone: '212-555-0100',
      leadGuestName: 'Pat Smith',
      ageConfirmed: true,
      childrenAges: [9],
      guardianName: 'Pat Smith',
      guardianContact: 'pat@example.com',
      waiverDocumentId: waiverId,
      termsDocumentId: termsId,
    });
  });

  it('leaves out what the form left out', () => {
    expect(
      orderFields(parsed({ contact: { email: 'pat@example.com' } }), guestId),
    ).toMatchObject({
      contactPhone: null,
      ageConfirmed: null,
      childrenAges: null,
      guardianName: null,
      guardianContact: null,
      waiverDocumentId: null,
    });
  });

  it('is an order the order schema accepts, with lines it accepts', () => {
    const order = {
      ...snapshot(),
      id: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
      giftId: null,
      refundedTicketMinor: 0,
      refundedTaxMinor: 0,
      commissionReturnedMinor: 0,
      refundFailed: false,
      cancelledBy: null,
      manageTokenHash: null,
      manageTokenVersion: 1,
      synthetic: false,
      createdAt: at,
      confirmedAt: null,
      cancelledAt: null,
    };

    expect(OrderSchema.safeParse(order).success).toBe(true);
    for (const row of orderItemRows(order.id, priced)) {
      expect(OrderItemSchema.safeParse(row).success).toBe(true);
    }
  });

  it('lines each price option with its label and its priced total', () => {
    expect(
      orderItemRows('5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44', priced),
    ).toEqual([
      {
        orderId: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
        priceOptionId: adult.priceOptionId,
        label: 'Adult',
        quantity: 2,
        unitPriceMinor: 8500,
        usesSpace: true,
        lineTotalMinor: 17_000,
      },
      {
        orderId: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
        priceOptionId: child.priceOptionId,
        label: 'Child',
        quantity: 1,
        unitPriceMinor: 4000,
        usesSpace: false,
        lineTotalMinor: 4_000,
      },
    ]);
  });
});

describe('the order reference', () => {
  it('is RMB- and six Crockford characters from the random source', () => {
    const picks = [0, 10, 31, 17, 1, 25];
    let next = 0;

    const reference = newOrderReference(() => picks[next++] ?? 0);

    expect(reference).toBe('RMB-0AZH1S');
  });

  it('asks for an index below the alphabet size', () => {
    const asked: number[] = [];
    newOrderReference((max) => {
      asked.push(max);
      return 0;
    });
    expect(asked).toEqual([32, 32, 32, 32, 32, 32]);
  });

  it.each([[32], [-1], [Number.NaN]])(
    'refuses a random index of %s',
    (index) => {
      expect(() => newOrderReference(() => index)).toThrow(RangeError);
    },
  );
});

describe('a retry after a decline', () => {
  it.each(
    orderStatuses.map((status) => [
      status,
      status === 'payment_failed' ? 'pending_payment' : status,
    ]),
  )('moves %s to %s', (from, to) => {
    expect(statusOnRetry(from)).toBe(to);
  });
});

describe('the tries limit', () => {
  it('refuses a try over the limit and passes one within it', () => {
    expect(paymentTriesRefusal({ allowed: false, retryAfterSeconds: 60 })).toBe(
      tooManyTries,
    );
    expect(paymentTriesRefusal({ allowed: true, remaining: 0 })).toBeNull();
  });
});

describe('which calls spend a payment try', () => {
  const deviceKey = 'a'.repeat(64);
  const owned = { deviceKey };
  const withPayment = {
    status: 'created' as const,
    failedTries: 0,
    providerPaymentId: 'pay_1',
  };
  const tryState = (change: Partial<PaymentTryState>): PaymentTryState => ({
    deviceKey,
    hold: owned,
    order: { status: 'pending_payment' },
    latestAttempt: null,
    ...change,
  });

  it.each([
    ['a hold with no order yet (a first attempt)', { order: null }],
    ['an order with no attempt', { latestAttempt: null }],
    [
      'a next attempt after a canceled one',
      { latestAttempt: { ...withPayment, status: 'canceled' as const } },
    ],
    [
      'a resume of an attempt with no provider payment yet',
      { latestAttempt: { ...withPayment, providerPaymentId: null } },
    ],
    [
      'an attempt out of failed tries',
      { latestAttempt: { ...withPayment, failedTries: maxFailedTries } },
    ],
    [
      'a retry after a decline with a canceled attempt',
      {
        order: { status: 'payment_failed' as const },
        latestAttempt: { ...withPayment, status: 'canceled' as const },
      },
    ],
    [
      'an order that cannot be paid',
      { order: { status: 'cancelled' as const } },
    ],
    ['a hold that is missing', { hold: null }],
    ['a hold of another device', { hold: { deviceKey: 'b'.repeat(64) } }],
    [
      'a missing hold even when sent with a confirmed order',
      { hold: null, order: { status: 'confirmed' as const } },
    ],
  ] satisfies [string, Partial<PaymentTryState>][])(
    'spends for %s',
    (_, change) => {
      expect(spendsPaymentTry(tryState(change))).toBe(true);
    },
  );

  it.each([
    ['a confirmed order', { order: { status: 'confirmed' as const } }],
    [
      'an idempotent refresh of an existing payment',
      { latestAttempt: withPayment },
    ],
    [
      'a refresh after a decline that kept its payment',
      {
        order: { status: 'payment_failed' as const },
        latestAttempt: { ...withPayment, failedTries: 2 },
      },
    ],
  ] satisfies [string, Partial<PaymentTryState>][])(
    'spends nothing for %s',
    (_, change) => {
      expect(spendsPaymentTry(tryState(change))).toBe(false);
    },
  );
});

describe('the results', () => {
  const order = {
    id: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
    reference: 'RMB-7K2M9P',
    amountDueMinor: 22_864,
  };

  it('gives the order token to the device that holds the hold and no other', () => {
    expect(orderTokenFor({ deviceKey: 'a' }, 'a', () => 'token')).toBe('token');
    expect(
      orderTokenFor({ deviceKey: 'a' }, 'b', () => 'token'),
    ).toBeUndefined();
  });

  it('never makes the token for another device', () => {
    let made = 0;
    orderTokenFor({ deviceKey: 'a' }, 'b', () => {
      made += 1;
      return 'token';
    });
    expect(made).toBe(0);
  });

  it('carries the token on a confirmed answer only when there is one', () => {
    expect(alreadyConfirmedResult('RMB-7K2M9P', 'token')).toEqual({
      status: 'already_confirmed',
      reference: 'RMB-7K2M9P',
      orderToken: 'token',
    });
    expect(alreadyConfirmedResult('RMB-7K2M9P', undefined)).toEqual({
      status: 'already_confirmed',
      reference: 'RMB-7K2M9P',
    });
  });

  it('carries the order, the secret, and the token on a payment answer', () => {
    expect(
      requiresPaymentResult(
        order,
        { provider: 'fake', clientSecret: 'cs_1' },
        'token',
      ),
    ).toEqual({
      status: 'requires_payment',
      orderId: order.id,
      reference: order.reference,
      payment: { provider: 'fake', clientSecret: 'cs_1' },
      amountDueMinor: 22_864,
      orderToken: 'token',
    });
    expect(
      requiresPaymentResult(
        order,
        { provider: 'fake', clientSecret: 'cs_1' },
        undefined,
      ),
    ).not.toHaveProperty('orderToken');
  });
});
