import { describe, expect, it } from 'vitest';
import { isTerminal } from './transitions';
import {
  TransferSchema,
  canTransferTransition,
  transferProviderKey,
  transferReleaseAfter,
  transferStatuses,
  transferTransitions,
  type TransferStatus,
} from './transfers';

// Behaviours under test, one per decision, branch or risk.
// - transfer transitions: the weekly job's moves; paid never changes; a failed transfer is released again
// - provider key from the order
// - TransferSchema: the amount is unset while scheduled and above zero once sent; reversals stay within it

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const orderId = id(1);

describe('transfer transitions', () => {
  const allowed: [TransferStatus, TransferStatus][] = [
    ['scheduled', 'releasing'],
    ['scheduled', 'skipped'],
    ['scheduled', 'simulated'],
    ['releasing', 'paid'],
    ['releasing', 'failed'],
    ['releasing', 'reversed'],
    ['failed', 'releasing'],
  ];

  it.each(allowed)('allows %s to %s', (from, to) => {
    expect(canTransferTransition(from, to)).toBe(true);
  });

  it('refuses every other pair', () => {
    for (const from of transferStatuses) {
      for (const to of transferStatuses) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canTransferTransition(from, to)).toBe(expected);
      }
    }
  });

  it.each(['paid', 'reversed', 'skipped', 'simulated'] as const)(
    '%s never changes',
    (status) => {
      expect(isTerminal(transferTransitions, status)).toBe(true);
    },
  );

  it('derives the provider key from the order, in lower case', () => {
    expect(transferProviderKey(orderId.toUpperCase())).toBe(
      `transfer:${orderId}`,
    );
  });
});

describe('TransferSchema', () => {
  const transfer = {
    id: id(7),
    orderId,
    hostId: id(8),
    amountMinor: null,
    releaseAfter: new Date('2026-11-10T12:00:00Z'),
    providerKey: `transfer:${orderId}`,
    providerTransferId: null,
    reversedMinor: 0,
    status: 'scheduled',
  };

  it.each([
    ['a scheduled transfer', transfer],
    [
      'a releasing transfer',
      { ...transfer, status: 'releasing', amountMinor: 15000 },
    ],
    [
      'a paid transfer partly reversed',
      {
        ...transfer,
        status: 'paid',
        amountMinor: 15000,
        reversedMinor: 5000,
        providerTransferId: 'tr_1',
      },
    ],
    ['a skipped transfer with no amount', { ...transfer, status: 'skipped' }],
    [
      'a skipped transfer with a zero amount',
      { ...transfer, status: 'skipped', amountMinor: 0 },
    ],
    [
      'a simulated transfer',
      { ...transfer, status: 'simulated', amountMinor: 15000 },
    ],
  ])('accepts %s', (_name, row) => {
    expect(TransferSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    ['a scheduled transfer with an amount', { amountMinor: 15000 }],
    ['a releasing transfer with no amount', { status: 'releasing' }],
    ['a paid transfer of zero', { status: 'paid', amountMinor: 0 }],
    [
      'a reversal above the amount',
      { status: 'paid', amountMinor: 100, reversedMinor: 101 },
    ],
    ['a reversal on a transfer with no amount', { reversedMinor: 1 }],
    ['a key that is not from the order', { providerKey: `transfer:${id(2)}` }],
    ['an unknown status', { status: 'sent' }],
    ['a blank provider transfer id', { providerTransferId: ' ' }],
  ])('refuses %s', (_name, change) => {
    expect(TransferSchema.safeParse({ ...transfer, ...change }).success).toBe(
      false,
    );
  });
});

describe('transferReleaseAfter', () => {
  it.each([
    ['2026-11-07T23:00:00Z', '2026-11-08T23:00:00Z'],
    ['2026-12-31T23:30:00Z', '2027-01-01T23:30:00Z'],
  ])('a session ending %s releases after %s', (ends, release) => {
    expect(transferReleaseAfter(new Date(ends))).toEqual(new Date(release));
  });
});
