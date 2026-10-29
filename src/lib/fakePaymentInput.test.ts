import { describe, expect, it } from 'vitest';
import { FakeConfirmInputSchema, fakeConfirmResult } from './fakePaymentInput';

// A made-up id and secret in the fake gateway's shape, not a credential.
const ref = {
  paymentId: 'pay_0123',
  clientSecret: 'pay_0123_secret_abcd', // gitleaks:allow
};

describe('FakeConfirmInputSchema', () => {
  it.each([
    ['a card payment', { outcome: 'succeeded', method: 'card' }],
    ['a wallet payment', { outcome: 'succeeded', method: 'apple_pay' }],
    [
      'a decline with a reason',
      { outcome: 'declined', failureCode: 'incorrect_cvc' },
    ],
    ['a 3-D Secure challenge', { outcome: 'requires_action' }],
  ])('accepts %s', (_name, plan) => {
    expect(FakeConfirmInputSchema.safeParse({ ...ref, plan }).success).toBe(
      true,
    );
  });

  it.each([
    ['a decline without a reason', { outcome: 'declined' }],
    [
      'a decline with a reason the form never sends',
      { outcome: 'declined', failureCode: 'fraudulent' },
    ],
    ['a success without a method', { outcome: 'succeeded' }],
    [
      'a success by an unknown method',
      { outcome: 'succeeded', method: 'bank' },
    ],
    ['an unknown outcome', { outcome: 'refunded' }],
  ])('refuses %s', (_name, plan) => {
    expect(FakeConfirmInputSchema.safeParse({ ...ref, plan }).success).toBe(
      false,
    );
  });

  it.each([
    ['an empty payment id', { ...ref, paymentId: '' }],
    ['an empty client secret', { ...ref, clientSecret: '' }],
    [
      'a payment id over 255 characters',
      { ...ref, paymentId: 'p'.repeat(256) },
    ],
    [
      'a client secret over 255 characters',
      { ...ref, clientSecret: 's'.repeat(256) },
    ],
  ])('refuses %s', (_name, input) => {
    expect(
      FakeConfirmInputSchema.safeParse({
        ...input,
        plan: { outcome: 'requires_action' },
      }).success,
    ).toBe(false);
  });
});

describe('fakeConfirmResult', () => {
  it.each([
    [{ outcome: 'succeeded', method: 'card' }, { status: 'succeeded' }],
    [
      { outcome: 'declined', failureCode: 'card_declined' },
      { status: 'declined', failureCode: 'card_declined' },
    ],
    [{ outcome: 'requires_action' }, { status: 'requires_action' }],
  ] as const)('answers %j with %j', (plan, result) => {
    expect(fakeConfirmResult(plan)).toEqual(result);
  });
});
