import { describe, expect, it } from 'vitest';
import {
  cardOutcome,
  digitsOnly,
  firstErrorField,
  formatCardField,
  formatCardNumber,
  formatExpiry,
  planCard,
  testCards,
  validateCard,
  visibleErrors,
  type CardFields,
} from './fakeCard';

const now = new Date('2026-10-29T12:00:00.000Z');

const valid: CardFields = {
  number: '4242 4242 4242 4242',
  expiry: '12 / 28',
  cvc: '123',
  zip: '10001',
};

describe('cardOutcome', () => {
  it.each([
    ['4242 4242 4242 4242', { kind: 'succeeds' }],
    ['4242424242424242', { kind: 'succeeds' }],
    ['4000 0000 0000 0002', { kind: 'declines', failureCode: 'card_declined' }],
    [
      '4000 0000 0000 9995',
      { kind: 'declines', failureCode: 'insufficient_funds' },
    ],
    ['4000 0000 0000 0069', { kind: 'declines', failureCode: 'expired_card' }],
    ['4000 0000 0000 0127', { kind: 'declines', failureCode: 'incorrect_cvc' }],
    ['4000 0000 0000 3220', { kind: 'challenges' }],
  ])('%s selects %j', (number, expected) => {
    expect(cardOutcome(number)).toEqual(expected);
  });

  it.each([
    ['a number that is not a test card', '1234 5678 9012 3456'],
    ['a short number', '4242 4242'],
    ['nothing', ''],
    ['letters', 'abcd efgh ijkl mnop'],
  ])('refuses %s', (_name, number) => {
    expect(cardOutcome(number)).toBeNull();
  });

  it('reads at most 16 digits, so extra digits are dropped rather than matched', () => {
    expect(cardOutcome('4242 4242 4242 4242 99')).toEqual({ kind: 'succeeds' });
  });
});

describe('planCard', () => {
  it.each([
    [{ kind: 'succeeds' }, { outcome: 'succeeded', method: 'card' }],
    [
      { kind: 'declines', failureCode: 'expired_card' },
      { outcome: 'declined', failureCode: 'expired_card' },
    ],
    [{ kind: 'challenges' }, { outcome: 'requires_action' }],
  ] as const)('%j becomes %j', (outcome, plan) => {
    expect(planCard(outcome)).toEqual(plan);
  });
});

describe('formatting', () => {
  it.each([
    ['', ''],
    ['4', '4'],
    ['42424', '4242 4'],
    ['4242424242424242', '4242 4242 4242 4242'],
    ['4242-4242 4242.4242 9999', '4242 4242 4242 4242'],
  ])('card number %j reads %j', (typed, shown) => {
    expect(formatCardNumber(typed)).toBe(shown);
  });

  it.each([
    ['', ''],
    ['1', '1'],
    ['12', '12'],
    ['122', '12 / 2'],
    ['12 / 28', '12 / 28'],
    ['1228999', '12 / 28'],
  ])('expiry %j reads %j', (typed, shown) => {
    expect(formatExpiry(typed)).toBe(shown);
  });

  it('keeps only digits and at most the length asked for', () => {
    expect(digitsOnly('a1b2c3d4', 3)).toBe('123');
  });

  it('looks only at the first 64 characters of a pasted wall of text', () => {
    const wall = `${'x'.repeat(64)}1234`;
    expect(digitsOnly(wall, 16)).toBe('');
  });

  it.each([
    ['number', '42424', '4242 4'],
    ['expiry', '1228', '12 / 28'],
    ['cvc', '12a34', '123'],
    ['zip', '100012345', '10001'],
  ] as const)('formats the %s field', (field, typed, shown) => {
    expect(formatCardField(field, typed)).toBe(shown);
  });
});

describe('validateCard', () => {
  it('accepts a test card with a future expiry, a code, and a ZIP', () => {
    expect(validateCard(valid, now)).toEqual({});
  });

  it.each([
    ['empty', '', 'Enter a card number.'],
    ['short', '4242 4242', 'Enter all 16 digits of a test card.'],
    [
      'not a test card',
      '1234 5678 9012 3456',
      'This demo takes only its test cards. Use one from the list below.',
    ],
  ])('refuses a number that is %s', (_name, number, message) => {
    expect(validateCard({ ...valid, number }, now).number).toBe(message);
  });

  it.each([
    ['empty', '', 'Enter the expiry date.'],
    ['incomplete', '12 / 2', 'Enter the expiry as MM / YY.'],
    ['month 13', '13 / 28', 'Enter the expiry as MM / YY.'],
    ['month 00', '00 / 28', 'Enter the expiry as MM / YY.'],
    [
      'last month',
      '09 / 26',
      'This card has expired. Try a different expiry date.',
    ],
    [
      'last year',
      '12 / 25',
      'This card has expired. Try a different expiry date.',
    ],
  ])('refuses an expiry that is %s', (_name, expiry, message) => {
    expect(validateCard({ ...valid, expiry }, now).expiry).toBe(message);
  });

  it.each([
    ['this month', '10 / 26'],
    ['next month', '11 / 26'],
    ['far ahead', '12 / 99'],
  ])('accepts an expiry of %s', (_name, expiry) => {
    expect(validateCard({ ...valid, expiry }, now).expiry).toBeUndefined();
  });

  it.each([
    ['cvc', '12', 'Enter the 3-digit security code.'],
    ['zip', '1000', 'Enter a 5-digit ZIP code.'],
  ] as const)('refuses a short %s', (field, value, message) => {
    expect(validateCard({ ...valid, [field]: value }, now)[field]).toBe(
      message,
    );
  });

  it('reports every field at once', () => {
    expect(
      Object.keys(
        validateCard({ number: '', expiry: '', cvc: '', zip: '' }, now),
      ),
    ).toEqual(['number', 'expiry', 'cvc', 'zip']);
  });
});

describe('visibleErrors', () => {
  it('lists the errors in the order the fields sit, whatever order they were found in', () => {
    expect(visibleErrors({ zip: 'z', number: 'n', cvc: 'c' })).toEqual([
      { field: 'number', message: 'n' },
      { field: 'cvc', message: 'c' },
      { field: 'zip', message: 'z' },
    ]);
  });

  it('skips fields without an error', () => {
    expect(visibleErrors({ expiry: 'e' })).toEqual([
      { field: 'expiry', message: 'e' },
    ]);
  });

  it('is empty when there are none', () => {
    expect(visibleErrors({})).toEqual([]);
  });
});

describe('firstErrorField', () => {
  it('names the topmost field with an error', () => {
    expect(firstErrorField({ zip: 'x', cvc: 'y' })).toBe('cvc');
  });

  it('is null when there is none', () => {
    expect(firstErrorField({})).toBeNull();
  });
});

describe('testCards', () => {
  it('lists every card the form accepts, as typed, and no other number', () => {
    expect(testCards.map((card) => card.number)).toEqual([
      '4242 4242 4242 4242',
      '4000 0000 0000 0002',
      '4000 0000 0000 9995',
      '4000 0000 0000 0069',
      '4000 0000 0000 0127',
      '4000 0000 0000 3220',
    ]);
    for (const card of testCards) {
      expect(cardOutcome(card.number)).not.toBeNull();
    }
  });
});
