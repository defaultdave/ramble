import { describe, expect, it } from 'vitest';
import { zonedDayWindow } from './zonedDay';

// Behaviours under test:
// - a New York day runs from its local midnight to the next one, in UTC terms 04:00 to 04:00 in summer and 05:00 to 05:00 in winter
// - the window is the day that contains the instant, even when UTC is already on the next date
// - the first instant of a day is in, and the first instant of the next day is out
// - a day with a clock change is 23 or 25 hours long, not 24
// - a zone ahead of UTC gets its own day, and UTC gets the UTC date

const iso = (window: { from: Date; to: Date }) => [
  window.from.toISOString(),
  window.to.toISOString(),
];

describe('zonedDayWindow', () => {
  it.each([
    [
      'a winter day',
      '2026-11-17T15:00:00Z',
      'America/New_York',
      ['2026-11-17T05:00:00.000Z', '2026-11-18T05:00:00.000Z'],
    ],
    [
      'a summer day',
      '2026-07-01T15:00:00Z',
      'America/New_York',
      ['2026-07-01T04:00:00.000Z', '2026-07-02T04:00:00.000Z'],
    ],
    [
      'an evening that is already tomorrow in UTC',
      '2026-11-18T02:30:00Z',
      'America/New_York',
      ['2026-11-17T05:00:00.000Z', '2026-11-18T05:00:00.000Z'],
    ],
    [
      'the first instant of the day',
      '2026-11-17T05:00:00Z',
      'America/New_York',
      ['2026-11-17T05:00:00.000Z', '2026-11-18T05:00:00.000Z'],
    ],
    [
      'the last millisecond of the day',
      '2026-11-18T04:59:59.999Z',
      'America/New_York',
      ['2026-11-17T05:00:00.000Z', '2026-11-18T05:00:00.000Z'],
    ],
    [
      'the day clocks go forward (23 hours)',
      '2026-03-08T12:00:00Z',
      'America/New_York',
      ['2026-03-08T05:00:00.000Z', '2026-03-09T04:00:00.000Z'],
    ],
    [
      'the day clocks go back (25 hours)',
      '2026-11-01T12:00:00Z',
      'America/New_York',
      ['2026-11-01T04:00:00.000Z', '2026-11-02T05:00:00.000Z'],
    ],
    [
      'a zone ahead of UTC',
      '2026-11-17T20:00:00Z',
      'Asia/Tokyo',
      ['2026-11-17T15:00:00.000Z', '2026-11-18T15:00:00.000Z'],
    ],
    [
      'UTC',
      '2026-11-17T23:59:00Z',
      'UTC',
      ['2026-11-17T00:00:00.000Z', '2026-11-18T00:00:00.000Z'],
    ],
  ])('%s', (_name, now, zone, expected) => {
    expect(iso(zonedDayWindow(new Date(now), zone))).toEqual(expected);
  });
});
