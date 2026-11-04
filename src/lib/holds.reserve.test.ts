import { describe, expect, it } from 'vitest';
import {
  ReserveResultSchema,
  alternativeWindow,
  blockedForBot,
  payingHold,
  payingUntil,
  remainingSpaces,
  blockedForRateLimit,
  exceptSuperseded,
  holdsToSupersede,
  seatLimitRefusal,
  reserveBlock,
  spendsReserveTry,
  decideRelease,
  giftRefusal,
  heldResult,
  holdExpiresAt,
  pausedRefusal,
  pickAlternatives,
  reserveRefusal,
  unbookableSession,
  type HoldTimes,
} from './holds';
import { at, msFrom } from './testClock';
import { uuid, otherUuid, active, minuteMs } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
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
// - remaining spaces are capacity less sold less the seats held, negative as is
// - the paying deadline is the later of expiry and now, plus the grace; a grace outside the bounds is refused
// - only an open active hold becomes paying: a lapsed, paying, converted, or released one is left alone

const deviceKey = 'a'.repeat(64);
const open = (overrides = {}) => ({
  id: 'h1',
  deviceKey,
  status: 'active' as const,
  expiresAt: msFrom(minuteMs),
  payingUntil: null,
  ...overrides,
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
    startsAt: msFrom(1),
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
        reserveRefusal({ ...open, sessionStatus, startsAt: msFrom(-1) }, at),
      ).toEqual(expected);
    },
  );

  it.each([0, -1])('answers a start %s ms from now as past', (offset) => {
    expect(reserveRefusal({ ...open, startsAt: msFrom(offset) }, at)).toEqual({
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
      { id: uuid, expiresAt: msFrom(600_000) },
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
    startsAt: msFrom(startsInMs),
    timeZone: 'America/New_York',
    allocation: 10,
    seatsSold: 0,
    status: 'scheduled' as const,
    ...overrides,
  });
  const idsOf = (summaries: { sessionId: string }[]) =>
    summaries.map((s) => s.sessionId);

  it('spans from `at` to 14 days later', () => {
    expect(alternativeWindow(at)).toEqual({
      from: at,
      until: msFrom(14 * day),
    });
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
        { ...active(msFrom(1)), seats: 9, sessionId: 'a' },
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

describe('holdsToSupersede', () => {
  it.each([
    ['the device’s open active hold', open(), ['h1']],
    ['a lapsed active hold', open({ expiresAt: at }), []],
    [
      'a paying hold, because a payment is in flight',
      open({ status: 'paying', payingUntil: msFrom(minuteMs) }),
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
    expiresAt: msFrom(minuteMs),
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
          payingUntil: msFrom(minuteMs),
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
    ['expiry still ahead', msFrom(5 * 60_000), 5, msFrom(10 * 60_000)],
    ['expiry already past', msFrom(-60_000), 5, msFrom(5 * 60_000)],
    ['expiry now', at, 0, at],
    ['the largest grace', msFrom(60_000), 30, msFrom(31 * 60_000)],
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
    expiresAt: msFrom(5 * 60_000),
    payingUntil: null,
    ...change,
  });

  it('moves an open active hold to paying with the deadline', () => {
    expect(payingHold(hold({}), at, 5)).toEqual({
      payingUntil: msFrom(10 * 60_000),
    });
  });

  it.each([
    ['an active hold past its expiry', hold({ expiresAt: msFrom(-1) })],
    ['an active hold expiring now', hold({ expiresAt: at })],
    [
      'a paying hold, which keeps its deadline',
      hold({ status: 'paying', payingUntil: msFrom(60_000) }),
    ],
    ['a converted hold', hold({ status: 'converted' })],
    ['a released hold', hold({ status: 'released' })],
  ])('leaves %s alone', (_name, subject) => {
    expect(payingHold(subject, at, 5)).toBeNull();
  });
});
