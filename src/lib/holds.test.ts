import { describe, expect, it } from 'vitest';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  ReserveResultSchema,
  alternativeWindow,
  blockedForBot,
  blockedForRateLimit,
  reserveBlock,
  decideRelease,
  giftRefusal,
  heldResult,
  holdExpiresAt,
  holdLimits,
  invalidFromIssues,
  isOpenHold,
  openHeldSeats,
  partyFits,
  partyFor,
  pausedRefusal,
  pickAlternatives,
  requireBoundedHolds,
  reserveRefusal,
  spacesLeft,
  unbookableSession,
  type HoldTimes,
} from './holds';
import { maxAllocation } from './sessions';

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
// - holdExpiresAt adds the minutes and refuses a length outside the settings bounds
// - reserveRefusal: missing and not-live answer alike, a not-scheduled session before the past check,
//   a start at `at` is past, a start after `at` passes
// - decideRelease: missing, another device's, another session's, and converted answer alike; paying is
//   refused; released answers released; active releases
// - alternatives: scheduled, after `at`, within 14 days, room for the whole party, soonest first, at
//   most three, spaces left counting only open holds

const at = new Date('2026-11-01T12:00:00.000Z');
const later = (ms: number) => new Date(at.getTime() + ms);
const uuid = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const otherUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';

const booking = {
  sessionId: uuid,
  items: [{ priceOptionId: otherUuid, quantity: 2 }],
  purpose: 'booking' as const,
};

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

const active = (expiresAt: Date): HoldTimes => ({
  status: 'active',
  expiresAt,
  payingUntil: null,
});

describe('isOpenHold', () => {
  it.each([
    ['active before its deadline', active(later(1)), true],
    ['active at its deadline', active(at), false],
    ['active after its deadline', active(later(-1)), false],
    [
      'paying before paying_until, though expires_at has passed',
      { status: 'paying', expiresAt: later(-60_000), payingUntil: later(1) },
      true,
    ],
    [
      'paying at paying_until',
      { status: 'paying', expiresAt: later(-60_000), payingUntil: at },
      false,
    ],
    [
      'paying with no deadline',
      { status: 'paying', expiresAt: later(60_000), payingUntil: null },
      false,
    ],
    [
      'converted',
      {
        status: 'converted',
        expiresAt: later(60_000),
        payingUntil: later(60_000),
      },
      false,
    ],
    [
      'released',
      {
        status: 'released',
        expiresAt: later(60_000),
        payingUntil: later(60_000),
      },
      false,
    ],
  ] as const)('%s: %s', (_name, hold, open) => {
    expect(isOpenHold(hold, at)).toBe(open);
  });
});

describe('spacesLeft and openHeldSeats', () => {
  const holds = [
    { ...active(later(1)), seats: 2 },
    { ...active(at), seats: 5 },
    { status: 'paying', expiresAt: later(-1), payingUntil: later(1), seats: 3 },
    {
      status: 'paying',
      expiresAt: later(-1),
      payingUntil: later(-1),
      seats: 4,
    },
    { status: 'released', expiresAt: later(1), payingUntil: null, seats: 1 },
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

describe('holdExpiresAt', () => {
  it.each([1, 10, 60])('adds %s minutes', (minutes) => {
    expect(holdExpiresAt(at, minutes).getTime() - at.getTime()).toBe(
      minutes * 60_000,
    );
  });

  it.each([0, 61, 1.5, Number.NaN, -1])('refuses %s minutes', (minutes) => {
    expect(() => holdExpiresAt(at, minutes)).toThrow(RangeError);
  });
});

describe('pausedRefusal and giftRefusal', () => {
  it('refuses only while bookings are paused', () => {
    expect(pausedRefusal(true)).toEqual({
      status: 'unavailable',
      reason: 'bookings_paused',
    });
    expect(pausedRefusal(false)).toBeNull();
  });

  it('closes the gift branch until it is built', () => {
    expect(giftRefusal('gift_redemption')).toEqual({
      status: 'unavailable',
      reason: 'gift_not_valid',
    });
    expect(giftRefusal('booking')).toBeNull();
  });
});

describe('reserveRefusal', () => {
  const open = {
    experienceStatus: 'live',
    sessionStatus: 'scheduled',
    startsAt: later(1),
  } as const;

  it('lets a scheduled session of a live experience that starts later through', () => {
    expect(reserveRefusal(open, at)).toBeNull();
  });

  it.each(['draft', 'in_review', 'paused', 'guide_only'] as const)(
    'answers a %s experience as it answers a missing session',
    (experienceStatus) => {
      expect(reserveRefusal({ ...open, experienceStatus }, at)).toEqual(
        unbookableSession,
      );
      expect(reserveRefusal(null, at)).toEqual(unbookableSession);
      expect(reserveRefusal(undefined, at)).toEqual(unbookableSession);
    },
  );

  it.each(['cancelled', 'completed'] as const)(
    'answers a %s session as cancelled, even one that has started',
    (sessionStatus) => {
      const expected = { status: 'unavailable', reason: 'session_cancelled' };

      expect(reserveRefusal({ ...open, sessionStatus }, at)).toEqual(expected);
      expect(
        reserveRefusal({ ...open, sessionStatus, startsAt: later(-1) }, at),
      ).toEqual(expected);
    },
  );

  it.each([0, -1])('answers a start %s ms from now as past', (offset) => {
    expect(reserveRefusal({ ...open, startsAt: later(offset) }, at)).toEqual({
      status: 'unavailable',
      reason: 'past',
    });
  });
});

describe('results', () => {
  it('builds the held answer from the priced lines', () => {
    const lines = [
      {
        priceOptionId: otherUuid,
        kind: 'adult' as const,
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
        lineTotalMinor: 10_000,
      },
    ];
    const result = heldResult(
      { id: uuid, expiresAt: later(600_000) },
      { totalMinor: 10_888, lines },
    );

    expect(result).toEqual({
      status: 'held',
      holdId: uuid,
      expiresAt: '2026-11-01T12:10:00.000Z',
      totalMinor: 10_888,
      lines,
    });
    expect(ReserveResultSchema.safeParse(result).success).toBe(true);
  });

  it('blocks a bot without an end time and a rate-limited device with one', () => {
    expect(blockedForBot()).toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
    });
    expect(blockedForRateLimit(90, at)).toEqual({
      status: 'blocked',
      reason: 'too_many_holds',
      until: '2026-11-01T12:01:30.000Z',
    });
  });

  it.each([
    ['a bot', 'bot', null, { status: 'blocked', reason: 'too_many_holds' }],
    [
      'a bot, whatever the limit says',
      'bot',
      { allowed: true, remaining: 3 },
      { status: 'blocked', reason: 'too_many_holds' },
    ],
    [
      'a person over the limit',
      'human',
      { allowed: false, retryAfterSeconds: 90 },
      {
        status: 'blocked',
        reason: 'too_many_holds',
        until: '2026-11-01T12:01:30.000Z',
      },
    ],
    [
      'a person within the limit',
      'human',
      { allowed: true, remaining: 3 },
      null,
    ],
    ['a person with no try spent', 'human', null, null],
  ] as const)('reserveBlock answers %s', (_name, verdict, tried, expected) => {
    expect(reserveBlock(verdict, tried, at)).toEqual(expected);
  });

  it.each([
    { status: 'sold_out', alternatives: [] },
    { status: 'blocked', reason: 'device_limit' },
    { status: 'unavailable', reason: 'gift_not_valid' },
    { status: 'invalid', fieldErrors: { items: 'party_size' } },
  ])('the contract schema accepts %j', (result) => {
    expect(ReserveResultSchema.safeParse(result).success).toBe(true);
  });

  it.each([
    { status: 'sold_out' },
    { status: 'unavailable', reason: 'because' },
    { status: 'invalid', fieldErrors: { items: 'Quantity is too small' } },
    { status: 'held' },
  ])('the contract schema refuses %j', (result) => {
    expect(ReserveResultSchema.safeParse(result).success).toBe(false);
  });
});

describe('decideRelease', () => {
  const mine = { deviceKey: 'a'.repeat(64), sessionId: uuid };
  const hold = (status: HoldTimes['status'], overrides = {}) => ({
    status,
    ...mine,
    ...overrides,
  });
  const notFound = { release: false, result: { status: 'not_found' } };

  it.each([
    ['active', { release: true }],
    ['paying', { release: false, result: { status: 'payment_in_progress' } }],
    ['released', { release: false, result: { status: 'released' } }],
    ['converted', notFound],
  ] as const)('a %s hold of this device: %j', (status, expected) => {
    expect(decideRelease(hold(status), mine)).toEqual(expected);
  });

  it.each([
    ['missing', null],
    ['another device', hold('active', { deviceKey: 'b'.repeat(64) })],
    ['another session', hold('active', { sessionId: otherUuid })],
    ['another device, paying', hold('paying', { deviceKey: 'b'.repeat(64) })],
  ])('a hold that is %s answers not_found', (_name, subject) => {
    expect(decideRelease(subject, mine)).toEqual(notFound);
  });
});

describe('alternatives', () => {
  const day = 86_400_000;
  const candidate = (id: string, startsInMs: number, overrides = {}) => ({
    id,
    startsAt: later(startsInMs),
    timeZone: 'America/New_York',
    allocation: 10,
    seatsSold: 0,
    status: 'scheduled' as const,
    ...overrides,
  });
  const idsOf = (summaries: { sessionId: string }[]) =>
    summaries.map((s) => s.sessionId);

  it('spans from `at` to 14 days later', () => {
    expect(alternativeWindow(at)).toEqual({ from: at, until: later(14 * day) });
  });

  it('offers scheduled dates in the window with room for the party, soonest first', () => {
    const picked = pickAlternatives(
      [
        candidate('late', 9 * day),
        candidate('soon', day),
        candidate('cancelled', 2 * day, { status: 'cancelled' }),
        candidate('started', 0),
        candidate('begun', -day),
        candidate('too-far', 14 * day + 1),
        candidate('edge', 14 * day),
        candidate('full', 3 * day, { seatsSold: 9 }),
      ],
      [],
      2,
      at,
    );

    expect(idsOf(picked)).toEqual(['soon', 'late', 'edge']);
    expect(picked[0]).toEqual({
      sessionId: 'soon',
      startsAt: '2026-11-02T12:00:00.000Z',
      timeZone: 'America/New_York',
      spacesLeft: 10,
    });
  });

  it('counts open holds of that session only, and not lapsed ones', () => {
    const picked = pickAlternatives(
      [candidate('a', day), candidate('b', 2 * day)],
      [
        { ...active(later(1)), seats: 9, sessionId: 'a' },
        { ...active(at), seats: 9, sessionId: 'b' },
      ],
      2,
      at,
    );

    expect(idsOf(picked)).toEqual(['b']);
  });

  it('offers at most three', () => {
    const many = Array.from({ length: 6 }, (_, index) =>
      candidate(`s${String(index)}`, (index + 1) * day),
    );

    expect(idsOf(pickAlternatives(many, [], 1, at))).toEqual([
      's0',
      's1',
      's2',
    ]);
  });

  it('offers nothing when no date has room', () => {
    expect(
      pickAlternatives([candidate('a', day, { seatsSold: 10 })], [], 1, at),
    ).toEqual([]);
  });
});
