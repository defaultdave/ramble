import { describe, expect, it } from 'vitest';
import { curated } from './fixtures';
import {
  groupPlanned,
  hasPlannedSeats,
  planSessions,
  seatsSoldFor,
  seedSessionRange,
  sessionWeeksAhead,
  storedStartTime,
} from './plan';
import type { ExperienceFixture, HostFixture } from './types';

// Behaviours under test:
// - the range starts a day before now and runs eight weeks, in UTC dates
// - a stored start time carries seconds; seats sold is allocation less spaces left, clamped
// - only sessions that start after now are planned; one weekday gives one session a week
// - the wall time holds across the clock change, in the host's zone
// - a leave applies to the slot's n-th date counted from the range start, and only to that date
// - a host's own zone is used; the default is New York
// - planned sessions group by experience; a plan with no seats sold needs no second pass

const now = new Date('2026-10-28T15:00:00Z'); // Wednesday

const slot = {
  weekday: 6,
  startTime: '17:30',
  durationMinutes: 120,
  allocation: 12,
};

function experience(
  slots: ExperienceFixture['slots'],
  hostSlug = 'h',
): ExperienceFixture {
  const base = curated.experiences[0];
  if (!base) throw new Error('no fixture');
  return { ...base, slug: 'e', hostSlug, slots };
}

const host: HostFixture = { slug: 'h', name: 'H', description: 'D' };

describe('seedSessionRange', () => {
  it('starts a day before now and runs eight weeks', () => {
    expect(seedSessionRange(now)).toEqual({
      fromDate: '2026-10-27',
      toDate: '2026-12-22',
    });
    expect(sessionWeeksAhead).toBe(8);
  });
});

describe('storedStartTime and seatsSoldFor', () => {
  it('adds seconds to a start time', () => {
    expect(storedStartTime({ startTime: '08:30' })).toBe('08:30:00');
  });

  it.each([
    [12, 1, 11],
    [12, 0, 12],
    [12, 12, 0],
    [12, 20, 0],
    [12, -3, 12],
  ])('allocation %i with %i left sells %i', (allocation, left, sold) => {
    expect(seatsSoldFor(allocation, left)).toBe(sold);
  });
});

describe('planSessions', () => {
  it('plans one session a week for a weekly slot, none in the past', () => {
    const planned = planSessions([host], [experience([slot])], now);
    expect(planned.length).toBeGreaterThanOrEqual(8);
    expect(planned.length).toBeLessThanOrEqual(9);
    expect(planned.every((s) => s.startsAt > now)).toBe(true);
    expect(new Set(planned.map((s) => s.localDate)).size).toBe(planned.length);
  });

  it('skips a date whose start has passed', () => {
    const afterTheFirstSaturday = new Date('2026-10-31T22:00:00Z'); // 6:00 PM in New York
    const [first] = planSessions(
      [host],
      [experience([slot])],
      afterTheFirstSaturday,
    );
    expect(first?.localDate).toBe('2026-11-07');
  });

  it('holds the wall time across the November clock change', () => {
    const planned = planSessions([host], [experience([slot])], now);
    const hours = planned.map((s) =>
      new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
      }).format(s.startsAt),
    );
    expect(new Set(hours)).toEqual(new Set(['17:30']));
    const utcHours = new Set(planned.map((s) => s.startsAt.getUTCHours()));
    expect(utcHours.size).toBe(2);
  });

  it("uses the host's own zone", () => {
    const [chicago] = planSessions(
      [{ ...host, timeZone: 'America/Chicago' }],
      [experience([slot])],
      now,
    );
    const [newYork] = planSessions([host], [experience([slot])], now);
    expect(chicago?.startsAt.getTime()).toBe(
      (newYork?.startsAt.getTime() ?? 0) + 3_600_000,
    );
  });

  it('applies a leave to the n-th date of the slot only', () => {
    const planned = planSessions(
      [host],
      [experience([{ ...slot, leaves: [{ occurrence: 1, spacesLeft: 0 }] }])],
      now,
    );
    const sold = planned.filter((s) => s.seatsSold > 0);
    expect(sold).toHaveLength(1);
    expect(sold[0]).toMatchObject({ seatsSold: 12, localDate: '2026-11-07' });
  });

  it('leaves the allocation source and the template time on every session', () => {
    const planned = planSessions(
      [host],
      [experience([{ ...slot, source: 'allocation' }])],
      now,
    );
    expect(planned.every((s) => s.source === 'allocation')).toBe(true);
    expect(planned.every((s) => s.startTime === '17:30:00')).toBe(true);
  });

  it('plans the curated kayak with the second Saturday full, one space left, and sold out', () => {
    const planned = planSessions(curated.hosts, curated.experiences, now);
    const kayakSaturdays = planned.filter(
      (s) =>
        s.experienceSlug === 'sunset-kayak-on-the-hudson' && s.weekday === 6,
    );
    const day = kayakSaturdays.filter((s) => s.localDate === '2026-11-07');
    expect(day.map((s) => s.allocation - s.seatsSold).sort()).toEqual([
      0, 1, 12,
    ]);
  });
});

describe('groupPlanned and hasPlannedSeats', () => {
  it('groups by experience slug', () => {
    const planned = planSessions([host], [experience([slot])], now);
    expect([...groupPlanned(planned).keys()]).toEqual(['e']);
    expect(groupPlanned(planned).get('e')).toHaveLength(planned.length);
  });

  it('needs a second pass only when a session sells seats', () => {
    expect(
      hasPlannedSeats(planSessions([host], [experience([slot])], now)),
    ).toBe(false);
    expect(
      hasPlannedSeats(
        planSessions(
          [host],
          [
            experience([
              { ...slot, leaves: [{ occurrence: 1, spacesLeft: 3 }] },
            ]),
          ],
          now,
        ),
      ),
    ).toBe(true);
  });
});
