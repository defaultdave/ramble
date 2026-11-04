import { describe, expect, it } from 'vitest';
import {
  blockRefusal,
  blockWindowStart,
  exceptSuperseded,
  holdsToSupersede,
  seatLimitRefusal,
} from './holds';
import { at, later, minuteMs, deviceKey, open } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - supersede: only the device's own open active holds; a paying, lapsed, released, converted, or another
//   device's hold is never superseded
// - the seat limit: six in all with the party, across sessions, counting only open holds, one answer with no
//   end time
// - which holds lapse and when (tested through blockRefusal), by status and release reason, and a guest
//   releasing a lapsed hold cannot clear it
// - the block: three lapses inside 15 minutes, counted from deadlines (swept or not alike), ends when the third
//   most recent leaves the window, boundaries at 15 minutes and at `at`; superseded, booked, and open do not count

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

    expect(blockRefusal(rows, new Date(until.getTime() - 1))).toEqual(
      blockedUntil(3),
    );
    expect(blockRefusal(rows, until)).toBeNull();
  });

  it('uses the third most recent of more than three', () => {
    expect(
      blockRefusal([lapsed(9), lapsed(1), lapsed(5), lapsed(2)], at),
    ).toEqual(blockedUntil(5));
  });

  it('counts a lapse 14 minutes ago and not one exactly 15 minutes ago', () => {
    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(14)], at)).toEqual(
      blockedUntil(14),
    );
    expect(blockRefusal([lapsed(1), lapsed(2), lapsed(15)], at)).toBeNull();
  });

  it('counts a deadline equal to `at` and not one after it', () => {
    expect(blockRefusal([lapsed(0), lapsed(1), lapsed(2)], at)).toEqual(
      blockedUntil(2),
    );
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
