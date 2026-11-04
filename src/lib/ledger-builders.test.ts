import { describe, expect, it } from 'vitest';
import { fakeCardFeeMinor } from './fakeCardFee';
import {
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
  ledgerAccounts,
  moneyHeld,
  rambleSelfPayout,
  refundFailed,
  refundRequested,
  refundSucceeded,
  transferPaid,
  transferReversed,
  type PostingSplit,
} from './ledger';
import {
  orderId,
  hostId,
  giftId,
  refundId,
  transferId,
  disputeId,
  staffId,
  common,
  bookingLinks,
  LedgerEventSchema,
  balancesOf,
  worked,
  feeMinor,
  paidOnce,
} from './ledger.fixtures';
import { commissionMinor, taxMinor } from './pricing';

// Behaviours under test, one per decision, branch or risk:
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
