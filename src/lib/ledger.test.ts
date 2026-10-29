import { describe, expect, it } from 'vitest';
import { fakeCardFeeMinor } from './fakeCardFee';
import {
  LedgerEntrySchema,
  LedgerEventSchema,
  LedgerWindowSchema,
  accountBalances,
  bookingPaid,
  cardFee,
  disputeLost,
  disputeOpened,
  disputeWon,
  giftPurchased,
  giftRedeemed,
  giftRefundedOrExpired,
  giftReinstated,
  hostStatement,
  isCashPosting,
  ledgerAccounts,
  ledgerEntryTypes,
  ledgerLimits,
  moneyHeld,
  orderLedgerSummaries,
  parseLedgerEvent,
  postOutcome,
  rambleSelfPayout,
  refundFailed,
  refundRequested,
  refundSucceeded,
  transferPaid,
  transferReversed,
  type LedgerEntryInput,
  type OrderFlow,
  type PostingSplit,
} from './ledger';
import { orderLimits } from './orders';
import { commissionMinor, taxMinor } from './pricing';

// Behaviours under test, one per decision, branch or risk:
// entry schema
// - a cash row with a provider id and a non-cash row without one are accepted; ids are lower-cased
// - refused: the same account on both sides, an amount of zero, below zero, fractional, or over the
//   cap, a currency other than USD, no order or gift or host (except Ramble's own payout), a cash row
//   with no provider id, a non-cash row with one, a blank or over-long provider id, a blank or
//   over-long memo, an invalid or out-of-range time, an unknown entry type or account
// - an event of cash rows or of non-cash rows is accepted; a mix, an empty list, and a list over the
//   cap are refused, and the oversized list is refused before its rows are parsed
// - a half-posted event is a bug: none new is a repeat, all new is a post, anything between throws
// balances
// - an empty ledger has every balance at zero; a balance counts its normal side (cash and expenses
//   by debits, liabilities and income by credits); money held is the three liabilities
// the design doc's worked example (two guests at $65, not taxable, card fee $4.07)
// - host_payable 110.50, ramble_commission 19.50, processing_fees 4.07, platform_cash 125.93
// - a taxable variant adds the tax to host_payable and cash
// builders (each output parses, stays within the cap, and nets to the amounts passed)
// - booking paid, card fee, transfer paid and reversed; a transfer then its reversal restores the balances
// - a refund requested then failed returns every account to its prior balance; requested then
//   succeeded leaves refunds_pending at zero and takes T + X from cash
// - a gift purchased then redeemed leaves gift_liability at exactly zero; redeemed then reinstated
//   restores it; unused value goes to refunds pending and out through the refund
// - Ramble's own payout needs no order, gift, or host
// - a dispute opened then won leaves only the fee; opened then lost clears the hold into the host and the loss
// - zero legs are left out; negative, fractional, and impossible amounts throw and build nothing
// - what the caller passes through (time, simulated, who, memo, links) lands on every row
// views
// - one summary per booking: gross, tax, commission, fee, refunded (less failed), paid to host (less
//   reversals), owed, simulated, first time, last transfer time; summaries read oldest first
// - a host statement totals its rows; a window must start before it ends

const orderId = '11111111-1111-4111-8111-111111111111';
const hostId = '22222222-2222-4222-8222-222222222222';
const giftId = '33333333-3333-4333-8333-333333333333';
const attemptId = '44444444-4444-4444-8444-444444444444';
const refundId = '55555555-5555-4555-8555-555555555555';
const transferId = '66666666-6666-4666-8666-666666666666';
const disputeId = '77777777-7777-4777-8777-777777777777';
const staffId = '88888888-8888-4888-8888-888888888888';

const occurredAt = new Date('2026-11-02T15:00:00Z');
const common = { occurredAt, simulated: true };
const bookingLinks = { orderId, hostId, paymentAttemptId: attemptId };

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

const balancesOf = (...events: LedgerEntryInput[][]) =>
  accountBalances(events.flat().map((row) => LedgerEntrySchema.parse(row)));

const total = (rows: LedgerEntryInput[]) =>
  rows.reduce((sum, row) => sum + row.amountMinor, 0);

// Two guests at $65 with the 15 percent commission.
const worked: PostingSplit = {
  ticketMinor: 13000,
  commissionMinor: 1950,
  taxMinor: 0,
};
const feeMinor = 407;

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

describe('LedgerEntrySchema', () => {
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

describe('isCashPosting', () => {
  it.each([
    ['debits platform_cash', 'platform_cash', 'host_payable', true],
    ['credits platform_cash', 'host_payable', 'platform_cash', true],
    ['touches neither side', 'host_payable', 'refunds_pending', false],
  ] as const)('a row that %s', (_name, debitAccount, creditAccount, cash) => {
    expect(isCashPosting({ debitAccount, creditAccount })).toBe(cash);
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

describe('accountBalances and moneyHeld', () => {
  it('start at zero, not negative zero, on an empty ledger', () => {
    const balances = accountBalances([]);
    expect(Object.keys(balances)).toEqual([...ledgerAccounts]);
    for (const account of ledgerAccounts) {
      expect(Object.is(balances[account], 0), account).toBe(true);
    }
  });

  it('counts a balance on its normal side', () => {
    const balances = accountBalances([
      {
        debitAccount: 'platform_cash',
        creditAccount: 'host_payable',
        amountMinor: 500,
      },
      {
        debitAccount: 'processing_fees',
        creditAccount: 'platform_cash',
        amountMinor: 30,
      },
    ]);
    expect(balances.platform_cash).toBe(470);
    expect(balances.host_payable).toBe(500);
    expect(balances.processing_fees).toBe(30);
  });

  it('holds three liabilities as money held', () => {
    const balances = accountBalances([
      {
        debitAccount: 'platform_cash',
        creditAccount: 'host_payable',
        amountMinor: 700,
      },
      {
        debitAccount: 'platform_cash',
        creditAccount: 'gift_liability',
        amountMinor: 200,
      },
      {
        debitAccount: 'host_payable',
        creditAccount: 'refunds_pending',
        amountMinor: 50,
      },
      {
        debitAccount: 'platform_cash',
        creditAccount: 'ramble_commission',
        amountMinor: 900,
      },
    ]);
    expect(moneyHeld(balances)).toBe(650 + 200 + 50);
    expect(moneyHeld(balances)).toBe(
      balances.host_payable +
        balances.gift_liability +
        balances.refunds_pending,
    );
  });
});

const paidOnce = () => [
  bookingPaid({
    ...common,
    ...bookingLinks,
    providerObjectId: 'pi_1',
    split: worked,
  }),
  cardFee({
    ...common,
    ...bookingLinks,
    providerObjectId: 'pi_1',
    amountMinor: feeMinor,
  }),
];

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

describe('refunds', () => {
  const split: PostingSplit = {
    ticketMinor: 6500,
    commissionMinor: 975,
    taxMinor: 0,
  };
  const links = { ...common, orderId, hostId, refundId };

  it('requested posts T - c, c and X without moving cash, with no provider id', () => {
    const requested = refundRequested({
      ...links,
      split: { ...split, taxMinor: 577 },
    });
    expect(requested.map((row) => [row.entryType, row.amountMinor])).toEqual([
      ['refund_host_share', 5525],
      ['commission_returned', 975],
      ['refund_tax', 577],
    ]);
    expect(requested.every((row) => row.providerObjectId === null)).toBe(true);
    expect(balancesOf(...paidOnce(), requested).platform_cash).toBe(
      balancesOf(...paidOnce()).platform_cash,
    );
  });

  it('requested then failed returns every account to its prior balance', () => {
    const before = balancesOf(...paidOnce());
    const requested = refundRequested({
      ...links,
      split: { ...split, taxMinor: 577 },
    });
    const failed = refundFailed({
      ...links,
      split: { ...split, taxMinor: 577 },
    });
    expect(failed).toHaveLength(3);
    expect(failed.every((row) => row.entryType === 'refund_reversal')).toBe(
      true,
    );
    expect(balancesOf(...paidOnce(), requested).refunds_pending).toBe(
      6500 + 577,
    );
    expect(balancesOf(...paidOnce(), requested, failed)).toEqual(before);
  });

  it('requested then succeeded empties refunds_pending and takes T + X from cash', () => {
    const before = balancesOf(...paidOnce());
    const requested = refundRequested({ ...links, split });
    const out = refundSucceeded({
      ...links,
      providerObjectId: 're_1',
      amountMinor: 6500,
    });
    const after = balancesOf(...paidOnce(), requested, out);
    expect(after.refunds_pending).toBe(0);
    expect(after.platform_cash).toBe(before.platform_cash - 6500);
    expect(after.host_payable).toBe(before.host_payable - 5525);
    expect(after.ramble_commission).toBe(before.ramble_commission - 975);
    expect(out[0]?.providerObjectId).toBe('re_1');
  });

  it('leaves out a leg of zero', () => {
    const rows = refundRequested({
      ...links,
      split: { ticketMinor: 500, commissionMinor: 0, taxMinor: 0 },
    });
    expect(rows.map((row) => row.entryType)).toEqual(['refund_host_share']);
  });

  it('refunds a tax-only split', () => {
    const rows = refundRequested({
      ...links,
      split: { ticketMinor: 0, commissionMinor: 0, taxMinor: 40 },
    });
    expect(rows.map((row) => row.entryType)).toEqual(['refund_tax']);
  });
});

describe('gifts', () => {
  const giftLinks = { ...common, giftId };
  const redemption = { ...common, giftId, orderId, hostId };
  const taxable: PostingSplit = {
    ticketMinor: 8500,
    commissionMinor: 1275,
    taxMinor: 754,
  };
  const value = taxable.ticketMinor + taxable.taxMinor;

  it('purchased then redeemed leaves gift_liability at exactly zero', () => {
    const purchased = giftPurchased({
      ...giftLinks,
      providerObjectId: 'pi_g',
      amountMinor: value,
    });
    expect(balancesOf(purchased).gift_liability).toBe(value);
    const redeemed = giftRedeemed({ ...redemption, split: taxable });
    const after = balancesOf(purchased, redeemed);
    expect(after.gift_liability).toBe(0);
    expect(after.host_payable).toBe(8500 - 1275 + 754);
    expect(after.ramble_commission).toBe(1275);
    expect(redeemed.map((row) => row.entryType)).toEqual([
      'gift_to_host_share',
      'gift_to_commission',
      'gift_to_tax',
    ]);
  });

  it('redeemed then reinstated restores the liability to its pre-redemption balance', () => {
    const purchased = giftPurchased({
      ...giftLinks,
      providerObjectId: 'pi_g',
      amountMinor: value,
    });
    const before = balancesOf(purchased);
    const redeemed = giftRedeemed({ ...redemption, split: taxable });
    const reinstated = giftReinstated({ ...redemption, split: taxable });
    expect(reinstated).toHaveLength(3);
    expect(balancesOf(purchased, redeemed, reinstated)).toEqual(before);
  });

  it('refunded or expired moves the value to refunds pending, and the refund pays it out', () => {
    const purchased = giftPurchased({
      ...giftLinks,
      providerObjectId: 'pi_g',
      amountMinor: value,
    });
    const refunded = giftRefundedOrExpired({
      ...giftLinks,
      amountMinor: value,
    });
    const mid = balancesOf(purchased, refunded);
    expect(mid.gift_liability).toBe(0);
    expect(mid.refunds_pending).toBe(value);
    const out = refundSucceeded({
      ...giftLinks,
      refundId,
      providerObjectId: 're_g',
      amountMinor: value,
    });
    const end = balancesOf(purchased, refunded, out);
    expect(end.refunds_pending).toBe(0);
    expect(end.platform_cash).toBe(0);
  });
});

describe("Ramble's own payout", () => {
  it('moves cash to ramble_payouts and needs no order, gift, or host', () => {
    const rows = rambleSelfPayout({
      ...common,
      providerObjectId: 'po_1',
      amountMinor: 1950,
      createdBy: staffId,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      orderId: null,
      giftId: null,
      hostId: null,
      createdBy: staffId,
    });
    const balances = balancesOf(...paidOnce(), rows);
    expect(balances.ramble_payouts).toBe(1950);
    expect(balances.platform_cash).toBe(12593 - 1950);
    expect(LedgerEventSchema.safeParse(rows).success).toBe(true);
  });
});

describe('disputes', () => {
  const links = { ...common, orderId, hostId, disputeId };

  it('opened takes the amount into the hold and the fee into processing fees, both from cash', () => {
    const opened = disputeOpened({
      ...links,
      providerObjectId: 'dp_1',
      amountMinor: 13000,
      feeMinor: 1500,
    });
    const balances = balancesOf(...paidOnce(), opened);
    expect(balances.dispute_hold).toBe(13000);
    expect(balances.processing_fees).toBe(407 + 1500);
    expect(balances.platform_cash).toBe(12593 - 13000 - 1500);
  });

  it('opened with no fee posts the withdrawal alone', () => {
    const opened = disputeOpened({
      ...links,
      providerObjectId: 'dp_1',
      amountMinor: 13000,
      feeMinor: 0,
    });
    expect(opened.map((row) => row.entryType)).toEqual(['dispute_withdrawal']);
  });

  it('won returns the amount to cash and keeps only the fee', () => {
    const opened = disputeOpened({
      ...links,
      providerObjectId: 'dp_1',
      amountMinor: 13000,
      feeMinor: 1500,
    });
    const won = disputeWon({
      ...links,
      providerObjectId: 'dp_1',
      amountMinor: 13000,
    });
    const balances = balancesOf(...paidOnce(), opened, won);
    expect(balances.dispute_hold).toBe(0);
    expect(balances.platform_cash).toBe(12593 - 1500);
  });

  it('lost clears the hold into what the host covers and the loss for the rest', () => {
    const opened = disputeOpened({
      ...links,
      providerObjectId: 'dp_1',
      amountMinor: 13000,
      feeMinor: 0,
    });
    const lost = disputeLost({
      ...links,
      amountMinor: 13000,
      hostCoveredMinor: 9000,
    });
    const balances = balancesOf(...paidOnce(), opened, lost);
    expect(balances.dispute_hold).toBe(0);
    expect(balances.host_payable).toBe(11050 - 9000);
    expect(balances.dispute_losses).toBe(4000);
  });

  it('lost with the host covering all or nothing posts one row', () => {
    expect(
      disputeLost({ ...links, amountMinor: 500, hostCoveredMinor: 500 }).map(
        (r) => r.entryType,
      ),
    ).toEqual(['dispute_to_host']);
    expect(
      disputeLost({ ...links, amountMinor: 500, hostCoveredMinor: 0 }).map(
        (r) => r.entryType,
      ),
    ).toEqual(['dispute_loss']);
  });
});

describe('what a builder carries onto every row', () => {
  it('passes the time, simulated, who posted, the memo, and the links', () => {
    const rows = bookingPaid({
      occurredAt,
      simulated: false,
      createdBy: staffId,
      memo: 'by hand',
      ...bookingLinks,
      providerObjectId: 'pi_9',
      split: { ...worked, taxMinor: 100 },
    });
    expect(rows).toHaveLength(3);
    for (const row of rows) {
      expect(row).toMatchObject({
        occurredAt,
        simulated: false,
        createdBy: staffId,
        memo: 'by hand',
        orderId,
        hostId,
        paymentAttemptId: attemptId,
        giftId: null,
        refundId: null,
        currency: 'USD',
        providerObjectId: 'pi_9',
      });
    }
  });
});

describe('what a builder refuses', () => {
  const sale = { ...common, ...bookingLinks, providerObjectId: 'pi_1' };
  const refundLinks = { ...common, orderId, hostId, refundId };

  it.each([
    [
      'a commission over the ticket',
      { ticketMinor: 100, commissionMinor: 101, taxMinor: 0 },
    ],
    ['a negative tax', { ticketMinor: 100, commissionMinor: 10, taxMinor: -1 }],
    [
      'a fractional ticket',
      { ticketMinor: 100.5, commissionMinor: 10, taxMinor: 0 },
    ],
    ['a split of nothing', { ticketMinor: 0, commissionMinor: 0, taxMinor: 0 }],
    [
      'a split past the safe integers',
      { ticketMinor: 2 ** 53, commissionMinor: 0, taxMinor: 0 },
    ],
  ])('a split with %s throws, for a sale and for a refund', (_name, split) => {
    expect(() => bookingPaid({ ...sale, split })).toThrow(RangeError);
    expect(() => refundRequested({ ...refundLinks, split })).toThrow(
      RangeError,
    );
  });

  it.each([0, -5, 1.5, Number.NaN])('an amount of %s throws', (amountMinor) => {
    expect(() => cardFee({ ...sale, amountMinor })).toThrow(RangeError);
    expect(() =>
      transferPaid({
        ...common,
        orderId,
        hostId,
        transferId,
        providerObjectId: 't',
        amountMinor,
      }),
    ).toThrow(RangeError);
    expect(() =>
      giftRefundedOrExpired({ ...common, giftId, amountMinor }),
    ).toThrow(RangeError);
    expect(() =>
      rambleSelfPayout({ ...common, providerObjectId: 'p', amountMinor }),
    ).toThrow(RangeError);
  });

  it('a host cover over the disputed amount, or below zero, throws', () => {
    const links = { ...common, orderId, hostId, disputeId };
    expect(() =>
      disputeLost({ ...links, amountMinor: 100, hostCoveredMinor: 101 }),
    ).toThrow(RangeError);
    expect(() =>
      disputeLost({ ...links, amountMinor: 100, hostCoveredMinor: -1 }),
    ).toThrow(RangeError);
    expect(() =>
      disputeOpened({
        ...links,
        providerObjectId: 'd',
        amountMinor: 100,
        feeMinor: -1,
      }),
    ).toThrow(RangeError);
  });
});

describe('every builder emits rows the schema accepts, within the cap', () => {
  const full: PostingSplit = {
    ticketMinor: 9000,
    commissionMinor: 1350,
    taxMinor: 800,
  };
  const cases: [string, LedgerEntryInput[]][] = [
    [
      'bookingPaid',
      bookingPaid({
        ...common,
        ...bookingLinks,
        providerObjectId: 'a',
        split: full,
      }),
    ],
    [
      'cardFee',
      cardFee({
        ...common,
        ...bookingLinks,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'transferPaid',
      transferPaid({
        ...common,
        orderId,
        hostId,
        transferId,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'transferReversed',
      transferReversed({
        ...common,
        orderId,
        hostId,
        transferId,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'refundRequested',
      refundRequested({ ...common, orderId, hostId, refundId, split: full }),
    ],
    [
      'refundSucceeded',
      refundSucceeded({
        ...common,
        orderId,
        refundId,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'refundFailed',
      refundFailed({ ...common, orderId, hostId, refundId, split: full }),
    ],
    [
      'giftPurchased',
      giftPurchased({
        ...common,
        giftId,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'giftRedeemed',
      giftRedeemed({ ...common, giftId, orderId, hostId, split: full }),
    ],
    [
      'giftRefundedOrExpired',
      giftRefundedOrExpired({ ...common, giftId, amountMinor: 5 }),
    ],
    [
      'giftReinstated',
      giftReinstated({ ...common, giftId, orderId, hostId, split: full }),
    ],
    [
      'rambleSelfPayout',
      rambleSelfPayout({ ...common, providerObjectId: 'a', amountMinor: 5 }),
    ],
    [
      'disputeOpened',
      disputeOpened({
        ...common,
        orderId,
        hostId,
        disputeId,
        providerObjectId: 'a',
        amountMinor: 5,
        feeMinor: 5,
      }),
    ],
    [
      'disputeWon',
      disputeWon({
        ...common,
        orderId,
        hostId,
        disputeId,
        providerObjectId: 'a',
        amountMinor: 5,
      }),
    ],
    [
      'disputeLost',
      disputeLost({
        ...common,
        orderId,
        hostId,
        disputeId,
        amountMinor: 10,
        hostCoveredMinor: 5,
      }),
    ],
  ];

  it.each(cases)('%s', (_name, rows) => {
    expect(rows.length).toBeGreaterThan(0);
    expect(LedgerEventSchema.safeParse(rows).success).toBe(true);
  });

  it('puts a provider id on exactly the rows that touch platform_cash', () => {
    for (const [, rows] of cases) {
      for (const row of rows) {
        expect(row.providerObjectId !== null).toBe(isCashPosting(row));
      }
    }
  });

  it('keeps the cap at the largest builder output, and every entry type is used by a builder', () => {
    expect(Math.max(...cases.map(([, rows]) => rows.length))).toBe(
      ledgerLimits.maxEntriesPerPost,
    );
    const used = new Set(
      cases.flatMap(([, rows]) => rows.map((row) => row.entryType)),
    );
    expect([...used].toSorted()).toEqual([...ledgerEntryTypes].toSorted());
  });

  it('adds up each event to the amounts it was given', () => {
    expect(total(cases[0]?.[1] ?? [])).toBe(full.ticketMinor + full.taxMinor);
    expect(total(cases[4]?.[1] ?? [])).toBe(full.ticketMinor + full.taxMinor);
    expect(total(cases[6]?.[1] ?? [])).toBe(full.ticketMinor + full.taxMinor);
  });
});

function flowsOf(entries: LedgerEntryInput[]): OrderFlow[] {
  return entries.map((row) => {
    const parsed = LedgerEntrySchema.parse(row);
    return {
      orderId: parsed.orderId ?? '',
      hostId: parsed.hostId,
      entryType: parsed.entryType,
      debitAccount: parsed.debitAccount,
      creditAccount: parsed.creditAccount,
      amountMinor: parsed.amountMinor,
      simulated: parsed.simulated,
      firstAt: parsed.occurredAt,
      lastAt: parsed.occurredAt,
    };
  });
}

describe('order summaries and the host statement', () => {
  const later = new Date('2026-11-09T15:00:00Z');
  const links = { orderId, hostId, refundId, transferId };

  it('summarize a booking from payment to transfer, refund and failed refund', () => {
    const entries = [
      ...paidOnce().flat(),
      ...refundRequested({
        ...common,
        ...links,
        split: { ticketMinor: 6500, commissionMinor: 975, taxMinor: 0 },
      }),
      ...refundFailed({
        ...common,
        ...links,
        split: { ticketMinor: 6500, commissionMinor: 975, taxMinor: 0 },
      }),
      ...refundRequested({
        ...common,
        ...links,
        split: { ticketMinor: 1300, commissionMinor: 195, taxMinor: 0 },
      }),
      ...transferPaid({
        ...common,
        occurredAt: later,
        ...links,
        providerObjectId: 'tr_1',
        amountMinor: 9945,
      }),
      ...transferReversed({
        ...common,
        occurredAt: later,
        ...links,
        providerObjectId: 'trr_1',
        amountMinor: 45,
      }),
    ];
    const [summary, ...rest] = orderLedgerSummaries(flowsOf(entries));
    expect(rest).toEqual([]);
    expect(summary).toEqual({
      orderId,
      hostId,
      grossMinor: 13000,
      taxMinor: 0,
      commissionMinor: 1950,
      processingFeeMinor: 407,
      refundedMinor: 1300,
      paidToHostMinor: 9900,
      owedToHostMinor: 11050 - 1105 - 9945 + 45,
      simulated: true,
      firstAt: occurredAt,
      paidAt: later,
    });
  });

  it('count a booking paid by a gift in its gross, tax and commission', () => {
    const entries = giftRedeemed({
      ...common,
      giftId,
      orderId,
      hostId,
      split: { ticketMinor: 8500, commissionMinor: 1275, taxMinor: 754 },
    });
    const [summary] = orderLedgerSummaries(flowsOf(entries));
    expect(summary).toMatchObject({
      grossMinor: 8500,
      taxMinor: 754,
      commissionMinor: 1275,
      paidAt: null,
    });
  });

  it('say a booking is not simulated only when none of its rows are', () => {
    const real = bookingPaid({
      occurredAt,
      simulated: false,
      ...bookingLinks,
      providerObjectId: 'pi_r',
      split: worked,
    });
    expect(orderLedgerSummaries(flowsOf(real))[0]?.simulated).toBe(false);
    const mixed = [
      ...real,
      ...cardFee({
        ...common,
        ...bookingLinks,
        providerObjectId: 'pi_r',
        amountMinor: 5,
      }),
    ];
    expect(orderLedgerSummaries(flowsOf(mixed))[0]?.simulated).toBe(true);
  });

  it('read oldest booking first, and by order id when they share a time', () => {
    const second = '99999999-9999-4999-8999-999999999999';
    const other = bookingPaid({
      occurredAt: later,
      simulated: true,
      orderId: second,
      hostId,
      paymentAttemptId: attemptId,
      providerObjectId: 'pi_2',
      split: worked,
    });
    const same = bookingPaid({
      ...common,
      orderId: second,
      hostId,
      paymentAttemptId: attemptId,
      providerObjectId: 'pi_3',
      split: worked,
    });
    const first = bookingPaid({
      ...common,
      ...bookingLinks,
      providerObjectId: 'pi_1',
      split: worked,
    });
    expect(
      orderLedgerSummaries(flowsOf([...other, ...same, ...first])).map(
        (row) => row.orderId,
      ),
    ).toEqual([orderId, second]);
    expect(
      orderLedgerSummaries(flowsOf([...other])).map((row) => row.orderId),
    ).toEqual([second]);
  });

  it('give an empty statement for no rows', () => {
    expect(hostStatement([])).toEqual({
      rows: [],
      totals: {
        grossMinor: 0,
        taxMinor: 0,
        commissionMinor: 0,
        processingFeeMinor: 0,
        refundedMinor: 0,
        paidToHostMinor: 0,
        owedToHostMinor: 0,
      },
    });
  });

  it('total the rows of a statement', () => {
    const second = '99999999-9999-4999-8999-999999999999';
    const entries = [
      ...paidOnce().flat(),
      ...bookingPaid({
        ...common,
        orderId: second,
        hostId,
        paymentAttemptId: attemptId,
        providerObjectId: 'pi_2',
        split: { ticketMinor: 1000, commissionMinor: 150, taxMinor: 89 },
      }),
    ];
    const statement = hostStatement(flowsOf(entries));
    expect(statement.rows).toHaveLength(2);
    expect(statement.totals).toEqual({
      grossMinor: 14000,
      taxMinor: 89,
      commissionMinor: 2100,
      processingFeeMinor: 407,
      refundedMinor: 0,
      paidToHostMinor: 0,
      owedToHostMinor: 11050 + 850 + 89,
    });
  });
});

describe('LedgerWindowSchema', () => {
  const from = new Date('2026-11-01T00:00:00Z');
  const to = new Date('2026-12-01T00:00:00Z');

  it('accepts a window that starts before it ends', () => {
    expect(LedgerWindowSchema.parse({ from, to })).toEqual({ from, to });
  });

  it.each([
    ['ends where it starts', { from, to: from }],
    ['ends before it starts', { from: to, to: from }],
    ['has an invalid start', { from: new Date('x'), to }],
  ])('refuses a window that %s', (_name, window) => {
    expect(LedgerWindowSchema.safeParse(window).success).toBe(false);
  });
});
