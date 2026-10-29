import { describe, expect, it } from 'vitest';
import {
  ReleaseInputSchema,
  ReserveInputSchema,
  ReserveResultSchema,
  alternativeWindow,
  blockedForBot,
  fieldErrorsFromIssues,
  isHoldOfDevice,
  payingHold,
  payingUntil,
  remainingSpaces,
  blockedForRateLimit,
  blockRefusal,
  blockWindowStart,
  cleanupMayContinue,
  deviceHashPattern,
  exceptSuperseded,
  holdsToRelease,
  holdsToSupersede,
  requireAtMost,
  scrubCutoff,
  scrubbedHash,
  seatLimitRefusal,
  reserveBlock,
  spendsReserveTry,
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
import { jobLimits } from './jobs';
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
// - supersede: only the device's own open active holds; a paying, lapsed, released, converted, or another
//   device's hold is never superseded
// - the seat limit: six in all with the party, across sessions, counting only open holds, one answer with no
//   end time
// - which holds lapse and when (tested through blockRefusal), by status and release reason, and a guest
//   releasing a lapsed hold cannot clear it
// - the block: three lapses inside 15 minutes, counted from deadlines (swept or not alike), ends when the third
//   most recent leaves the window, boundaries at 15 minutes and at `at`; superseded, booked, and open do not count
// - cleanup: holdsToRelease splits by reason from status and deadline, the batch continues only on a full batch inside both caps
// - the scrub cutoff, and the scrub value is a valid hash; requireAtMost throws past its bound
// - remaining spaces are capacity less sold less the seats held, negative as is
// - the paying deadline is the later of expiry and now, plus the grace; a grace outside the bounds is refused
// - only an open active hold becomes paying: a lapsed, paying, converted, or released one is left alone
// - a hold is a device's only when the hash matches; a missing hold is nobody's
// - field errors take the issue's first message, keyed as the caller says

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
    ['a bot', 'bot', false],
    ['a person', 'human', true],
  ] as const)('spendsReserveTry answers for %s', (_name, verdict, expected) => {
    expect(spendsReserveTry(verdict)).toBe(expected);
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

const minuteMs = 60_000;
const deviceKey = 'a'.repeat(64);
const open = (overrides = {}) => ({
  id: 'h1',
  deviceKey,
  status: 'active' as const,
  expiresAt: later(minuteMs),
  payingUntil: null,
  ...overrides,
});

describe('holdsToSupersede', () => {
  it.each([
    ['the device’s open active hold', open(), ['h1']],
    ['a lapsed active hold', open({ expiresAt: at }), []],
    [
      'a paying hold, because a payment is in flight',
      open({ status: 'paying', payingUntil: later(minuteMs) }),
      [],
    ],
    ['another device’s hold', open({ deviceKey: 'b'.repeat(64) }), []],
    ['a released hold', open({ status: 'released' }), []],
    ['a converted hold', open({ status: 'converted' }), []],
  ])('on %s picks %j', (_name, hold, expected) => {
    expect(holdsToSupersede([hold], deviceKey, at)).toEqual(expected);
  });

  it('picks every open active hold of the device', () => {
    expect(
      holdsToSupersede([open(), open({ id: 'h2' })], deviceKey, at),
    ).toEqual(['h1', 'h2']);
  });
});

describe('exceptSuperseded', () => {
  it('drops the superseded holds and keeps the rest in order', () => {
    expect(
      exceptSuperseded([{ id: 'a' }, { id: 'b' }, { id: 'c' }], ['b']),
    ).toEqual([{ id: 'a' }, { id: 'c' }]);
  });
});

describe('seatLimitRefusal', () => {
  const seatsHeld = (seats: number, overrides = {}) => ({
    seats,
    status: 'active' as const,
    expiresAt: later(minuteMs),
    payingUntil: null,
    ...overrides,
  });
  const refused = { status: 'blocked', reason: 'device_limit' };

  it.each([
    ['nothing held, a party of six', [], 6, null],
    ['five held, a party of one', [seatsHeld(5)], 1, null],
    ['five held, a party of two', [seatsHeld(5)], 2, refused],
    ['holds in two sessions add up', [seatsHeld(3), seatsHeld(3)], 1, refused],
    [
      'a lapsed hold counts for nothing',
      [seatsHeld(5, { expiresAt: at })],
      6,
      null,
    ],
    [
      'a paying hold before paying_until counts',
      [
        seatsHeld(4, {
          status: 'paying',
          expiresAt: at,
          payingUntil: later(minuteMs),
        }),
      ],
      3,
      refused,
    ],
    [
      'a released hold counts for nothing',
      [seatsHeld(5, { status: 'released' })],
      6,
      null,
    ],
  ])('%s', (_name, others, party, expected) => {
    expect(seatLimitRefusal(others, party, at)).toEqual(expected);
  });

  it('gives no end time, because holds free their seats at different moments', () => {
    expect(seatLimitRefusal([seatsHeld(6)], 1, at)).not.toHaveProperty('until');
  });
});

describe('which holds lapse, and when (through blockRefusal)', () => {
  const expiresAt = later(-10 * minuteMs);
  const payingUntil = later(-5 * minuteMs);
  const hold = (overrides = {}) => ({
    status: 'active' as const,
    expiresAt,
    payingUntil: null,
    releasedReason: null,
    updatedAt: later(-20 * minuteMs),
    ...overrides,
  });
  const released = (releasedReason: string, overrides = {}) =>
    hold({ status: 'released', releasedReason, ...overrides });

  it.each([
    ['an active hold lapses at expires_at', hold(), expiresAt],
    [
      'a paying hold lapses at paying_until',
      hold({ status: 'paying', payingUntil }),
      payingUntil,
    ],
    [
      'a paying hold with no deadline has none',
      hold({ status: 'paying' }),
      null,
    ],
    ['a converted hold is a booking', hold({ status: 'converted' }), null],
    ['an expired release lapsed at expires_at', released('expired'), expiresAt],
    [
      'an abandoned payment lapsed at paying_until',
      released('payment_abandoned', { payingUntil }),
      payingUntil,
    ],
    [
      'an abandoned payment with no paying_until falls back to expires_at',
      released('payment_abandoned'),
      expiresAt,
    ],
    [
      'a guest leaving before the deadline is no lapse',
      released('guest_left', { updatedAt: later(-11 * minuteMs) }),
      null,
    ],
    [
      'a guest leaving at the deadline is a lapse',
      released('guest_left', { updatedAt: expiresAt }),
      expiresAt,
    ],
    [
      'a guest releasing after the deadline cannot clear it',
      released('guest_left', { updatedAt: later(-1) }),
      expiresAt,
    ],
    ['a superseded hold is no lapse', released('superseded'), null],
    ['a cancelled session is no lapse', released('session_cancelled'), null],
    [
      'a refunded late payment is no lapse',
      released('sold_out_after_lapse'),
      null,
    ],
    [
      'a released hold with no reason is no lapse',
      released(null as never),
      null,
    ],
  ])('%s', (_name, candidate, expected) => {
    // Two newer lapses make the candidate the third most recent, so `until` is its deadline plus 15 minutes.
    const newer = [1, 2].map((minutesAgo) =>
      hold({ expiresAt: later(-minutesAgo * minuteMs) }),
    );
    expect(blockRefusal([candidate, ...newer], at)).toEqual(
      expected === null
        ? null
        : {
            status: 'blocked',
            reason: 'too_many_holds',
            until: new Date(expected.getTime() + 15 * minuteMs).toISOString(),
          },
    );
  });
});

describe('blockRefusal', () => {
  const lapsed = (minutesAgo: number, overrides = {}) => ({
    status: 'active' as const,
    expiresAt: later(-minutesAgo * minuteMs),
    payingUntil: null,
    releasedReason: null,
    updatedAt: later(-60 * minuteMs),
    ...overrides,
  });
  const blockedUntil = (minutesAgo: number) => ({
    status: 'blocked',
    reason: 'too_many_holds',
    until: later((15 - minutesAgo) * minuteMs).toISOString(),
  });

  it('lets a device through with two lapses', () => {
    expect(blockRefusal([lapsed(1), lapsed(2)], at)).toBeNull();
  });

  it('blocks on three lapses until the third most recent leaves the window', () => {
    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(3)], at)).toEqual(
      blockedUntil(3),
    );
  });

  it('ends the block at `until`, and not a moment before', () => {
    const rows = [lapsed(1), lapsed(2), lapsed(3)];
    const until = new Date(later(12 * minuteMs));

    expect(blockRefusal(rows, new Date(until.getTime() - 1))).not.toBeNull();
    expect(blockRefusal(rows, until)).toBeNull();
  });

  it('uses the third most recent of more than three', () => {
    expect(
      blockRefusal([lapsed(9), lapsed(1), lapsed(5), lapsed(2)], at),
    ).toEqual(blockedUntil(5));
  });

  it('counts a lapse 14 minutes ago and not one exactly 15 minutes ago', () => {
    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(14)], at)).not.toBeNull();
    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(15)], at)).toBeNull();
  });

  it('counts a deadline equal to `at` and not one after it', () => {
    expect(blockRefusal([lapsed(0), lapsed(1), lapsed(2)], at)).not.toBeNull();
    expect(blockRefusal([lapsed(-1), lapsed(1), lapsed(2)], at)).toBeNull();
  });

  it('counts a hold the cleanup job has not released, the same as one it has', () => {
    const swept = (minutesAgo: number) =>
      lapsed(minutesAgo, { status: 'released', releasedReason: 'expired' });

    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(3)], at)).toEqual(
      blockRefusal([swept(1), swept(2), swept(3)], at),
    );
  });

  it('does not count superseded holds, bookings, or open holds', () => {
    const superseded = lapsed(1, {
      status: 'released',
      releasedReason: 'superseded',
    });
    const booked = lapsed(2, { status: 'converted' });
    const stillOpen = lapsed(-5);

    expect(
      blockRefusal([superseded, booked, stillOpen, lapsed(3)], at),
    ).toBeNull();
  });
});

describe('blockWindowStart', () => {
  it('is 15 minutes before `at`', () => {
    expect(blockWindowStart(at)).toEqual(later(-15 * minuteMs));
  });
});

describe('holdsToRelease', () => {
  const times = (overrides = {}) => ({
    status: 'active' as const,
    expiresAt: later(-1),
    payingUntil: null,
    ...overrides,
  });

  it.each([
    ['a lapsed active hold expired', times(), 'expired'],
    [
      'an active hold at its deadline expired',
      times({ expiresAt: at }),
      'expired',
    ],
    ['an open active hold is left alone', times({ expiresAt: later(1) }), null],
    [
      'a paying hold past paying_until was abandoned',
      times({ status: 'paying', payingUntil: at }),
      'payment_abandoned',
    ],
    [
      'a paying hold past expires_at but inside paying_until is left alone',
      times({ status: 'paying', payingUntil: later(1) }),
      null,
    ],
    ['a converted hold is left alone', times({ status: 'converted' }), null],
    ['a released hold is left alone', times({ status: 'released' }), null],
  ])('%s', (_name, hold, expected) => {
    const sorted = holdsToRelease([{ id: 'h', ...hold }], at);
    expect(sorted).toEqual({
      expired: expected === 'expired' ? ['h'] : [],
      payment_abandoned: expected === 'payment_abandoned' ? ['h'] : [],
    });
  });

  it('splits a mixed set by reason and keeps every id once, in order', () => {
    expect(
      holdsToRelease(
        [
          { id: 'a', ...times() },
          { id: 'b', ...times({ status: 'paying', payingUntil: at }) },
          { id: 'c', ...times({ expiresAt: later(1) }) },
          { id: 'd', ...times({ expiresAt: later(-5) }) },
          { id: 'e', ...times({ status: 'converted' }) },
        ],
        at,
      ),
    ).toEqual({ expired: ['a', 'd'], payment_abandoned: ['b'] });
  });

  it('releases nothing from an empty set', () => {
    expect(holdsToRelease([], at)).toEqual({
      expired: [],
      payment_abandoned: [],
    });
  });
});

describe('cleanupMayContinue', () => {
  const full = holdLimits.cleanupBatch;

  it.each([
    ['a full batch inside the caps', full, 1, 0, true],
    ['a short batch', full - 1, 1, 0, false],
    [
      'the last batch the cap allows',
      full,
      holdLimits.cleanupMaxBatches - 1,
      0,
      true,
    ],
    ['the batch cap', full, holdLimits.cleanupMaxBatches, 0, false],
    ['the time budget', full, 1, jobLimits.drainMaxMillis, false],
  ])('%s', (_name, done, batches, elapsedMs, expected) => {
    expect(cleanupMayContinue({ done, batches, elapsedMs })).toBe(expected);
  });
});

describe('scrubCutoff', () => {
  it('is the retention days before `at`', () => {
    expect(scrubCutoff(at)).toEqual(
      new Date(at.getTime() - holdLimits.releasedRetentionDays * 86_400_000),
    );
  });

  it('keeps a scrub value that is a valid hash and no real cookie produces', () => {
    expect(scrubbedHash).toMatch(new RegExp(deviceHashPattern));
  });
});

describe('requireAtMost', () => {
  it('returns rows up to the maximum and throws one past it', () => {
    expect(requireAtMost([1, 2], 2, 'things')).toEqual([1, 2]);
    expect(() => requireAtMost([1, 2, 3], 2, 'things')).toThrow(
      'More things than the rules allow (2)',
    );
  });
});

describe('remaining spaces', () => {
  it.each([
    [10, 3, 2, 5],
    [10, 10, 0, 0],
    [4, 3, 3, -2],
  ])(
    'capacity %i, sold %i, held %i leaves %i',
    (allocation, seatsSold, held, left) => {
      expect(remainingSpaces({ allocation, seatsSold }, held)).toBe(left);
    },
  );
});

describe('the paying deadline', () => {
  it.each([
    ['expiry still ahead', later(5 * 60_000), 5, later(10 * 60_000)],
    ['expiry already past', later(-60_000), 5, later(5 * 60_000)],
    ['expiry now', at, 0, at],
    ['the largest grace', later(60_000), 30, later(31 * 60_000)],
  ])(
    'is the later of expiry and now plus the grace: %s',
    (_name, expiresAt, grace, expected) => {
      expect(payingUntil(expiresAt, at, grace)).toEqual(expected);
    },
  );

  it.each([[-1], [31], [1.5], [Number.NaN]])(
    'refuses a grace of %s',
    (grace) => {
      expect(() => payingUntil(at, at, grace)).toThrow(RangeError);
    },
  );
});

describe('making a hold paying', () => {
  const hold = (change: Partial<HoldTimes>): HoldTimes => ({
    status: 'active',
    expiresAt: later(5 * 60_000),
    payingUntil: null,
    ...change,
  });

  it('moves an open active hold to paying with the deadline', () => {
    expect(payingHold(hold({}), at, 5)).toEqual({
      payingUntil: later(10 * 60_000),
    });
  });

  it.each([
    ['an active hold past its expiry', hold({ expiresAt: later(-1) })],
    ['an active hold expiring now', hold({ expiresAt: at })],
    [
      'a paying hold, which keeps its deadline',
      hold({ status: 'paying', payingUntil: later(60_000) }),
    ],
    ['a converted hold', hold({ status: 'converted' })],
    ['a released hold', hold({ status: 'released' })],
  ])('leaves %s alone', (_name, subject) => {
    expect(payingHold(subject, at, 5)).toBeNull();
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
