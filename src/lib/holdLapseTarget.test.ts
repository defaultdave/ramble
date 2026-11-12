import { describe, expect, it } from 'vitest';
import { attemptCancelTarget, cancelAttemptKey } from './holdLapse';

// Behaviours under test, one per decision, branch, or risk:
// - an attempt with a stored payment id is found by it; one without is found by Ramble's own ids (design doc 4.2.3 rule 7)
// - the cancel's idempotency key is derived from the attempt's key, so a repeat repeats one call

const orderId = '5f1b9d4e-8a3c-4c1e-9d2a-7b6f0c3e1a24';
const attemptId = '9a2c4e6f-1b3d-4f5a-8c7e-0d1f2a3b4c5d';

describe('where the payment to cancel is found', () => {
  it('by the stored payment id', () => {
    expect(
      attemptCancelTarget(orderId, {
        id: attemptId,
        providerPaymentId: 'pay_1',
      }),
    ).toEqual({ kind: 'payment', paymentId: 'pay_1' });
  });

  it('by Ramble’s ids when no payment id was stored', () => {
    expect(
      attemptCancelTarget(orderId, { id: attemptId, providerPaymentId: null }),
    ).toEqual({ kind: 'metadata', orderId, recordId: attemptId });
  });
});

describe('the cancel’s idempotency key', () => {
  it('is the attempt’s key under a cancel prefix', () => {
    expect(cancelAttemptKey(`pay:${orderId}:1`)).toBe(
      `cancel:pay:${orderId}:1`,
    );
  });
});
