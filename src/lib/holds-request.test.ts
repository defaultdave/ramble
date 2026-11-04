import { describe, expect, it } from 'vitest';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  fieldErrorsFromIssues,
  isHoldOfDevice,
  holdLimits,
  PartySizeSchema,
  invalidFromIssues,
} from './holds';
import { uuid, otherUuid, booking } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the request schema: a booking and a gift redemption parse; ids are lower-cased; 0 or 5 lines,
//   a repeated price option, a quantity outside 1..6 or not whole, a bad id or purpose, a gift token
//   on a booking, a redemption with none, and a token over 256 characters are each refused
// - a failed parse becomes one stable code per field and never carries the parser's wording
// - a hold is a device's only when the hash matches; a missing hold is nobody's
// - field errors take the issue's first message, keyed as the caller says

describe('PartySizeSchema', () => {
  it.each([
    [holdLimits.minSeats - 1, false],
    [holdLimits.minSeats, true],
    [holdLimits.maxSeats, true],
    [holdLimits.maxSeats + 1, false],
    [2.5, false],
  ])('takes %s: %s', (size, ok) => {
    expect(PartySizeSchema.safeParse(size).success).toBe(ok);
  });
});

describe('ReserveInputSchema', () => {
  it('accepts a booking and lower-cases its ids', () => {
    const parsed = ReserveInputSchema.parse({
      ...booking,
      sessionId: uuid.toUpperCase(),
      items: [{ priceOptionId: otherUuid.toUpperCase(), quantity: 6 }],
    });

    expect(parsed.sessionId).toBe(uuid);
    expect(parsed.items[0]?.priceOptionId).toBe(otherUuid);
  });

  it('accepts a gift redemption with a token', () => {
    expect(
      ReserveInputSchema.safeParse({
        ...booking,
        purpose: 'gift_redemption',
        giftToken: 'x'.repeat(holdLimits.giftTokenChars),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['no lines', { ...booking, items: [] }],
    [
      'five lines',
      {
        ...booking,
        items: Array.from({ length: 5 }, (_, index) => ({
          priceOptionId: `00000000-0000-4000-8000-00000000000${String(index)}`,
          quantity: 1,
        })),
      },
    ],
    [
      'a repeated price option',
      {
        ...booking,
        items: [
          { priceOptionId: otherUuid, quantity: 1 },
          { priceOptionId: otherUuid.toUpperCase(), quantity: 1 },
        ],
      },
    ],
    [
      'quantity 0',
      { ...booking, items: [{ priceOptionId: otherUuid, quantity: 0 }] },
    ],
    [
      'quantity 7',
      { ...booking, items: [{ priceOptionId: otherUuid, quantity: 7 }] },
    ],
    [
      'a fractional quantity',
      { ...booking, items: [{ priceOptionId: otherUuid, quantity: 1.5 }] },
    ],
    ['a session id that is not an id', { ...booking, sessionId: 'nope' }],
    [
      'a price option id that is not an id',
      { ...booking, items: [{ priceOptionId: 'nope', quantity: 1 }] },
    ],
    ['an unknown purpose', { ...booking, purpose: 'comp' }],
    ['a gift token on a booking', { ...booking, giftToken: 'abc' }],
    ['a redemption with no token', { ...booking, purpose: 'gift_redemption' }],
    [
      'a token over 256 characters',
      {
        ...booking,
        purpose: 'gift_redemption',
        giftToken: 'x'.repeat(holdLimits.giftTokenChars + 1),
      },
    ],
    [
      'an empty token',
      { ...booking, purpose: 'gift_redemption', giftToken: '' },
    ],
    ['a body that is not an object', 'hold me'],
  ])('refuses %s', (_name, input) => {
    expect(ReserveInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('ReleaseInputSchema', () => {
  it('lower-cases the hold id and refuses one that is not an id', () => {
    expect(
      ReleaseInputSchema.parse({ holdId: uuid.toUpperCase() }).holdId,
    ).toBe(uuid);
    expect(ReleaseInputSchema.safeParse({ holdId: 'nope' }).success).toBe(
      false,
    );
  });
});

describe('invalidFromIssues', () => {
  function issuesOf(input: unknown) {
    const parsed = ReserveInputSchema.safeParse(input);
    if (parsed.success) throw new Error('expected a refusal');
    return parsed.error.issues;
  }

  it.each([
    [
      'a bad session id',
      { ...booking, sessionId: 'x' },
      { sessionId: 'invalid' },
    ],
    ['a bad line', { ...booking, items: [] }, { items: 'invalid' }],
    [
      'a repeated price option',
      { ...booking, items: [booking.items[0], booking.items[0]] },
      { items: 'invalid' },
    ],
    [
      'a missing gift token',
      { ...booking, purpose: 'gift_redemption' },
      { giftToken: 'required' },
    ],
    [
      'a stray gift token',
      { ...booking, giftToken: 'abc' },
      { giftToken: 'invalid' },
    ],
    ['a body that is not an object', 7, { input: 'invalid' }],
  ])('gives %s one stable code', (_name, input, fieldErrors) => {
    expect(invalidFromIssues(issuesOf(input))).toEqual({
      status: 'invalid',
      fieldErrors,
    });
  });

  it('keeps the first issue per field', () => {
    const result = invalidFromIssues([
      { path: ['items', 0, 'quantity'], message: 'Too small' },
      { path: ['items', 1, 'quantity'], message: 'required' },
    ]);

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { items: 'invalid' },
    });
  });
});

describe('whose hold it is', () => {
  it('is the device whose hash it carries, and nobody’s when missing', () => {
    expect(isHoldOfDevice({ deviceKey: 'a'.repeat(64) }, 'a'.repeat(64))).toBe(
      true,
    );
    expect(isHoldOfDevice({ deviceKey: 'a'.repeat(64) }, 'b'.repeat(64))).toBe(
      false,
    );
    expect(isHoldOfDevice(null, 'a'.repeat(64))).toBe(false);
    expect(isHoldOfDevice(undefined, 'a'.repeat(64))).toBe(false);
  });
});

describe('field errors from issues', () => {
  it('keeps the first message per field and says required only for a rule that does', () => {
    expect(
      fieldErrorsFromIssues(
        [
          { path: ['a', 'b'], message: 'required' },
          { path: ['a', 'b'], message: 'other' },
          { path: ['c'], message: 'Invalid input' },
        ],
        (path) => path.map(String).join('.'),
      ),
    ).toEqual({ 'a.b': 'required', c: 'invalid' });
  });
});
