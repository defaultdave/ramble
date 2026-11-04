import {
  accountBalances,
  bookingPaid,
  cardFee,
  parseLedgerEvent,
  type LedgerEntry,
  type LedgerEntryInput,
  type PostingSplit,
} from './ledger';
import { testIds } from './testIds';

export const orderId = testIds.order;
export const hostId = testIds.host;
export const giftId = testIds.gift;
export const attemptId = testIds.attempt;
export const refundId = testIds.refund;
export const transferId = testIds.transfer;
export const disputeId = testIds.dispute;
export const staffId = testIds.staff;

export const occurredAt = new Date('2026-11-02T15:00:00Z');
export const common = { occurredAt, simulated: true };
export const bookingLinks = { orderId, hostId, paymentAttemptId: attemptId };

// The schemas are private to the module, so the tests reach them through `parseLedgerEvent`.
const safe = (rows: LedgerEntryInput[]) => {
  try {
    parseLedgerEvent(rows);
    return { success: true };
  } catch {
    return { success: false };
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
