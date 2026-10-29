import { describe, expect, it } from 'vitest';
import {
  RefundSchema,
  canRefundTransition,
  refundInitialStatuses,
  refundProviderKey,
  refundStatuses,
  refundTransitions,
  type RefundStatus,
} from './refunds';
import { isTerminal } from './transitions';

// Behaviours under test, one per decision, branch or risk.
// - refund transitions: pending resolves once; succeeded, failed, and gift_reinstated never change
// - initial statuses and the provider key
// - RefundSchema: valid rows pass; each row rule refuses its bad row

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const refundId = id(5);
const created = new Date('2026-11-01T12:00:00Z');
const later = new Date('2026-11-01T12:05:00Z');

describe('refund transitions', () => {
  const allowed: [RefundStatus, RefundStatus][] = [
    ['pending', 'succeeded'],
    ['pending', 'failed'],
  ];

  it.each(allowed)('allows %s to %s', (from, to) => {
    expect(canRefundTransition(from, to)).toBe(true);
  });

  it('refuses every other pair', () => {
    for (const from of refundStatuses) {
      for (const to of refundStatuses) {
        const expected = allowed.some(([a, b]) => a === from && b === to);
        expect(canRefundTransition(from, to)).toBe(expected);
      }
    }
  });

  it.each(['succeeded', 'failed', 'gift_reinstated'] as const)(
    '%s never changes',
    (status) => {
      expect(isTerminal(refundTransitions, status)).toBe(true);
    },
  );

  it('creates a refund pending or, with no card to refund, gift_reinstated', () => {
    expect(refundInitialStatuses).toEqual(['pending', 'gift_reinstated']);
  });

  it('derives the provider key from the refund id, in lower case', () => {
    expect(refundProviderKey(refundId.toUpperCase())).toBe(
      `refund:${refundId}`,
    );
  });
});

describe('RefundSchema', () => {
  const refund = {
    id: refundId,
    orderId: id(1),
    paymentAttemptId: id(2),
    ticketMinor: 17000,
    taxMinor: 1509,
    commissionReturnedMinor: 2550,
    amountMinor: 18509,
    reason: 'guest_cancel',
    initiatedBy: null,
    providerKey: `refund:${refundId}`,
    providerRefundId: null,
    status: 'pending',
    createdAt: created,
    succeededAt: null,
  };

  it.each([
    ['a pending refund', refund],
    [
      'a succeeded refund',
      {
        ...refund,
        status: 'succeeded',
        providerRefundId: 're_1',
        succeededAt: later,
      },
    ],
    [
      'a reinstated gift',
      { ...refund, status: 'gift_reinstated', paymentAttemptId: null },
    ],
    [
      'a tax-only refund',
      {
        ...refund,
        ticketMinor: 0,
        commissionReturnedMinor: 0,
        taxMinor: 100,
        amountMinor: 100,
      },
    ],
  ])('accepts %s', (_name, row) => {
    expect(RefundSchema.safeParse(row).success).toBe(true);
  });

  it.each([
    ['an amount that is not ticket plus tax', { amountMinor: 18510 }],
    [
      'an amount of 0',
      {
        ticketMinor: 0,
        taxMinor: 0,
        commissionReturnedMinor: 0,
        amountMinor: 0,
      },
    ],
    [
      'a commission returned above the ticket part',
      { commissionReturnedMinor: 17001 },
    ],
    [
      'a key that is not from the refund id',
      { providerKey: `refund:${id(6)}` },
    ],
    ['a reinstated gift that names a payment', { status: 'gift_reinstated' }],
    ['a succeeded refund with no succeeded time', { status: 'succeeded' }],
    ['a succeeded time on a pending refund', { succeededAt: later }],
    [
      'a succeeded time before the created time',
      { status: 'succeeded', succeededAt: new Date('2026-11-01T11:00:00Z') },
    ],
    ['an unknown reason', { reason: 'changed_mind' }],
    ['a blank provider refund id', { providerRefundId: '' }],
  ])('refuses %s', (_name, change) => {
    expect(RefundSchema.safeParse({ ...refund, ...change }).success).toBe(
      false,
    );
  });
});
