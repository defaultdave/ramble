import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import {
  isOpenSession,
  isUpcomingSession,
  upcomingWindow,
} from './sessionWindow';
import { minuteAsOf, msPerDay } from './time';

const asOf = '2026-11-02T15:00:00.000Z';
const window = upcomingWindow(asOf, 7);
const at = (offsetMs: number) => new Date(window.from.getTime() + offsetMs);

describe('upcomingWindow', () => {
  it('runs from the key for the days given', () => {
    expect(window.from.toISOString()).toBe(asOf);
    expect(window.to.toISOString()).toBe('2026-11-09T15:00:00.000Z');
    const long = upcomingWindow(asOf, 121);
    expect(long.to.getTime() - long.from.getTime()).toBe(121 * msPerDay);
  });

  it.each([
    ['text', 'not a date'],
    ['a date with no time', '2026-11-02'],
    ['a time with an offset', '2026-11-02T15:00:00.000+02:00'],
    ['an empty key', ''],
    ['a month that does not exist', '2026-13-02T15:00:00.000Z'],
  ])('refuses a key that is %s', (_name, key) => {
    expect(() => upcomingWindow(key, 7)).toThrow(ZodError);
  });

  it('accepts the key minuteAsOf writes', () => {
    expect(() =>
      upcomingWindow(minuteAsOf(new Date('2026-11-02T15:00:59.999Z')), 7),
    ).not.toThrow();
  });
});

describe('isUpcomingSession', () => {
  it.each([
    ['a minute before the window opens', -60_000, false],
    ['exactly when the window opens', 0, true],
    ['a minute after the window opens', 60_000, true],
    ['a minute before the window ends', 7 * msPerDay - 60_000, true],
    ['exactly when the window ends', 7 * msPerDay, false],
    ['a minute after the window ends', 7 * msPerDay + 60_000, false],
  ])('for a session starting %s', (_name, offsetMs, expected) => {
    expect(isUpcomingSession({ startsAt: at(offsetMs) }, window)).toBe(
      expected,
    );
  });
});

describe('isOpenSession', () => {
  it.each([
    ['upcoming with spaces left', 60_000, 10, 4, true],
    ['upcoming with one space left', 60_000, 10, 9, true],
    ['upcoming and sold out', 60_000, 10, 10, false],
    ['upcoming with no spaces to sell', 60_000, 0, 0, false],
    ['starting exactly when the window opens', 0, 10, 0, true],
    ['starting exactly when the window ends', 7 * msPerDay, 10, 0, false],
    ['before the window, with spaces', -60_000, 10, 0, false],
  ])('for a session %s', (_name, offsetMs, allocation, seatsSold, expected) => {
    expect(
      isOpenSession({ startsAt: at(offsetMs), allocation, seatsSold }, window),
    ).toBe(expected);
  });
});

describe('isOpenSession for a party', () => {
  it.each([
    ['4 spaces left for a party of 4', 4, 4, true],
    ['3 spaces left for a party of 4', 3, 4, false],
    ['1 space left for a party of 1', 1, 1, true],
    ['no space left for a party of 1', 0, 1, false],
    ['1 space left and no party given', 1, null, true],
    ['no space left and no party given', 0, null, false],
  ])('a session with %s', (_name, spacesLeft, party, expected) => {
    const session = {
      startsAt: at(60_000),
      allocation: 10,
      seatsSold: 10 - spacesLeft,
    };
    expect(isOpenSession(session, window, party)).toBe(expected);
  });

  it('still wants the session inside the window', () => {
    const before = { startsAt: at(-60_000), allocation: 10, seatsSold: 0 };
    expect(isOpenSession(before, window, 2)).toBe(false);
  });
});
