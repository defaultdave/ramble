import { describe, expect, it } from 'vitest';
import {
  giftRefusal,
  holdExpiresAt,
  isOpenHold,
  openHeldSeats,
  partyFits,
  partyFor,
  pausedRefusal,
  requireBoundedHolds,
  reserveRefusal,
  spacesLeft,
  unbookableSession,
} from './holds';
import { maxAllocation } from './sessions';
import { at, later, active } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - isOpenHold: active before its deadline, paying before its deadline, a deadline equal to `at` is
//   not open, a paying hold with no deadline is not open, converted and released never are, and a
//   paying hold past `expires_at` but before `paying_until` is open
// - spacesLeft counts only open holds, returns negative as is, and a lapsed hold counts for nothing
// - the open-hold fetch refuses more rows than the largest capacity
// - partyFor: not offered before party size, party size counts only space-using lines, 1..6 inclusive
// - holdExpiresAt adds the minutes and refuses a length outside the settings bounds
// - reserveRefusal: missing and not-live answer alike, a not-scheduled session before the past check,
//   a start at `at` is past, a start after `at` passes

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
