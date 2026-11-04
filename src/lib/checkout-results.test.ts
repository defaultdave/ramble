import { describe, expect, it } from 'vitest';
import {
  ageRequirements,
  allowedChildAges,
  alreadyConfirmedResult,
  orderTokenFor,
  providerStep,
  requiresPaymentResult,
  storeProviderPayment,
  lookupVerdict,
  storesPayment,
  newsletterConsent,
} from './checkout';

// Behaviours under test, one per decision, branch or risk:
// - the order token goes only to the device that holds the hold
// - the provider is asked by what is known of the attempt; a payment id is stored once, while live
// - the newsletter consent, and the child ages and age requirements a booking allows

describe('the results', () => {
  const order = {
    id: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
    reference: 'RMB-7K2M9P',
    amountDueMinor: 22_864,
  };

  it('gives the order token to the device that holds the hold and no other', () => {
    expect(orderTokenFor({ deviceKey: 'a' }, 'a', () => 'token')).toBe('token');
    expect(
      orderTokenFor({ deviceKey: 'a' }, 'b', () => 'token'),
    ).toBeUndefined();
  });

  it('never makes the token for another device', () => {
    let made = 0;
    orderTokenFor({ deviceKey: 'a' }, 'b', () => {
      made += 1;
      return 'token';
    });
    expect(made).toBe(0);
  });

  it('carries the token on a confirmed answer only when there is one', () => {
    expect(alreadyConfirmedResult('RMB-7K2M9P', 'token')).toEqual({
      status: 'already_confirmed',
      reference: 'RMB-7K2M9P',
      orderToken: 'token',
    });
    expect(alreadyConfirmedResult('RMB-7K2M9P', undefined)).toEqual({
      status: 'already_confirmed',
      reference: 'RMB-7K2M9P',
    });
  });

  it('carries the order, the secret, and the token on a payment answer', () => {
    expect(
      requiresPaymentResult(
        order,
        { provider: 'fake', clientSecret: 'cs_1' },
        'token',
      ),
    ).toEqual({
      status: 'requires_payment',
      orderId: order.id,
      reference: order.reference,
      payment: { provider: 'fake', clientSecret: 'cs_1' },
      amountDueMinor: 22_864,
      orderToken: 'token',
    });
    expect(
      requiresPaymentResult(
        order,
        { provider: 'fake', clientSecret: 'cs_1' },
        undefined,
      ),
    ).not.toHaveProperty('orderToken');
  });
});

describe('the provider step', () => {
  it.each([
    [
      'reads a payment the attempt already has',
      { providerPaymentId: 'pay_1', existed: true },
      { step: 'retrieve', paymentId: 'pay_1' },
    ],
    [
      'looks an earlier call’s attempt up by Ramble’s ids before creating',
      { providerPaymentId: null, existed: true },
      { step: 'find_or_create' },
    ],
    [
      'creates for an attempt made in this call',
      { providerPaymentId: null, existed: false },
      { step: 'create' },
    ],
  ])('%s', (_name, known, expected) => {
    expect(providerStep(known)).toEqual(expected);
  });

  it.each([
    [
      'stores the first id on a live attempt',
      'created',
      null,
      'pay_1',
      'write',
    ],
    [
      'stores on an attempt that failed a try',
      'failed_try',
      null,
      'pay_1',
      'write',
    ],
    [
      'treats the same id again as stored',
      'created',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    [
      'treats the same id on a finished attempt as stored',
      'succeeded',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    ['never replaces a different id', 'created', 'pay_1', 'pay_2', 'refuse'],
    [
      'never writes to a succeeded attempt',
      'succeeded',
      null,
      'pay_1',
      'refuse',
    ],
    ['never writes to a canceled attempt', 'canceled', null, 'pay_1', 'refuse'],
  ] as const)('%s', (_name, status, stored, paymentId, expected) => {
    expect(
      storeProviderPayment({ status, providerPaymentId: stored }, paymentId),
    ).toEqual(
      {
        write: { write: true, stored: true },
        repeat: { write: false, stored: true },
        refuse: { write: false, stored: false },
      }[expected],
    );
  });

  it.each([
    [
      'a payment found by id is used',
      { step: 'retrieve', paymentId: 'p' },
      true,
      'use',
    ],
    [
      'a payment found by Ramble’s ids is used',
      { step: 'find_or_create' },
      true,
      'use',
    ],
    [
      'a stored payment the provider lost is refused',
      { step: 'retrieve', paymentId: 'p' },
      false,
      'refuse',
    ],
    [
      'an earlier attempt with no provider payment creates one',
      { step: 'find_or_create' },
      false,
      'create',
    ],
    ['a new attempt creates one', { step: 'create' }, false, 'create'],
  ] as const)('%s', (_name, step, found, expected) => {
    expect(lookupVerdict(step, found)).toBe(expected);
  });

  it('writes the payment id only for a payment the attempt did not hold', () => {
    expect(storesPayment({ step: 'retrieve', paymentId: 'p' })).toBe(false);
    expect(storesPayment({ step: 'find_or_create' })).toBe(true);
    expect(storesPayment({ step: 'create' })).toBe(true);
  });
});

describe('the newsletter consent', () => {
  it('is a checkout grant when ticked, and nothing when not', () => {
    expect(newsletterConsent('g1', true)).toEqual({
      guestId: 'g1',
      kind: 'newsletter',
      status: 'granted',
      source: 'checkout',
    });
    expect(newsletterConsent('g1', false)).toBeNull();
  });
});

describe('allowedChildAges', () => {
  it.each([
    [
      'all ages',
      { ageRule: 'all_ages', minAge: null, maxAge: null },
      { min: 0, max: 17 },
    ],
    [
      'a minimum age',
      { ageRule: 'minimum_age', minAge: 12, maxAge: null },
      { min: 12, max: 17 },
    ],
    [
      'an age range',
      { ageRule: 'age_range', minAge: 5, maxAge: 10 },
      { min: 5, max: 10 },
    ],
    [
      'a range past 17',
      { ageRule: 'age_range', minAge: 6, maxAge: 40 },
      { min: 6, max: 17 },
    ],
    [
      'a minimum age of an adult',
      { ageRule: 'minimum_age', minAge: 18, maxAge: null },
      null,
    ],
    [
      '21 and over',
      { ageRule: 'twenty_one_plus', minAge: null, maxAge: null },
      null,
    ],
  ] as const)('gives the ages for %s', (_name, rule, range) => {
    expect(allowedChildAges(rule)).toEqual(range);
  });
});

describe('ageRequirements', () => {
  const rule = (
    ageRule: 'all_ages' | 'minimum_age' | 'age_range' | 'twenty_one_plus',
    minAge: number | null,
    maxAge: number | null,
  ) => ({
    ageRule,
    minAge,
    maxAge,
  });

  it.each([
    [rule('all_ages', null, null), null],
    [
      rule('twenty_one_plus', null, null),
      'Everyone in my party is 21 or older',
    ],
    [
      rule('minimum_age', 14, null),
      'Everyone is 14 or older, and anyone under 18 comes with an adult',
    ],
    [rule('minimum_age', 18, null), 'Everyone in my party is 18 or older'],
    [
      rule('age_range', 6, 12),
      'Everyone in my party is between 6 and 12 years old',
    ],
  ])('words the confirmation for %j', (subject, label) => {
    expect(ageRequirements(subject, 0).confirmation).toBe(label);
  });

  it('asks nothing of a party with no children', () => {
    expect(ageRequirements(rule('all_ages', null, null), 0)).toEqual({
      confirmation: null,
      childAges: null,
      guardian: false,
    });
  });

  it.each([
    [rule('all_ages', null, null), { count: 2, min: 0, max: 17 }],
    [rule('minimum_age', 8, null), { count: 2, min: 8, max: 17 }],
    [rule('age_range', 6, 12), { count: 2, min: 6, max: 12 }],
    [rule('age_range', 6, 40), { count: 2, min: 6, max: 17 }],
  ])('takes an age for each child, within the rule: %j', (subject, ages) => {
    const needs = ageRequirements(subject, 2);
    expect(needs.childAges).toEqual(ages);
    expect(needs.guardian).toBe(true);
  });
});
