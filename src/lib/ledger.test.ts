import { describe, expect, it } from 'vitest';
import { fakeCardFeeMinor } from './fakeCardFee';
import {
  assertWithinReadCap,
  bookingPaid,
  cardFee,
  ledgerAccounts,
  ledgerEntryTypes,
  ledgerLimits,
  ledgerPostings,
  parseLedgerEvent,
  postOutcome,
  transferPaid,
  transferReversed,
  type LedgerAccount,
  type LedgerEntryInput,
  type PostingSplit,
} from './ledger';
import { orderLimits } from './orders';
import { commissionMinor, taxMinor } from './pricing';
import {
  orderId,
  hostId,
  giftId,
  attemptId,
  transferId,
  staffId,
  occurredAt,
  common,
  bookingLinks,
  LedgerEntrySchema,
  LedgerEventSchema,
  balancesOf,
  worked,
  feeMinor,
  paidOnce,
} from './ledger.fixtures';

// Behaviours under test, one per decision, branch or risk:
// entry schema
// - a cash row with a provider id and a non-cash row without one are accepted; ids are lower-cased
// - refused: the same account on both sides, an amount of zero, below zero, fractional, or over the
//   cap, a currency other than USD, no order or gift or host (except Ramble's own payout), a cash row
//   with no provider id, a non-cash row with one, a blank or over-long provider id, a blank or
//   over-long memo, an invalid or out-of-range time, an unknown entry type or account
// - an event of cash rows or of non-cash rows is accepted; a mix, an empty list, and a list over the
//   cap are refused, and the oversized list is refused before its rows are parsed
// - each entry type accepts exactly its design-doc account pairs (every type, every other pair refused), including the multi-leg ones
// - a read over the group cap is refused, at the cap it is not
// - a half-posted event is a bug: none new is a repeat, all new is a post, anything between throws
// the design doc's worked example (two guests at $65, not taxable, card fee $4.07)
// - host_payable 110.50, ramble_commission 19.50, processing_fees 4.07, platform_cash 125.93
// - a taxable variant adds the tax to host_payable and cash
// builders (each output parses, stays within the cap, and nets to the amounts passed)
// - booking paid, card fee, transfer paid and reversed; a transfer then its reversal restores the balances

function cashRow(over: Partial<LedgerEntryInput> = {}): LedgerEntryInput {
  return {
    occurredAt,
    entryType: 'charge_host_share',
    debitAccount: 'platform_cash',
    creditAccount: 'host_payable',
    amountMinor: 11050,
    currency: 'USD',
    orderId,
    giftId: null,
    hostId,
    paymentAttemptId: attemptId,
    refundId: null,
    transferId: null,
    disputeId: null,
    providerObjectId: 'pi_1',
    simulated: true,
    createdBy: null,
    memo: null,
    ...over,
  };
}

function plainRow(over: Partial<LedgerEntryInput> = {}): LedgerEntryInput {
  return cashRow({
    entryType: 'refund_host_share',
    debitAccount: 'host_payable',
    creditAccount: 'refunds_pending',
    providerObjectId: null,
    ...over,
  });
}

describe('the worked example from the design doc', () => {
  it('derives the same card fee, commission and tax the example uses', () => {
    expect(fakeCardFeeMinor(13000)).toBe(feeMinor);
    expect(commissionMinor(13000, 1500)).toBe(1950);
    expect(taxMinor(13000, 0)).toBe(0);
  });

  it('books host_payable 110.50, ramble_commission 19.50, processing_fees 4.07 and platform_cash 125.93', () => {
    const paid = bookingPaid({
      ...common,
      ...bookingLinks,
      providerObjectId: 'pi_1',
      split: worked,
    });
    const fee = cardFee({
      ...common,
      ...bookingLinks,
      providerObjectId: 'pi_1',
      amountMinor: feeMinor,
    });
    expect(paid.map((row) => row.entryType)).toEqual([
      'charge_host_share',
      'charge_commission',
    ]);
    const balances = balancesOf(paid, fee);
    expect(balances.host_payable).toBe(11050);
    expect(balances.ramble_commission).toBe(1950);
    expect(balances.processing_fees).toBe(407);
    expect(balances.platform_cash).toBe(12593);
  });

  it('adds the tax for a taxable experience to host_payable and to cash', () => {
    const split: PostingSplit = {
      ticketMinor: 13000,
      commissionMinor: 1950,
      taxMinor: taxMinor(13000, 88750),
    };
    expect(split.taxMinor).toBe(1154);
    const paid = bookingPaid({
      ...common,
      ...bookingLinks,
      providerObjectId: 'pi_2',
      split,
    });
    expect(paid.map((row) => row.entryType)).toEqual([
      'charge_host_share',
      'charge_commission',
      'charge_tax',
    ]);
    const balances = balancesOf(paid);
    expect(balances.host_payable).toBe(11050 + 1154);
    expect(balances.platform_cash).toBe(13000 + 1154);
    expect(balances.ramble_commission).toBe(1950);
  });
});

describe('the entry rules', () => {
  it('accepts a cash row with a provider id and a non-cash row without one', () => {
    expect(LedgerEntrySchema.safeParse(cashRow()).success).toBe(true);
    expect(LedgerEntrySchema.safeParse(plainRow()).success).toBe(true);
  });

  it('lower-cases every id', () => {
    const parsed = LedgerEntrySchema.parse(
      cashRow({
        orderId: orderId.toUpperCase(),
        hostId: hostId.toUpperCase(),
        createdBy: staffId.toUpperCase(),
      }),
    );
    expect(parsed.orderId).toBe(orderId);
    expect(parsed.hostId).toBe(hostId);
    expect(parsed.createdBy).toBe(staffId);
  });

  it.each([
    ['the same account on both sides', { creditAccount: 'platform_cash' }],
    ['an amount of zero', { amountMinor: 0 }],
    ['an amount below zero', { amountMinor: -1 }],
    ['a fractional amount', { amountMinor: 10.5 }],
    ['an amount over the cap', { amountMinor: orderLimits.maxMinor + 1 }],
    ['a currency other than USD', { currency: 'EUR' }],
    ['no order, gift, or host', { orderId: null, hostId: null }],
    ['a cash row with no provider id', { providerObjectId: null }],
    ['a blank provider id', { providerObjectId: '   ' }],
    [
      'a provider id over 255 characters',
      { providerObjectId: 'p'.repeat(256) },
    ],
    ['a blank memo', { memo: '  ' }],
    ['a memo over 500 characters', { memo: 'm'.repeat(501) }],
    ['an invalid time', { occurredAt: new Date('nope') }],
    [
      'a time before year 1000',
      { occurredAt: new Date('0999-01-01T00:00:00Z') },
    ],
    ['an unknown entry type', { entryType: 'bonus' }],
    ['an unknown account', { debitAccount: 'petty_cash' }],
    ['a booking id that is not a uuid', { orderId: 'order-1' }],
  ] as const)('refuses %s', (_name, over) => {
    expect(
      LedgerEntrySchema.safeParse(cashRow(over as Partial<LedgerEntryInput>))
        .success,
    ).toBe(false);
  });

  it('refuses a non-cash row that carries a provider id', () => {
    expect(
      LedgerEntrySchema.safeParse(plainRow({ providerObjectId: 'pi_1' }))
        .success,
    ).toBe(false);
  });

  it('accepts a memo of exactly 500 characters and a provider id of exactly 255', () => {
    expect(
      LedgerEntrySchema.safeParse(
        cashRow({ memo: 'm'.repeat(500), providerObjectId: 'p'.repeat(255) }),
      ).success,
    ).toBe(true);
  });

  it("lets Ramble's own payout name no order, gift, or host, and nothing else", () => {
    const payout = cashRow({
      entryType: 'ramble_payout',
      debitAccount: 'ramble_payouts',
      creditAccount: 'platform_cash',
      orderId: null,
      hostId: null,
      paymentAttemptId: null,
    });
    expect(LedgerEntrySchema.safeParse(payout).success).toBe(true);
    expect(
      LedgerEntrySchema.safeParse({ ...payout, entryType: 'charge_tax' })
        .success,
    ).toBe(false);
  });

  it('accepts a gift alone and a host alone as the subject', () => {
    expect(
      LedgerEntrySchema.safeParse(
        cashRow({ orderId: null, hostId: null, giftId }),
      ).success,
    ).toBe(true);
    expect(
      LedgerEntrySchema.safeParse(cashRow({ orderId: null, hostId })).success,
    ).toBe(true);
  });
});

describe('which rows are cash', () => {
  it.each([
    ['debits platform_cash', 'charge_host_share'],
    ['credits platform_cash', 'transfer_to_host'],
  ] as const)('a row that %s needs a provider id', (_name, entryType) => {
    const [debitAccount, creditAccount] = ledgerPostings[entryType][0];
    const row = cashRow({ entryType, debitAccount, creditAccount });
    expect(LedgerEntrySchema.safeParse(row).success).toBe(true);
    expect(
      LedgerEntrySchema.safeParse({ ...row, providerObjectId: null }).success,
    ).toBe(false);
  });

  it('a row that touches neither side takes no provider id', () => {
    expect(LedgerEntrySchema.safeParse(plainRow()).success).toBe(true);
    expect(
      LedgerEntrySchema.safeParse(plainRow({ providerObjectId: 'pi_1' }))
        .success,
    ).toBe(false);
  });
});

type LedgerEntryType = (typeof ledgerEntryTypes)[number];

describe('which accounts each entry type moves money between', () => {
  const pairsOf = (entryType: LedgerEntryType) =>
    ledgerPostings[entryType] as readonly (readonly [
      LedgerAccount,
      LedgerAccount,
    ])[];
  const rowFor = (
    entryType: LedgerEntryType,
    debitAccount: LedgerAccount,
    creditAccount: LedgerAccount,
  ) =>
    cashRow({
      entryType,
      debitAccount,
      creditAccount,
      providerObjectId:
        debitAccount === 'platform_cash' || creditAccount === 'platform_cash'
          ? 'pi_1'
          : null,
    });

  it('is exactly the postings table of design doc 4.2.3', () => {
    // Typed out by hand from the design doc, so an edit to the map cannot pass by editing both.
    const designDoc = [
      ['charge_host_share', 'platform_cash', 'host_payable'],
      ['charge_commission', 'platform_cash', 'ramble_commission'],
      ['charge_tax', 'platform_cash', 'host_payable'],
      ['processing_fee', 'processing_fees', 'platform_cash'],
      ['transfer_to_host', 'host_payable', 'platform_cash'],
      ['transfer_reversal', 'platform_cash', 'host_payable'],
      ['refund_host_share', 'host_payable', 'refunds_pending'],
      ['commission_returned', 'ramble_commission', 'refunds_pending'],
      ['refund_tax', 'host_payable', 'refunds_pending'],
      ['refund_cash_out', 'refunds_pending', 'platform_cash'],
      ['refund_reversal', 'refunds_pending', 'host_payable'],
      ['refund_reversal', 'refunds_pending', 'ramble_commission'],
      ['gift_liability_in', 'platform_cash', 'gift_liability'],
      ['gift_to_host_share', 'gift_liability', 'host_payable'],
      ['gift_to_commission', 'gift_liability', 'ramble_commission'],
      ['gift_to_tax', 'gift_liability', 'host_payable'],
      ['gift_refund', 'gift_liability', 'refunds_pending'],
      ['gift_reinstated', 'host_payable', 'gift_liability'],
      ['gift_reinstated', 'ramble_commission', 'gift_liability'],
      ['ramble_payout', 'ramble_payouts', 'platform_cash'],
      ['dispute_withdrawal', 'dispute_hold', 'platform_cash'],
      ['dispute_fee', 'processing_fees', 'platform_cash'],
      ['dispute_reinstated', 'platform_cash', 'dispute_hold'],
      ['dispute_to_host', 'host_payable', 'dispute_hold'],
      ['dispute_loss', 'dispute_losses', 'dispute_hold'],
    ];
    expect(designDoc).toHaveLength(25);
    const inMap = Object.entries(ledgerPostings).flatMap(([type, pairs]) =>
      pairs.map(([debit, credit]) => [type, debit, credit]),
    );
    expect(inMap.toSorted()).toEqual(designDoc.toSorted());
  });

  it('lists every entry type, once', () => {
    expect(Object.keys(ledgerPostings).toSorted()).toEqual(
      [...ledgerEntryTypes].toSorted(),
    );
  });

  it.each(ledgerEntryTypes)('%s accepts each of its pairs', (entryType) => {
    for (const [debit, credit] of pairsOf(entryType)) {
      expect(
        LedgerEntrySchema.safeParse(rowFor(entryType, debit, credit)).success,
        `${entryType} ${debit} ${credit}`,
      ).toBe(true);
    }
  });

  it.each(ledgerEntryTypes)('%s refuses every other pair', (entryType) => {
    for (const debit of ledgerAccounts) {
      for (const credit of ledgerAccounts) {
        if (debit === credit) continue;
        const allowed = pairsOf(entryType).some(
          ([d, c]) => d === debit && c === credit,
        );
        if (allowed) continue;
        expect(
          LedgerEntrySchema.safeParse(rowFor(entryType, debit, credit)).success,
          `${entryType} ${debit} ${credit}`,
        ).toBe(false);
      }
    }
  });

  it('refuses a commission charge that debits ramble_payouts', () => {
    expect(
      LedgerEntrySchema.safeParse(
        rowFor('charge_commission', 'ramble_payouts', 'platform_cash'),
      ).success,
    ).toBe(false);
  });

  it('gives the multi-leg types both legs and the single-leg types one', () => {
    const legs = Object.fromEntries(
      ledgerEntryTypes.map((type) => [type, pairsOf(type).length]),
    );
    expect(legs.refund_reversal).toBe(2);
    expect(legs.gift_reinstated).toBe(2);
    expect(legs.gift_to_host_share).toBe(1);
    expect(legs.dispute_to_host).toBe(1);
    expect(legs.dispute_loss).toBe(1);
  });
});

describe('assertWithinReadCap', () => {
  it('accepts a count at the cap and below', () => {
    expect(() => {
      assertWithinReadCap(0);
      assertWithinReadCap(ledgerLimits.maxReadGroups);
    }).not.toThrow();
  });

  it('refuses a count over the cap', () => {
    expect(() => {
      assertWithinReadCap(ledgerLimits.maxReadGroups + 1);
    }).toThrow(RangeError);
  });
});

describe('the event schema', () => {
  it('accepts an event of cash rows and an event of non-cash rows', () => {
    expect(
      LedgerEventSchema.safeParse([
        cashRow(),
        cashRow({
          entryType: 'charge_commission',
          creditAccount: 'ramble_commission',
        }),
      ]).success,
    ).toBe(true);
    expect(LedgerEventSchema.safeParse([plainRow(), plainRow()]).success).toBe(
      true,
    );
  });

  it('refuses a mix of cash and non-cash rows', () => {
    expect(LedgerEventSchema.safeParse([cashRow(), plainRow()]).success).toBe(
      false,
    );
  });

  it('refuses an empty event', () => {
    expect(LedgerEventSchema.safeParse([]).success).toBe(false);
  });

  it('refuses an event over the cap without parsing a single row', () => {
    const rows = Array.from(
      { length: ledgerLimits.maxEntriesPerPost + 1 },
      () => plainRow(),
    );
    // A getter that throws would fail the test if any row were read.
    const trap = rows.map(
      () =>
        new Proxy(plainRow(), {
          get() {
            throw new Error('a row was read');
          },
        }),
    );
    expect(() => parseLedgerEvent(trap)).toThrow(RangeError);
    expect(() => parseLedgerEvent(rows)).toThrow(RangeError);
  });

  it('returns the parsed rows of a good event', () => {
    expect(
      parseLedgerEvent([plainRow({ orderId: orderId.toUpperCase() })])[0]
        ?.orderId,
    ).toBe(orderId);
  });
});

describe('postOutcome', () => {
  it.each([
    [3, 3, 'posted'],
    [1, 1, 'posted'],
    [3, 0, 'already_posted'],
    [1, 0, 'already_posted'],
  ] as const)(
    '%i rows in the event, %i new: %s',
    (inEvent, inserted, outcome) => {
      expect(postOutcome(inEvent, inserted)).toBe(outcome);
    },
  );

  it.each([
    [3, 1],
    [3, 2],
    [2, 1],
  ])(
    'throws when %i rows are in the event and only %i are new',
    (inEvent, inserted) => {
      expect(() => postOutcome(inEvent, inserted)).toThrow(/Half-posted/);
    },
  );
});

describe('transfers', () => {
  it('pays the host out of cash and a reversal brings it back', () => {
    const before = balancesOf(...paidOnce());
    const links = { ...common, orderId, hostId, transferId };
    const paid = transferPaid({
      ...links,
      providerObjectId: 'tr_1',
      amountMinor: 11050,
    });
    const afterPaid = balancesOf(...paidOnce(), paid);
    expect(afterPaid.host_payable).toBe(0);
    expect(afterPaid.platform_cash).toBe(before.platform_cash - 11050);
    expect(paid[0]?.providerObjectId).toBe('tr_1');

    const reversed = transferReversed({
      ...links,
      providerObjectId: 'trr_1',
      amountMinor: 11050,
    });
    expect(balancesOf(...paidOnce(), paid, reversed)).toEqual(before);
  });
});
