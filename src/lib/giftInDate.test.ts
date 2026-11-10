import { describe, expect, it } from 'vitest';
import {
  giftInDate,
  giftLimits,
  giftSendAtWithinHorizon,
  giftValidUntil,
} from './giftInDate';

// Behaviours under test, one per decision, branch or risk.
// - in date: before valid_until, out of date at valid_until and after
// - the send horizon: at most 365 days ahead, inclusive
// - valid_until: send_at plus whole calendar months in UTC, clamped to a shorter month, across a year end
// - validity months outside the settings bounds, and a send time that is not a date, are refused

const validUntil = new Date('2027-11-10T15:00:00.000Z');

describe('giftInDate', () => {
  it.each([
    ['a millisecond before', new Date('2027-11-10T14:59:59.999Z'), true],
    ['at valid_until', new Date('2027-11-10T15:00:00.000Z'), false],
    ['a millisecond after', new Date('2027-11-10T15:00:00.001Z'), false],
    ['long before', new Date('2026-11-10T15:00:00.000Z'), true],
  ])('%s: %s', (_name, at, expected) => {
    expect(giftInDate({ validUntil }, at)).toBe(expected);
  });
});

describe('giftSendAtWithinHorizon', () => {
  const now = new Date('2026-11-10T12:00:00.000Z');
  const horizon = new Date(
    now.getTime() + giftLimits.sendHorizonDays * 86_400_000,
  );

  it.each([
    ['now', now, true],
    ['before now', new Date('2026-01-01T00:00:00.000Z'), true],
    ['exactly the horizon', horizon, true],
    ['a millisecond past the horizon', new Date(horizon.getTime() + 1), false],
  ])('%s: %s', (_name, sendAt, expected) => {
    expect(giftSendAtWithinHorizon(sendAt, now)).toBe(expected);
  });
});

describe('giftValidUntil', () => {
  it.each([
    [
      'twelve months on',
      '2026-11-10T15:00:00.000Z',
      12,
      '2027-11-10T15:00:00.000Z',
    ],
    [
      'across a year end',
      '2026-11-30T09:30:00.000Z',
      3,
      '2027-02-28T09:30:00.000Z',
    ],
    [
      'clamped to a short month',
      '2026-01-31T00:00:00.000Z',
      1,
      '2026-02-28T00:00:00.000Z',
    ],
    [
      'clamped to a leap February',
      '2027-12-31T00:00:00.000Z',
      2,
      '2028-02-29T00:00:00.000Z',
    ],
    [
      'a leap day to the next year',
      '2028-02-29T00:00:00.000Z',
      12,
      '2029-02-28T00:00:00.000Z',
    ],
    [
      'the longest validity',
      '2026-11-10T15:00:00.000Z',
      120,
      '2036-11-10T15:00:00.000Z',
    ],
  ])('%s', (_name, sendAt, months, expected) => {
    expect(giftValidUntil(new Date(sendAt), months).toISOString()).toBe(
      expected,
    );
  });

  it('does not change the send time it is given', () => {
    const sendAt = new Date('2026-11-10T15:00:00.000Z');
    giftValidUntil(sendAt, 12);
    expect(sendAt.toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });

  it.each([0, -1, 121, 1.5, Number.NaN])('refuses %s months', (months) => {
    expect(() => giftValidUntil(validUntil, months)).toThrow(RangeError);
  });

  it('refuses a send time that is not a date', () => {
    expect(() => giftValidUntil(new Date(Number.NaN), 12)).toThrow(RangeError);
  });
});
