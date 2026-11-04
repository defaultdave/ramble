import { describe, expect, it } from 'vitest';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  fieldErrorsFromIssues,
  holdLimits,
  PartySizeSchema,
  invalidFromIssues,
  isOpenHold,
  openHeldSeats,
  partyFits,
  partyFor,
  requireBoundedHolds,
  spacesLeft,
} from './holds';
import { maxAllocation } from './sessions';
import { at, msFrom } from './testClock';
import { uuid, otherUuid, active } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - the request schema: a booking and a gift redemption parse; ids are lower-cased; 0 or 5 lines,
//   a repeated price option, a quantity outside 1..6 or not whole, a bad id or purpose, a gift token
//   on a booking, a redemption with none, and a token over 256 characters are each refused
// - a failed parse becomes one stable code per field and never carries the parser's wording
// - isOpenHold: active before its deadline, paying before its deadline, a deadline equal to `at` is
//   not open, a paying hold with no deadline is not open, converted and released never are, and a
//   paying hold past `expires_at` but before `paying_until` is open
// - spacesLeft counts only open holds, returns negative as is, and a lapsed hold counts for nothing
// - the open-hold fetch refuses more rows than the largest capacity
// - partyFor: not offered before party size, party size counts only space-using lines, 1..6 inclusive
// - field errors take the issue's first message, keyed as the caller says

const booking = {
  sessionId: uuid,
  items: [{ priceOptionId: otherUuid, quantity: 2 }],
  purpose: 'booking' as const,
};

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

describe('isOpenHold', () => {
  it.each([
    ['active before its deadline', active(msFrom(1)), true],
    ['active at its deadline', active(at), false],
    ['active after its deadline', active(msFrom(-1)), false],
    [
      'paying before paying_until, though expires_at has passed',
      { status: 'paying', expiresAt: msFrom(-60_000), payingUntil: msFrom(1) },
      true,
    ],
    [
      'paying at paying_until',
      { status: 'paying', expiresAt: msFrom(-60_000), payingUntil: at },
      false,
    ],
    [
      'paying with no deadline',
      { status: 'paying', expiresAt: msFrom(60_000), payingUntil: null },
      false,
    ],
    [
      'converted',
      {
        status: 'converted',
        expiresAt: msFrom(60_000),
        payingUntil: msFrom(60_000),
      },
      false,
    ],
    [
      'released',
      {
        status: 'released',
        expiresAt: msFrom(60_000),
        payingUntil: msFrom(60_000),
      },
      false,
    ],
  ] as const)('%s: %s', (_name, hold, open) => {
    expect(isOpenHold(hold, at)).toBe(open);
  });
});

describe('spacesLeft and openHeldSeats', () => {
  const holds = [
    { ...active(msFrom(1)), seats: 2 },
    { ...active(at), seats: 5 },
    {
      status: 'paying',
      expiresAt: msFrom(-1),
      payingUntil: msFrom(1),
      seats: 3,
    },
    {
      status: 'paying',
      expiresAt: msFrom(-1),
      payingUntil: msFrom(-1),
      seats: 4,
    },
    { status: 'released', expiresAt: msFrom(1), payingUntil: null, seats: 1 },
  ] as const;

  it('counts the seats of open holds only', () => {
    expect(openHeldSeats(holds, at)).toBe(5);
  });

  it('is capacity less seats sold less open held seats', () => {
    expect(spacesLeft({ allocation: 12, seatsSold: 3 }, holds, at)).toBe(4);
  });

  it('returns a negative number as it is, and zero holds leave the whole capacity', () => {
    expect(spacesLeft({ allocation: 4, seatsSold: 3 }, holds, at)).toBe(-4);
    expect(spacesLeft({ allocation: 8, seatsSold: 0 }, [], at)).toBe(8);
  });
});

describe('requireBoundedHolds', () => {
  it('passes up to the largest capacity per session and refuses one more', () => {
    const rows = Array.from({ length: maxAllocation }, () => 1);

    expect(requireBoundedHolds(rows)).toBe(rows);
    expect(() => requireBoundedHolds([...rows, 1])).toThrow(RangeError);
    expect(requireBoundedHolds([...rows, 1], 2)).toHaveLength(
      maxAllocation + 1,
    );
  });
});

describe('partyFits', () => {
  it.each([
    [2, 2, true],
    [3, 2, false],
    [1, 0, false],
    [1, -3, false],
  ])('%s seats with %s left: %s', (seats, left, fits) => {
    expect(partyFits(seats, left)).toBe(fits);
  });
});

describe('partyFor', () => {
  const options = [
    { id: 'adult', usesSpace: true },
    { id: 'child', usesSpace: false },
    { id: 'infant', usesSpace: true },
  ];

  it('counts only the lines that use a space', () => {
    expect(
      partyFor(
        [
          { priceOptionId: 'adult', quantity: 2 },
          { priceOptionId: 'child', quantity: 5 },
        ],
        options,
      ),
    ).toEqual({ ok: true, seats: 2 });
  });

  it.each([
    [[{ priceOptionId: 'adult', quantity: 6 }], { ok: true, seats: 6 }],
    [
      [
        { priceOptionId: 'adult', quantity: 4 },
        { priceOptionId: 'infant', quantity: 3 },
      ],
      { ok: false, fieldErrors: { items: 'party_size' } },
    ],
    [
      [{ priceOptionId: 'child', quantity: 2 }],
      { ok: false, fieldErrors: { items: 'party_size' } },
    ],
    [
      [{ priceOptionId: 'elsewhere', quantity: 1 }],
      { ok: false, fieldErrors: { items: 'not_offered' } },
    ],
    [
      [
        { priceOptionId: 'elsewhere', quantity: 1 },
        { priceOptionId: 'adult', quantity: 9 },
      ],
      { ok: false, fieldErrors: { items: 'not_offered' } },
    ],
  ])('%j gives %j', (items, expected) => {
    expect(partyFor(items, options)).toEqual(expected);
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
