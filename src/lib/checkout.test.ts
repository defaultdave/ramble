import { describe, expect, it } from 'vitest';
import {
  StartPaymentInputSchema,
  acceptedDocumentIds,
  ageRequirements,
  alreadyConfirmedResult,
  amountDueNow,
  attendeeIssues,
  childCount,
  inputIssues,
  invalidStartPayment,
  lapsedOutcome,
  legalIssues,
  newOrderReference,
  orderFields,
  orderItemRows,
  orderSnapshot,
  orderTokenFor,
  paymentTriesRefusal,
  priceHold,
  providerStep,
  requiresPaymentResult,
  startPaymentDecision,
  statusOnRetry,
  storeProviderPayment,
  lookupVerdict,
  storesPayment,
  newsletterConsent,
  tooManyTries,
  unknownHold,
  type DecisionState,
  type HeldItem,
  type StartPaymentInput,
} from './checkout';
import { OrderItemSchema, OrderSchema, orderStatuses } from './orders';
import { maxFailedTries, paymentLimits } from './payments';
import { defaultCommissionRateBps } from './pricing';

// Behaviours under test, one per decision, branch or risk:
// - the form: a full one parses with ids lower-cased and the email folded; the optional parts may be
//   left out; each bad field is refused (ids, email, names, phone, ages, guardian, attribution), and
//   an oversize string is refused without being walked
// - a failed parse is one code per field, keyed by its whole path, `required` only when a rule says so
// - age rules (PRD-23): every limit needs the booker's confirmation; each child gives one age in range;
//   a guardian comes with children and only with children
// - terms and waiver (PRD-24): terms must be the current published version; a waiver is required exactly
//   when the experience requires one, and is that experience's own published document
// - the party's children are the quantity on the child price option
// - the hold is priced from the unit prices it snapshotted, with tax by treatment (unknown charges none)
// - every column of the order snapshot: key, money, tax and commission snapshots, tier and free-cancel
//   time, attribution; it passes the order schema; lines carry their label and priced total
// - a new reference is RMB- and six Crockford characters; a bad random source is refused
// - the decision, in order: unknown hold (missing, another device's, a gift hold, moved session, cancelled
//   order); confirmed; invalid form; five failed tries; a payment in flight (even on a lapsed hold, and a
//   succeeded one); a session that cannot be booked; a lapsed hold; an amount the provider refuses; resume,
//   next attempt, create; the attempt cap
// - the tries limit refuses over the limit and passes within it
// - a lapsed hold is sold out with no spaces left, and otherwise expired with re-hold only when the party fits
// - the order token goes only to the device that holds the hold
// - the provider is asked by what is known of the attempt; a payment id is stored once, while live

const holdId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const termsId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
const waiverId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';
const sessionId = '6ba7b810-9dad-41d1-80b4-00c04fd430c8';
const at = new Date('2026-11-01T12:00:00.000Z');
const minutes = (count: number) => new Date(at.getTime() + count * 60_000);

const validInput: StartPaymentInput = {
  holdId,
  contact: { email: 'pat@example.com', phone: '212-555-0100' },
  leadGuestName: 'Pat Smith',
  attendees: {},
  termsDocumentId: termsId,
  newsletterOptIn: false,
};

describe('the form', () => {
  it('parses a full form, lower-casing ids and folding the email', () => {
    const parsed = StartPaymentInputSchema.parse({
      holdId: holdId.toUpperCase(),
      contact: { email: 'Pat@Example.COM', phone: '212-555-0100' },
      leadGuestName: 'Pat Smith',
      attendees: {
        ageConfirmed: true,
        childrenAges: [7, 9],
        guardian: { name: 'Pat Smith', contact: 'pat@example.com' },
      },
      waiverDocumentId: waiverId.toUpperCase(),
      termsDocumentId: termsId.toUpperCase(),
      newsletterOptIn: true,
      attribution: { source: 'news', campaign: 'fall', issue: '12' },
    });

    expect(parsed.holdId).toBe(holdId);
    expect(parsed.contact.email).toBe('pat@example.com');
    expect(parsed.waiverDocumentId).toBe(waiverId);
    expect(parsed.termsDocumentId).toBe(termsId);
  });

  it('parses a form with every optional part left out', () => {
    expect(StartPaymentInputSchema.safeParse(validInput).success).toBe(true);
    expect(
      StartPaymentInputSchema.safeParse({
        ...validInput,
        contact: { email: 'pat@example.com' },
      }).success,
    ).toBe(true);
  });

  it.each([
    ['a hold id that is not an id', { holdId: 'nope' }],
    ['no terms version', { termsDocumentId: undefined }],
    ['a waiver id that is not an id', { waiverDocumentId: 'nope' }],
    ['a newsletter flag that is not a boolean', { newsletterOptIn: 'yes' }],
    ['a blank lead guest', { leadGuestName: '   ' }],
    ['a lead guest of 121 characters', { leadGuestName: 'a'.repeat(121) }],
    [
      'a lead guest of a million characters',
      { leadGuestName: 'a'.repeat(1e6) },
    ],
    ['an email with no domain', { contact: { email: 'pat@' } }],
    ['an erased-guest address', { contact: { email: 'x@anonymized.invalid' } }],
    [
      'a phone of 41 characters',
      { contact: { email: 'pat@example.com', phone: '1'.repeat(41) } },
    ],
    ['a blank phone', { contact: { email: 'pat@example.com', phone: '  ' } }],
    ['a child aged -1', { attendees: { childrenAges: [-1] } }],
    ['a child aged 18', { attendees: { childrenAges: [18] } }],
    ['a child aged 7.5', { attendees: { childrenAges: [7.5] } }],
    ['an empty list of ages', { attendees: { childrenAges: [] } }],
    [
      'more ages than a party can hold',
      { attendees: { childrenAges: Array.from({ length: 101 }, () => 5) } },
    ],
    [
      'a guardian with no contact',
      { attendees: { guardian: { name: 'Pat Smith' } } },
    ],
    [
      'a guardian contact of 255 characters',
      {
        attendees: {
          guardian: { name: 'Pat Smith', contact: 'a'.repeat(255) },
        },
      },
    ],
    [
      'an attribution source of 101 characters',
      { attribution: { source: 'a'.repeat(101) } },
    ],
    ['a blank attribution campaign', { attribution: { campaign: ' ' } }],
  ])('refuses %s', (_name, change) => {
    expect(
      StartPaymentInputSchema.safeParse({ ...validInput, ...change }).success,
    ).toBe(false);
  });

  it('keys a failed parse by the whole path and says required only when a rule does', () => {
    const parsed = StartPaymentInputSchema.safeParse({
      ...validInput,
      contact: { email: 'pat@' },
      leadGuestName: ' ',
      attendees: { childrenAges: [30] },
    });
    if (parsed.success) throw new Error('expected a refusal');

    expect(invalidStartPayment(parsed.error.issues)).toEqual({
      status: 'invalid',
      fieldErrors: {
        'contact.email': 'invalid',
        leadGuestName: 'invalid',
        'attendees.childrenAges.0': 'invalid',
      },
    });
  });

  it('names the whole input when the issue has no path', () => {
    expect(
      invalidStartPayment([{ path: [], message: 'Invalid input' }]),
    ).toEqual({ status: 'invalid', fieldErrors: { input: 'invalid' } });
  });
});

const parsed = (change: object = {}) =>
  StartPaymentInputSchema.parse({ ...validInput, ...change });

describe('age rules', () => {
  const allAges = { ageRule: 'all_ages', minAge: null, maxAge: null } as const;
  const twentyOne = {
    ageRule: 'twenty_one_plus',
    minAge: null,
    maxAge: null,
  } as const;
  const minimum = { ageRule: 'minimum_age', minAge: 8, maxAge: null } as const;
  const range = { ageRule: 'age_range', minAge: 6, maxAge: 12 } as const;
  const guardian = { name: 'Pat Smith', contact: 'pat@example.com' };

  it.each([
    ['an all-ages party of adults', allAges, {}, 0, {}],
    [
      'an all-ages party with a child of any age',
      allAges,
      { childrenAges: [0], guardian },
      1,
      {},
    ],
    ['a 21+ party confirmed', twentyOne, { ageConfirmed: true }, 0, {}],
    [
      'a 21+ party not confirmed',
      twentyOne,
      {},
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a 21+ party confirmed false',
      twentyOne,
      { ageConfirmed: false },
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a minimum-age party not confirmed',
      minimum,
      {},
      0,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a range party not confirmed',
      range,
      { childrenAges: [8], guardian },
      1,
      { 'attendees.ageConfirmed': 'required' },
    ],
    [
      'a child at the minimum age',
      minimum,
      { ageConfirmed: true, childrenAges: [8], guardian },
      1,
      {},
    ],
    [
      'a child below the minimum age',
      minimum,
      { ageConfirmed: true, childrenAges: [7], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'a child at the bottom of the range',
      range,
      { ageConfirmed: true, childrenAges: [6], guardian },
      1,
      {},
    ],
    [
      'a child at the top of the range',
      range,
      { ageConfirmed: true, childrenAges: [12], guardian },
      1,
      {},
    ],
    [
      'a child above the range',
      range,
      { ageConfirmed: true, childrenAges: [13], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'one of two children out of range',
      range,
      { ageConfirmed: true, childrenAges: [7, 15], guardian },
      2,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'a child at a 21+ experience',
      twentyOne,
      { ageConfirmed: true, childrenAges: [9], guardian },
      1,
      { 'attendees.childrenAges': 'out_of_range' },
    ],
    [
      'children with no ages',
      allAges,
      { guardian },
      2,
      { 'attendees.childrenAges': 'required' },
    ],
    [
      'fewer ages than children',
      allAges,
      { childrenAges: [7], guardian },
      2,
      { 'attendees.childrenAges': 'invalid' },
    ],
    [
      'more ages than children',
      allAges,
      { childrenAges: [7, 8] },
      1,
      { 'attendees.childrenAges': 'invalid', 'attendees.guardian': 'required' },
    ],
    [
      'ages with no children in the party',
      allAges,
      { childrenAges: [7] },
      0,
      { 'attendees.childrenAges': 'invalid' },
    ],
    [
      'children with no guardian',
      allAges,
      { childrenAges: [7] },
      1,
      { 'attendees.guardian': 'required' },
    ],
    [
      'a guardian with no children',
      allAges,
      { guardian },
      0,
      { 'attendees.guardian': 'invalid' },
    ],
  ])('%s', (_name, subject, attendees, children, expected) => {
    expect(
      attendeeIssues(subject, parsed({ attendees }).attendees, children),
    ).toEqual(expected);
  });
});

describe('terms and waiver', () => {
  const needsWaiver = { waiverRequired: true, waiverDocumentId: waiverId };
  const noWaiver = { waiverRequired: false, waiverDocumentId: null };
  const current = { terms: { id: termsId }, waiver: null };
  const withWaiver = { terms: { id: termsId }, waiver: { id: waiverId } };

  const input = (change: object = {}) =>
    parsed({ waiverDocumentId: undefined, ...change });

  it.each([
    ['current terms, no waiver needed', noWaiver, input(), current, {}],
    [
      'current terms and the experience waiver',
      needsWaiver,
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      {},
    ],
    [
      'terms that are not the current version',
      noWaiver,
      input({ termsDocumentId: waiverId }),
      current,
      { termsDocumentId: 'invalid' },
    ],
    [
      'no current terms published',
      noWaiver,
      input(),
      { terms: null, waiver: null },
      { termsDocumentId: 'invalid' },
    ],
    [
      'a required waiver left out',
      needsWaiver,
      input(),
      withWaiver,
      { waiverDocumentId: 'required' },
    ],
    [
      'a waiver sent where none is needed',
      noWaiver,
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      { waiverDocumentId: 'invalid' },
    ],
    [
      'another document sent as the waiver',
      needsWaiver,
      input({ waiverDocumentId: termsId }),
      { terms: { id: termsId }, waiver: { id: termsId } },
      { waiverDocumentId: 'invalid' },
    ],
    [
      'a waiver that is not published',
      needsWaiver,
      input({ waiverDocumentId: waiverId }),
      current,
      { waiverDocumentId: 'invalid' },
    ],
    [
      'an experience that requires a waiver but names none',
      { waiverRequired: true, waiverDocumentId: null },
      input({ waiverDocumentId: waiverId }),
      withWaiver,
      { waiverDocumentId: 'invalid' },
    ],
  ])('%s', (_name, experience, form, published, expected) => {
    expect(legalIssues(experience, form, published)).toEqual(expected);
  });

  it('lists the age and the terms issues together', () => {
    expect(
      inputIssues(
        {
          ageRule: 'twenty_one_plus',
          minAge: null,
          maxAge: null,
          ...noWaiver,
        },
        input({ termsDocumentId: waiverId }),
        0,
        current,
      ),
    ).toEqual({
      'attendees.ageConfirmed': 'required',
      termsDocumentId: 'invalid',
    });
  });

  it('accepts the terms, and the waiver when one was sent', () => {
    expect(acceptedDocumentIds(input())).toEqual([termsId]);
    expect(acceptedDocumentIds(input({ waiverDocumentId: waiverId }))).toEqual([
      termsId,
      waiverId,
    ]);
  });
});

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

const baseHold = {
  deviceKey: 'a'.repeat(64),
  sessionId,
  purpose: 'booking' as const,
  status: 'active' as const,
  seats: 2,
  expiresAt: minutes(5),
  payingUntil: null,
};

const baseState = (change: Partial<DecisionState> = {}): DecisionState => ({
  deviceKey: 'a'.repeat(64),
  readSessionId: sessionId,
  hold: baseHold,
  subject: {
    experienceStatus: 'live',
    sessionStatus: 'scheduled',
    startsAt: minutes(60 * 24),
  },
  order: null,
  latestAttempt: null,
  issues: {},
  amountDueMinor: 22_864,
  chargeLimits: { minMinor: 50, maxMinor: 99_999_999 },
  at,
  ...change,
});

const attempt = (change: object = {}) => ({
  id: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  attemptNo: 1,
  status: 'created' as const,
  failedTries: 0,
  providerPaymentId: null,
  ...change,
});

describe('the decision', () => {
  it.each([
    ['a missing hold', { hold: null }],
    ['another device', { deviceKey: 'b'.repeat(64) }],
    [
      'a gift redemption hold',
      { hold: { ...baseHold, purpose: 'gift_redemption' as const } },
    ],
    [
      'a hold that moved to another session',
      { hold: { ...baseHold, sessionId: holdId } },
    ],
    ['a missing session', { subject: null }],
    ['a cancelled order', { order: { status: 'cancelled' as const } }],
    [
      'a refunded order',
      { order: { status: 'refunded_after_lapse' as const } },
    ],
  ])('answers %s as an expired hold with no re-hold', (_name, change) => {
    expect(startPaymentDecision(baseState(change))).toEqual({
      kind: 'refuse',
      result: unknownHold,
    });
  });

  it('answers another device exactly as a missing hold, whatever else is true', () => {
    const missing = startPaymentDecision(baseState({ hold: null }));
    const stranger = startPaymentDecision(
      baseState({
        deviceKey: 'b'.repeat(64),
        order: { status: 'confirmed' },
        issues: { leadGuestName: 'invalid' },
      }),
    );

    expect(stranger).toEqual(missing);
  });

  it('answers a confirmed order as confirmed, whatever the form held and the hold became', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'confirmed' },
          hold: { ...baseHold, status: 'converted' },
          issues: { leadGuestName: 'invalid' },
          latestAttempt: attempt({ status: 'succeeded', failedTries: 5 }),
        }),
      ),
    ).toEqual({ kind: 'already_confirmed' });
  });

  it('refuses a form with issues and keeps its field errors', () => {
    expect(
      startPaymentDecision(
        baseState({ issues: { termsDocumentId: 'invalid' } }),
      ),
    ).toEqual({
      kind: 'refuse',
      result: {
        status: 'invalid',
        fieldErrors: { termsDocumentId: 'invalid' },
      },
    });
  });

  it('answers too many tries at the failed-try limit and passes one below it', () => {
    const decide = (failedTries: number) =>
      startPaymentDecision(
        baseState({
          order: { status: 'payment_failed' },
          latestAttempt: attempt({ status: 'failed_try', failedTries }),
        }),
      );

    expect(decide(maxFailedTries)).toEqual({
      kind: 'refuse',
      result: tooManyTries,
    });
    expect(decide(maxFailedTries - 1).kind).toBe('resume');
  });

  it('answers too many tries for a cancelled attempt that used them up', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'void' },
          latestAttempt: attempt({ status: 'canceled', failedTries: 5 }),
        }),
      ),
    ).toEqual({ kind: 'refuse', result: tooManyTries });
  });

  it.each([
    ['a created attempt', 'created'],
    ['a failed try', 'failed_try'],
    ['a processing attempt', 'processing'],
    ['an attempt that succeeded and awaits confirmation', 'succeeded'],
  ] as const)(
    'returns %s that has a provider payment as it is',
    (_name, status) => {
      expect(
        startPaymentDecision(
          baseState({
            order: { status: 'pending_payment' },
            latestAttempt: attempt({ status, providerPaymentId: 'pay_1' }),
          }),
        ),
      ).toEqual({
        kind: 'in_flight',
        attemptId: attempt().id,
        providerPaymentId: 'pay_1',
      });
    },
  );

  it('returns a payment in flight even after the hold lapsed', () => {
    expect(
      startPaymentDecision(
        baseState({
          hold: { ...baseHold, status: 'paying', payingUntil: minutes(-1) },
          order: { status: 'pending_payment' },
          latestAttempt: attempt({ providerPaymentId: 'pay_1' }),
        }),
      ).kind,
    ).toBe('in_flight');
  });

  it('refuses an attempt that succeeded with no provider payment recorded', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'pending_payment' },
          latestAttempt: attempt({ status: 'succeeded' }),
        }),
      ),
    ).toEqual({ kind: 'refuse', result: unknownHold });
  });

  it.each([
    ['a cancelled session', { sessionStatus: 'cancelled' as const }],
    ['a session that has started', { startsAt: minutes(-1) }],
    [
      'an experience that is no longer live',
      { experienceStatus: 'paused' as const },
    ],
  ])('answers %s as expired with no re-hold', (_name, subject) => {
    expect(
      startPaymentDecision(
        baseState({
          subject: {
            experienceStatus: 'live',
            sessionStatus: 'scheduled',
            startsAt: minutes(60),
            ...subject,
          },
        }),
      ),
    ).toEqual({ kind: 'refuse', result: unknownHold });
  });

  it.each([
    [
      'an active hold past its expiry',
      { status: 'active' as const, expiresAt: minutes(-1) },
    ],
    [
      'an active hold expiring now',
      { status: 'active' as const, expiresAt: at },
    ],
    [
      'a paying hold past its deadline',
      {
        status: 'paying' as const,
        expiresAt: minutes(-9),
        payingUntil: minutes(-1),
      },
    ],
    ['a released hold', { status: 'released' as const }],
    [
      'a converted hold with no confirmed order',
      { status: 'converted' as const },
    ],
  ])('judges %s lapsed', (_name, hold) => {
    expect(
      startPaymentDecision(baseState({ hold: { ...baseHold, ...hold } })),
    ).toEqual({ kind: 'lapsed' });
  });

  it('keeps an active hold open until its expiry and a paying one until its deadline', () => {
    expect(startPaymentDecision(baseState()).kind).toBe('create');
    expect(
      startPaymentDecision(
        baseState({
          hold: {
            ...baseHold,
            status: 'paying',
            expiresAt: minutes(-3),
            payingUntil: minutes(2),
          },
        }),
      ).kind,
    ).toBe('create');
  });

  it.each([
    ['below the provider minimum', 49],
    ['nothing at all', 0],
    ['above the provider maximum', 100_000_000],
  ])('refuses an amount of %s without writing', (_name, amountDueMinor) => {
    expect(startPaymentDecision(baseState({ amountDueMinor }))).toEqual({
      kind: 'refuse',
      result: { status: 'invalid', fieldErrors: { holdId: 'not_payable' } },
    });
  });

  it('accepts an amount at the provider limits', () => {
    expect(startPaymentDecision(baseState({ amountDueMinor: 50 })).kind).toBe(
      'create',
    );
    expect(
      startPaymentDecision(baseState({ amountDueMinor: 99_999_999 })).kind,
    ).toBe('create');
  });

  it('creates the order for a hold with none', () => {
    expect(startPaymentDecision(baseState())).toEqual({
      kind: 'create',
      attemptNo: 1,
    });
  });

  it('resumes a live attempt that has no provider payment yet', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'pending_payment' },
          latestAttempt: attempt(),
        }),
      ),
    ).toEqual({ kind: 'resume', attemptId: attempt().id });
  });

  it.each(['pending_payment', 'payment_failed', 'void'] as const)(
    'gives a %s order with only a cancelled attempt the next attempt number',
    (status) => {
      expect(
        startPaymentDecision(
          baseState({
            order: { status },
            latestAttempt: attempt({
              status: 'canceled',
              attemptNo: 2,
              failedTries: 1,
              providerPaymentId: 'pay_1',
            }),
          }),
        ),
      ).toEqual({ kind: 'next_attempt', attemptNo: 3 });
    },
  );

  it('gives an order with no attempt yet the first', () => {
    expect(
      startPaymentDecision(baseState({ order: { status: 'pending_payment' } })),
    ).toEqual({ kind: 'next_attempt', attemptNo: 1 });
  });

  it('stops at the attempt cap', () => {
    const last = paymentLimits.maxAttemptNo;
    const decide = (attemptNo: number) =>
      startPaymentDecision(
        baseState({
          order: { status: 'void' },
          latestAttempt: attempt({ status: 'canceled', attemptNo }),
        }),
      );

    expect(decide(last)).toEqual({ kind: 'refuse', result: tooManyTries });
    expect(decide(last - 1)).toEqual({ kind: 'next_attempt', attemptNo: last });
  });
});

describe('what a lapsed hold answers', () => {
  it.each([
    ['nothing left', 2, 0, { kind: 'sold_out' }],
    [
      'less than nothing left after a lowered capacity',
      2,
      -3,
      { kind: 'sold_out' },
    ],
    [
      'fewer spaces than the party',
      3,
      2,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: false, spacesLeft: 2 },
      },
    ],
    [
      'exactly the party',
      2,
      2,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: true, spacesLeft: 2 },
      },
    ],
    [
      'more than the party',
      1,
      5,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: true, spacesLeft: 5 },
      },
    ],
  ])('%s', (_name, seats, left, expected) => {
    expect(lapsedOutcome(seats, left)).toEqual(expected);
  });
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

describe('the provider step', () => {
  it.each([
    [
      'reads a payment the attempt already has',
      { providerPaymentId: 'pay_1', existed: true },
      { step: 'retrieve', paymentId: 'pay_1' },
    ],
    [
      'looks an earlier call’s attempt up by Ramble’s ids before creating',
      { providerPaymentId: null, existed: true },
      { step: 'find_or_create' },
    ],
    [
      'creates for an attempt made in this call',
      { providerPaymentId: null, existed: false },
      { step: 'create' },
    ],
  ])('%s', (_name, known, expected) => {
    expect(providerStep(known)).toEqual(expected);
  });

  it.each([
    [
      'stores the first id on a live attempt',
      'created',
      null,
      'pay_1',
      'write',
    ],
    [
      'stores on an attempt that failed a try',
      'failed_try',
      null,
      'pay_1',
      'write',
    ],
    [
      'treats the same id again as stored',
      'created',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    [
      'treats the same id on a finished attempt as stored',
      'succeeded',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    ['never replaces a different id', 'created', 'pay_1', 'pay_2', 'refuse'],
    [
      'never writes to a succeeded attempt',
      'succeeded',
      null,
      'pay_1',
      'refuse',
    ],
    ['never writes to a canceled attempt', 'canceled', null, 'pay_1', 'refuse'],
  ] as const)('%s', (_name, status, stored, paymentId, expected) => {
    expect(
      storeProviderPayment({ status, providerPaymentId: stored }, paymentId),
    ).toEqual(
      {
        write: { write: true, stored: true },
        repeat: { write: false, stored: true },
        refuse: { write: false, stored: false },
      }[expected],
    );
  });

  it.each([
    [
      'a payment found by id is used',
      { step: 'retrieve', paymentId: 'p' },
      true,
      'use',
    ],
    [
      'a payment found by Ramble’s ids is used',
      { step: 'find_or_create' },
      true,
      'use',
    ],
    [
      'a stored payment the provider lost is refused',
      { step: 'retrieve', paymentId: 'p' },
      false,
      'refuse',
    ],
    [
      'an earlier attempt with no provider payment creates one',
      { step: 'find_or_create' },
      false,
      'create',
    ],
    ['a new attempt creates one', { step: 'create' }, false, 'create'],
  ] as const)('%s', (_name, step, found, expected) => {
    expect(lookupVerdict(step, found)).toBe(expected);
  });

  it('writes the payment id only for a payment the attempt did not hold', () => {
    expect(storesPayment({ step: 'retrieve', paymentId: 'p' })).toBe(false);
    expect(storesPayment({ step: 'find_or_create' })).toBe(true);
    expect(storesPayment({ step: 'create' })).toBe(true);
  });
});

describe('the newsletter consent', () => {
  it('is a checkout grant when ticked, and nothing when not', () => {
    expect(newsletterConsent('g1', true)).toEqual({
      guestId: 'g1',
      kind: 'newsletter',
      status: 'granted',
      source: 'checkout',
    });
    expect(newsletterConsent('g1', false)).toBeNull();
  });
});

describe('ageRequirements', () => {
  const rule = (
    ageRule: 'all_ages' | 'minimum_age' | 'age_range' | 'twenty_one_plus',
    minAge: number | null,
    maxAge: number | null,
  ) => ({
    ageRule,
    minAge,
    maxAge,
  });

  it.each([
    [rule('all_ages', null, null), null],
    [
      rule('twenty_one_plus', null, null),
      'Everyone in my party is 21 or older',
    ],
    [
      rule('minimum_age', 14, null),
      'Everyone is 14 or older, and anyone under 18 comes with an adult',
    ],
    [rule('minimum_age', 18, null), 'Everyone in my party is 18 or older'],
    [
      rule('age_range', 6, 12),
      'Everyone in my party is between 6 and 12 years old',
    ],
  ])('words the confirmation for %j', (subject, label) => {
    expect(ageRequirements(subject, 0).confirmation).toBe(label);
  });

  it('asks nothing of a party with no children', () => {
    expect(ageRequirements(rule('all_ages', null, null), 0)).toEqual({
      confirmation: null,
      childAges: null,
      guardian: false,
    });
  });

  it.each([
    [rule('all_ages', null, null), { count: 2, min: 0, max: 17 }],
    [rule('minimum_age', 8, null), { count: 2, min: 8, max: 17 }],
    [rule('age_range', 6, 12), { count: 2, min: 6, max: 12 }],
    [rule('age_range', 6, 40), { count: 2, min: 6, max: 17 }],
  ])('takes an age for each child, within the rule: %j', (subject, ages) => {
    const needs = ageRequirements(subject, 2);
    expect(needs.childAges).toEqual(ages);
    expect(needs.guardian).toBe(true);
  });
});
