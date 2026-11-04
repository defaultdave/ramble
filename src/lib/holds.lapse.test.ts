import { describe, expect, it } from 'vitest';
import {
  isHoldOfDevice,
  blockRefusal,
  blockWindowStart,
  cleanupMayContinue,
  deviceHashPattern,
  holdsToRelease,
  requireAtMost,
  scrubCutoff,
  scrubbedHash,
  holdLimits,
  holdDeadline,
  isCheckoutHold,
  isLapsedHold,
  holdTransitions,
  requireHoldTransition,
} from './holds';
import { jobLimits } from './jobs';
import { at, msFrom } from './testClock';
import { minuteMs } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - which holds lapse and when (tested through blockRefusal), by status and release reason, and a guest
//   releasing a lapsed hold cannot clear it
// - the block: three lapses inside 15 minutes, counted from deadlines (swept or not alike), ends when the third
//   most recent leaves the window, boundaries at 15 minutes and at `at`; superseded, booked, and open do not count
// - cleanup: holdsToRelease splits by reason from status and deadline, the batch continues only on a full batch inside both caps
// - the scrub cutoff, and the scrub value is a valid hash; requireAtMost throws past its bound
// - a hold is a device's only when the hash matches; a missing hold is nobody's

describe('which holds lapse, and when (through blockRefusal)', () => {
  const expiresAt = msFrom(-10 * minuteMs);
  const payingUntil = msFrom(-5 * minuteMs);
  const hold = (overrides = {}) => ({
    status: 'active' as const,
    expiresAt,
    payingUntil: null,
    releasedReason: null,
    updatedAt: msFrom(-20 * minuteMs),
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
      released('guest_left', { updatedAt: msFrom(-11 * minuteMs) }),
      null,
    ],
    [
      'a guest leaving at the deadline is a lapse',
      released('guest_left', { updatedAt: expiresAt }),
      expiresAt,
    ],
    [
      'a guest releasing after the deadline cannot clear it',
      released('guest_left', { updatedAt: msFrom(-1) }),
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
      hold({ expiresAt: msFrom(-minutesAgo * minuteMs) }),
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
    expiresAt: msFrom(-minutesAgo * minuteMs),
    payingUntil: null,
    releasedReason: null,
    updatedAt: msFrom(-60 * minuteMs),
    ...overrides,
  });
  const blockedUntil = (minutesAgo: number) => ({
    status: 'blocked',
    reason: 'too_many_holds',
    until: msFrom((15 - minutesAgo) * minuteMs).toISOString(),
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
    const until = new Date(msFrom(12 * minuteMs));

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
    expect(blockWindowStart(at)).toEqual(msFrom(-15 * minuteMs));
  });
});

describe('holdsToRelease', () => {
  const times = (overrides = {}) => ({
    status: 'active' as const,
    expiresAt: msFrom(-1),
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
    [
      'an open active hold is left alone',
      times({ expiresAt: msFrom(1) }),
      null,
    ],
    [
      'a paying hold past paying_until was abandoned',
      times({ status: 'paying', payingUntil: at }),
      'payment_abandoned',
    ],
    [
      'a paying hold past expires_at but inside paying_until is left alone',
      times({ status: 'paying', payingUntil: msFrom(1) }),
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
          { id: 'c', ...times({ expiresAt: msFrom(1) }) },
          { id: 'd', ...times({ expiresAt: msFrom(-5) }) },
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

describe('the hold that is shown', () => {
  const times = {
    expiresAt: new Date('2026-10-23T14:10:00Z'),
    payingUntil: new Date('2026-10-23T14:15:00Z'),
  };

  it('counts an active hold to its expiry and a paying one to its paying deadline', () => {
    expect(holdDeadline({ status: 'active', ...times })).toEqual(
      times.expiresAt,
    );
    expect(holdDeadline({ status: 'paying', ...times })).toEqual(
      times.payingUntil,
    );
    expect(
      holdDeadline({ status: 'paying', ...times, payingUntil: null }),
    ).toEqual(times.expiresAt);
  });

  it.each([
    ['active', true],
    ['paying', true],
    ['converted', false],
    ['released', false],
  ] as const)('shows a %s hold: %s', (status, shown) => {
    expect(isCheckoutHold({ status })).toBe(shown);
  });
});

describe('isLapsedHold', () => {
  const times = {
    expiresAt: new Date('2026-10-23T14:10:00Z'),
    payingUntil: new Date('2026-10-23T14:20:00Z'),
  };

  it.each([
    [
      'an active hold before its expiry',
      'active',
      '2026-10-23T14:09:59.999Z',
      false,
    ],
    ['an active hold at its expiry', 'active', '2026-10-23T14:10:00Z', true],
    ['an active hold after its expiry', 'active', '2026-10-23T15:00:00Z', true],
    [
      'a paying hold before its paying deadline',
      'paying',
      '2026-10-23T14:15:00Z',
      false,
    ],
    [
      'a paying hold after its paying deadline',
      'paying',
      '2026-10-23T14:30:00Z',
      false,
    ],
    ['a converted hold', 'converted', '2026-10-23T15:00:00Z', false],
    ['a released hold', 'released', '2026-10-23T15:00:00Z', false],
  ] as const)('reads %s', (_name, status, at, lapsed) => {
    expect(isLapsedHold({ status, ...times }, new Date(at))).toBe(lapsed);
  });
});

describe('hold transitions', () => {
  it.each([
    ['active', 'paying'],
    ['paying', 'paying'],
    ['paying', 'active'],
    ['active', 'converted'],
    ['paying', 'converted'],
    ['active', 'released'],
    ['paying', 'released'],
    ['released', 'converted'],
  ] as const)('%s to %s is allowed', (from, to) => {
    expect(() => {
      requireHoldTransition(from, to);
    }).not.toThrow();
  });

  it.each([
    ['converted', 'released'],
    ['converted', 'active'],
    ['released', 'active'],
    ['released', 'paying'],
    ['active', 'active'],
  ] as const)('%s to %s is refused', (from, to) => {
    expect(() => {
      requireHoldTransition(from, to);
    }).toThrow(`A hold does not move from ${from} to ${to}`);
  });

  it('keeps a converted hold terminal', () => {
    expect(holdTransitions.converted).toEqual([]);
  });
});
