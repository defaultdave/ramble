import { describe, expect, it } from 'vitest';
import {
  LedgerWindowSchema,
  accountBalances,
  bookingPaid,
  cardFee,
  giftRedeemed,
  hostStatement,
  ledgerAccounts,
  moneyHeld,
  orderLedgerSummaries,
  providerFeeEntries,
  refundFailed,
  refundRequested,
  transferPaid,
  transferReversed,
  type LedgerEntryInput,
  type OrderFlow,
} from './ledger';
import { at } from './testClock';
import {
  orderId,
  hostId,
  giftId,
  attemptId,
  refundId,
  transferId,
  occurredAt,
  common,
  bookingLinks,
  LedgerEntrySchema,
  worked,
  paidOnce,
} from './ledger.fixtures';

// Behaviours under test, one per decision, branch or risk:
// balances
// - an empty ledger has every balance at zero; a balance counts its normal side (cash and expenses
//   by debits, liabilities and income by credits); money held is the three liabilities
// views
// - one summary per booking: gross, tax, commission, fee, refunded (less failed), paid to host (less
//   reversals), owed, simulated, first time, last transfer time; summaries read oldest first
// - a host statement totals its rows; a window must start before it ends

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

describe('providerFeeEntries', () => {
  const payment = {
    providerPaymentId: 'pay_1',
    orderId: '00000000-0000-4000-8000-000000000001',
    hostId: '00000000-0000-4000-8000-000000000002',
    paymentAttemptId: '00000000-0000-4000-8000-000000000003',
    simulated: true,
    at,
  };

  it('posts the reported fee as a card fee under the payment id', () => {
    const [row, ...rest] = providerFeeEntries({ ...payment, feeMinor: 407 });
    expect(rest).toEqual([]);
    expect(row).toMatchObject({
      entryType: 'processing_fee',
      amountMinor: 407,
      providerObjectId: 'pay_1',
      occurredAt: payment.at,
      simulated: true,
      paymentAttemptId: payment.paymentAttemptId,
    });
  });

  it.each([
    ['a fee the provider has not reported', null],
    ['a fee of nothing', 0],
  ])('posts nothing for %s', (_name, feeMinor) => {
    expect(providerFeeEntries({ ...payment, feeMinor })).toEqual([]);
  });
});
