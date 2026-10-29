import { describe, expect, it } from 'vitest';
import {
  calendarDateFormat,
  isoDateOf,
  isReadableInstant,
  minuteAsOf,
  msPerDay,
  msPerMinute,
} from './time';

// Behaviours under test, one per decision, branch or risk:
// - the time constants are a minute and a day in milliseconds
// - the cache key is the time cut to the minute, one string for every moment in a minute, in the
//   ISO form a datetime schema accepts
// - a calendar date formatter writes the date in its own zone: east of UTC, west of UTC, across the
//   day line, and on a clock-change day
// - an ISO date is the UTC day, not the local one
// - a readable instant is a real date from the first moment of year 1000 to the last of year 9999 UTC; an invalid date and the edges outside fail

describe('the time constants', () => {
  it('are a minute and a day in milliseconds', () => {
    expect(msPerMinute).toBe(60 * 1000);
    expect(msPerDay).toBe(24 * 60 * msPerMinute);
  });
});

describe('minuteAsOf', () => {
  it('cuts the time to the minute', () => {
    expect(minuteAsOf(new Date('2026-10-26T14:05:59.999Z'))).toBe(
      '2026-10-26T14:05:00.000Z',
    );
  });

  it('gives one string to every moment in a minute', () => {
    expect(minuteAsOf(new Date('2026-10-26T14:05:00.000Z'))).toBe(
      minuteAsOf(new Date('2026-10-26T14:05:59.999Z')),
    );
  });

  it('writes an ISO instant a datetime schema accepts', () => {
    expect(minuteAsOf(new Date('2026-11-02T15:00:59.999Z'))).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/,
    );
  });
});

describe('calendarDateFormat', () => {
  it.each([
    ['America/New_York', '2026-11-03T04:59:00Z', '2026-11-02'],
    ['America/New_York', '2026-11-03T05:00:00Z', '2026-11-03'],
    ['Asia/Tokyo', '2026-11-02T15:00:00Z', '2026-11-03'],
    ['Pacific/Auckland', '2026-11-02T10:59:00Z', '2026-11-02'],
    ['UTC', '2026-12-31T23:59:59Z', '2026-12-31'],
  ])('writes a moment in %s: %s as %s', (zone, instant, expected) => {
    expect(calendarDateFormat(zone).format(new Date(instant))).toBe(expected);
  });

  it('refuses a zone it does not know', () => {
    expect(() => calendarDateFormat('Not/AZone')).toThrow(RangeError);
  });
});

describe('isoDateOf', () => {
  it.each([
    ['2026-10-26T00:00:00.000Z', '2026-10-26'],
    ['2026-10-26T23:59:59.999Z', '2026-10-26'],
    ['2026-12-31T23:59:59.999Z', '2026-12-31'],
  ])('is the UTC day of %s', (instant, expected) => {
    expect(isoDateOf(new Date(instant))).toBe(expected);
  });
});

describe('isReadableInstant', () => {
  it.each([
    ['the first readable moment', '1000-01-01T00:00:00Z', true],
    ['a current date', '2026-10-29T12:00:00Z', true],
    ['the last readable millisecond', '9999-12-31T23:59:59.999Z', true],
    ['a moment before year 1000', '0999-12-31T23:59:59.999Z', false],
    ['the first moment of year 10000', '+010000-01-01T00:00:00Z', false],
  ])('%s', (_name, iso, readable) => {
    expect(isReadableInstant(new Date(iso))).toBe(readable);
  });

  it('refuses an invalid date', () => {
    expect(isReadableInstant(new Date('not a date'))).toBe(false);
  });
});
