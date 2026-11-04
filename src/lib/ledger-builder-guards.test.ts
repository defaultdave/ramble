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
  total,
  worked,
} from './ledger.fixtures';

// Behaviours under test, one per decision, branch or risk:
// builders (each output parses, stays within the cap, and nets to the amounts passed)
// - a dispute opened then won leaves only the fee; opened then lost clears the hold into the host and the loss
// - zero legs are left out; negative, fractional, and impossible amounts throw and build nothing
// - what the caller passes through (time, simulated, who, memo, links) lands on every row

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
    const rowsOf = (name: string) =>
      cases.find(([caseName]) => caseName === name)?.[1] ?? [];
    for (const name of ['bookingPaid', 'refundRequested', 'refundFailed']) {
      expect(total(rowsOf(name)), name).toBe(full.ticketMinor + full.taxMinor);
    }
  });
});
