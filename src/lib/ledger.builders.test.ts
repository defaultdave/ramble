import { describe, expect, it } from 'vitest';
import {
  bookingPaid,
  cardFee,
  disputeLost,
  disputeOpened,
  disputeWon,
  giftPurchased,
  giftRedeemed,
  giftRefundedOrExpired,
  giftReinstated,
  ledgerEntryTypes,
  ledgerLimits,
  rambleSelfPayout,
  refundFailed,
  refundRequested,
  refundSucceeded,
  transferPaid,
  transferReversed,
  type LedgerEntryInput,
  type PostingSplit,
} from './ledger';
import {
  orderId,
  hostId,
  giftId,
  attemptId,
  refundId,
  transferId,
  disputeId,
  staffId,
  occurredAt,
  common,
  bookingLinks,
  LedgerEventSchema,
  balancesOf,
  total,
  worked,
  paidOnce,
} from './ledger.fixtures';

// Behaviours under test, one per decision, branch or risk:
// builders (each output parses, stays within the cap, and nets to the amounts passed)
// - a refund requested then failed returns every account to its prior balance; requested then
//   succeeded leaves refunds_pending at zero and takes T + X from cash
// - a gift purchased then redeemed leaves gift_liability at exactly zero; redeemed then reinstated
//   restores it; unused value goes to refunds pending and out through the refund
// - Ramble's own payout needs no order, gift, or host
// - a dispute opened then won leaves only the fee; opened then lost clears the hold into the host and the loss
// - zero legs are left out; negative, fractional, and impossible amounts throw and build nothing
// - what the caller passes through (time, simulated, who, memo, links) lands on every row

const isCashPosting = (entry: {
  debitAccount: string;
  creditAccount: string;
}) =>
  entry.debitAccount === 'platform_cash' ||
  entry.creditAccount === 'platform_cash';

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
