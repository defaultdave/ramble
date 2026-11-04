import { describe, expect, it } from 'vitest';
import {
  payingHold,
  payingUntil,
  remainingSpaces,
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
  type HoldTimes,
  holdTransitions,
  requireHoldTransition,
} from './holds';
import { jobLimits } from './jobs';
import { at, later } from './holds.fixtures';

// Behaviours under test, one per decision, branch or risk:
// - cleanup: holdsToRelease splits by reason from status and deadline, the batch continues only on a full batch inside both caps
// - the scrub cutoff, and the scrub value is a valid hash; requireAtMost throws past its bound
// - remaining spaces are capacity less sold less the seats held, negative as is
// - the paying deadline is the later of expiry and now, plus the grace; a grace outside the bounds is refused
// - only an open active hold becomes paying: a lapsed, paying, converted, or released one is left alone
// - the shown hold, the lapsed-hold rule and the hold transitions

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
