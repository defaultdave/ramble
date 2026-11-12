import { describe, expect, it } from 'vitest';
import {
  addDays,
  buildHostWeek,
  hostSessionFormValues,
  hostSessionInvalid,
  hostSessionProblem,
  publishWeekMessage,
  resolveWeek,
  weekBounds,
  weekStartOf,
  type HostWeekSession,
} from './hostSessions';
import { UpdateSessionAllocationInputSchema } from './sessions';

// Behaviours under test, one per decision, branch or risk:
// - a week runs Monday to Sunday, and any date in it names it (Sunday belongs to the week before the next Monday)
// - the address picks the week; nothing usable, or a week outside eight back and the horizon, reads as this week
// - a week's bounds are midnight to midnight in the host's zone, so a DST week is not 168 hours
// - the previous and next links stop at the limits, and "this week" shows only off this week
// - rows are grouped by the day in the session's own zone and say what may change: capacity until it starts,
//   time and cancel only with no seats sold, nothing once cancelled or started
// - a price is typed in dollars and kept in cents without a float; anything else is not a price
// - a form's refusal names its fields; a bad id or version is a stale form
// - publishing says what was added, what was already there, and what was past

const containing = (part: string): string =>
  expect.stringContaining(part) as string;

const now = new Date('2026-11-11T15:00:00.000Z');
const zone = 'America/New_York';
const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const session = (
  overrides: Partial<HostWeekSession> = {},
): HostWeekSession => ({
  id: id(1),
  experienceName: 'Sunset kayak',
  startsAt: new Date('2026-11-14T19:00:00.000Z'),
  endsAt: new Date('2026-11-14T21:00:00.000Z'),
  timeZone: zone,
  allocation: 10,
  seatsSold: 0,
  status: 'scheduled',
  version: 3,
  adultPriceMinor: 8500,
  ...overrides,
});

const week = (sessions: HostWeekSession[], weekStart = '2026-11-09') =>
  buildHostWeek(
    {
      hostName: 'Harbor Outfitters',
      timeZone: zone,
      weekStart,
      experiences: [{ id: id(9), name: 'Sunset kayak' }],
      sessions,
    },
    now,
  );

describe('weekStartOf', () => {
  it.each([
    ['a Monday', '2026-11-09', '2026-11-09'],
    ['a Saturday', '2026-11-14', '2026-11-09'],
    ['a Sunday', '2026-11-15', '2026-11-09'],
    ['the next Monday', '2026-11-16', '2026-11-16'],
    ['a Sunday that starts a new month', '2026-11-01', '2026-10-26'],
  ])('%s', (_label, date, expected) => {
    expect(weekStartOf(date)).toBe(expected);
  });
});

describe('addDays', () => {
  it('moves across a month and a year without a zone', () => {
    expect(addDays('2026-12-30', 3)).toBe('2027-01-02');
    expect(addDays('2026-03-09', -7)).toBe('2026-03-02');
  });
});

describe('resolveWeek', () => {
  it.each([
    ['no address', undefined, '2026-11-09'],
    ['text that is not a date', 'soon', '2026-11-09'],
    ['a date in next week', '2026-11-20', '2026-11-16'],
    ['the first week allowed', '2026-09-14', '2026-09-14'],
    ['a week before the first allowed', '2026-09-13', '2026-11-09'],
    ['the last week allowed', '2027-11-05', '2027-11-01'],
    ['a week past the horizon', '2027-11-08', '2026-11-09'],
    ['a year far ahead', '2030-01-01', '2026-11-09'],
  ])('%s', (_label, raw, expected) => {
    expect(resolveWeek(raw, now, zone)).toBe(expected);
  });

  it('reads this week on the host’s calendar, not UTC’s', () => {
    const lateSundayInNewYork = new Date('2026-11-16T03:00:00.000Z');
    expect(resolveWeek(undefined, lateSundayInNewYork, zone)).toBe(
      '2026-11-09',
    );
  });
});

describe('weekBounds', () => {
  it('runs from Monday midnight to the next Monday midnight in the zone', () => {
    expect(weekBounds('2026-11-09', zone)).toEqual({
      from: new Date('2026-11-09T05:00:00.000Z'),
      to: new Date('2026-11-16T05:00:00.000Z'),
    });
  });

  it('is an hour short in the week spring forward lands in', () => {
    expect(weekBounds('2026-03-02', zone)).toEqual({
      from: new Date('2026-03-02T05:00:00.000Z'),
      to: new Date('2026-03-09T04:00:00.000Z'),
    });
  });

  it('is an hour long in the week fall back lands in', () => {
    expect(weekBounds('2026-10-26', zone)).toEqual({
      from: new Date('2026-10-26T04:00:00.000Z'),
      to: new Date('2026-11-02T05:00:00.000Z'),
    });
  });
});

describe('buildHostWeek navigation', () => {
  it('links the weeks around this one and hides "this week" on it', () => {
    expect(week([])).toMatchObject({
      weekLabel: 'Mon, Nov 9 to Sun, Nov 15',
      prevHref: '/host/sessions?week=2026-11-02',
      nextHref: '/host/sessions?week=2026-11-16',
      thisWeekHref: null,
    });
  });

  it('offers the way back to this week from another', () => {
    expect(week([], '2026-11-16').thisWeekHref).toBe('/host/sessions');
  });

  it('has no previous link at the first week and no next at the last', () => {
    expect(week([], '2026-09-14').prevHref).toBeNull();
    expect(week([], '2027-11-01').nextHref).toBeNull();
    expect(week([], '2027-11-01').prevHref).toBe(
      '/host/sessions?week=2027-10-25',
    );
  });
});

describe('buildHostWeek rows', () => {
  it('groups by the day in the session’s zone and leaves empty days out', () => {
    const view = week([
      session({ id: id(1) }),
      session({
        id: id(2),
        startsAt: new Date('2026-11-14T23:00:00.000Z'),
        endsAt: new Date('2026-11-15T01:00:00.000Z'),
      }),
      session({
        id: id(3),
        startsAt: new Date('2026-11-15T15:00:00.000Z'),
        endsAt: new Date('2026-11-15T16:00:00.000Z'),
      }),
    ]);
    expect(view.days.map((day) => [day.label, day.sessions.length])).toEqual([
      ['Sat, Nov 14', 2],
      ['Sun, Nov 15', 1],
    ]);
  });

  it('describes a session for its edit forms', () => {
    const [row] = week([session()]).days[0]?.sessions ?? [];
    expect(row).toEqual({
      id: id(1),
      experienceName: 'Sunset kayak',
      timeLabel: '2:00 PM EST',
      soldLabel: '0 of 10 seats sold',
      statusLabel: 'Scheduled',
      priceLabel: '$85 adult',
      version: 3,
      startTime: '14:00',
      durationMinutes: 120,
      allocation: 10,
      adultPrice: '85',
      editable: true,
      movable: true,
    });
  });

  it.each([
    ['unbooked and upcoming', {}, true, true],
    ['with a seat sold', { seatsSold: 1 }, true, false],
    ['cancelled', { status: 'cancelled' as const }, false, false],
    ['completed', { status: 'completed' as const }, false, false],
    [
      'already started',
      { startsAt: new Date('2026-11-10T19:00:00.000Z') },
      false,
      false,
    ],
  ])('a session %s', (_label, overrides, editable, movable) => {
    const view = week([session(overrides)]);
    const row = view.days.flatMap((day) => day.sessions)[0];
    expect([row?.editable, row?.movable]).toEqual([editable, movable]);
  });

  it('has no price form for an experience without an adult price', () => {
    const [row] =
      week([session({ adultPriceMinor: null })]).days[0]?.sessions ?? [];
    expect([row?.priceLabel, row?.adultPrice]).toEqual([null, null]);
  });
});

describe('form values and refusals', () => {
  const get = (fields: Record<string, unknown>) => (field: string) =>
    fields[field];

  it('leaves a field that is not a number undefined, so the schema names it', () => {
    const values = hostSessionFormValues.capacity(
      get({ sessionId: ` ${id(1)} `, expectedVersion: '2', allocation: '8x' }),
    );
    expect(values).toEqual({
      sessionId: id(1),
      expectedVersion: 2,
      allocation: undefined,
    });
  });

  it('reads a file or a missing field as empty', () => {
    expect(
      hostSessionFormValues.week(get({ weekStart: new Blob([]) })),
    ).toEqual({ weekStart: '' });
  });

  it('names the field a refused capacity form got wrong', () => {
    const parsed = UpdateSessionAllocationInputSchema.safeParse(
      hostSessionFormValues.capacity(
        get({ sessionId: id(1), expectedVersion: '1', allocation: '-3' }),
      ),
    );
    if (parsed.success) throw new Error('expected a refusal');
    expect(hostSessionInvalid(parsed.error)).toEqual({
      status: 'invalid',
      errors: { allocation: containing('whole number') },
    });
  });

  it('calls a bad session id or version a stale form, not a field', () => {
    const parsed = UpdateSessionAllocationInputSchema.safeParse(
      hostSessionFormValues.capacity(
        get({ sessionId: 'nope', allocation: '8' }),
      ),
    );
    if (parsed.success) throw new Error('expected a refusal');
    expect(hostSessionInvalid(parsed.error)).toMatchObject({
      status: 'problem',
      message: containing('out of date'),
    });
  });

  it('says why a session with bookings cannot move', () => {
    expect(hostSessionProblem('has_bookings')).toEqual({
      status: 'problem',
      message: containing('Seats are booked'),
    });
  });
});

describe('publishWeekMessage', () => {
  it.each([
    [
      'no slots',
      { templates: 0, created: 0, alreadyExisted: 0, inThePast: 0 },
      'You have no weekly slots set up yet, so there is nothing to publish. Ramble can set them up for you.',
    ],
    [
      'everything new',
      { templates: 2, created: 3, alreadyExisted: 0, inThePast: 0 },
      '3 sessions added.',
    ],
    [
      'one new, some there, some past',
      { templates: 2, created: 1, alreadyExisted: 2, inThePast: 1 },
      '1 session added; 2 sessions already published; 1 date already past.',
    ],
    [
      'nothing needed',
      { templates: 1, created: 0, alreadyExisted: 1, inThePast: 0 },
      'No new sessions were needed; 1 session already published.',
    ],
  ])('%s', (_label, result, message) => {
    expect(publishWeekMessage(result)).toBe(message);
  });
});
