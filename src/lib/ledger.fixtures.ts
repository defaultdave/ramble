import { z } from 'zod';
import {
  accountBalances,
  bookingPaid,
  cardFee,
  parseLedgerEvent,
  type LedgerEntry,
  type LedgerEntryInput,
  type OrderFlow,
  type PostingSplit,
} from './ledger';

export const orderId = '11111111-1111-4111-8111-111111111111';
export const hostId = '22222222-2222-4222-8222-222222222222';
export const giftId = '33333333-3333-4333-8333-333333333333';
export const attemptId = '44444444-4444-4444-8444-444444444444';
export const refundId = '55555555-5555-4555-8555-555555555555';
export const transferId = '66666666-6666-4666-8666-666666666666';
export const disputeId = '77777777-7777-4777-8777-777777777777';
export const staffId = '88888888-8888-4888-8888-888888888888';

export const occurredAt = new Date('2026-11-02T15:00:00Z');
export const common = { occurredAt, simulated: true };
export const bookingLinks = { orderId, hostId, paymentAttemptId: attemptId };

export function cashRow(
  over: Partial<LedgerEntryInput> = {},
): LedgerEntryInput {
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

export function plainRow(
  over: Partial<LedgerEntryInput> = {},
): LedgerEntryInput {
  return cashRow({
    entryType: 'refund_host_share',
    debitAccount: 'host_payable',
    creditAccount: 'refunds_pending',
    providerObjectId: null,
    ...over,
  });
}

// The schemas are private to the module, so the tests reach them through `parseLedgerEvent`.
const safe = (rows: LedgerEntryInput[]) => {
  try {
    parseLedgerEvent(rows);
    return { success: true };
  } catch (error) {
    if (error instanceof z.ZodError) return { success: false };
    throw error;
  }
};
export const LedgerEntrySchema = {
  parse: (row: LedgerEntryInput) => parseLedgerEvent([row])[0] as LedgerEntry,
  safeParse: (row: LedgerEntryInput) => safe([row]),
};
export const LedgerEventSchema = { safeParse: safe };
export const balancesOf = (...events: LedgerEntryInput[][]) =>
  accountBalances(events.flat().map((row) => LedgerEntrySchema.parse(row)));

export const total = (rows: LedgerEntryInput[]) =>
  rows.reduce((sum, row) => sum + row.amountMinor, 0);

// Two guests at $65 with the 15 percent commission.
export const worked: PostingSplit = {
  ticketMinor: 13000,
  commissionMinor: 1950,
  taxMinor: 0,
};
export const feeMinor = 407;

export const paidOnce = () => [
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

export function flowsOf(entries: LedgerEntryInput[]): OrderFlow[] {
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
