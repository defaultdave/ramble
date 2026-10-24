import { describe, expect, it } from 'vitest';
import { dayFlags, isDateAvailable } from './datePicker';

const today = '2026-10-18';
const available = ['2026-10-18', '2026-10-22', '2026-10-25', '2026-10-10'];

describe('isDateAvailable', () => {
  it.each([
    ['a listed date', '2026-10-22', true],
    ['today when listed', '2026-10-18', true],
    ['a date with no sessions', '2026-10-23', false],
    ['a listed date in the past', '2026-10-10', false],
    ['a date in another month', '2026-11-22', false],
  ])('%s', (_name, date, expected) => {
    expect(isDateAvailable(date, today, available)).toBe(expected);
  });

  it('is unavailable everywhere when nothing is listed', () => {
    expect(isDateAvailable('2026-10-22', today, [])).toBe(false);
  });
});

describe('dayFlags', () => {
  it.each([
    ['today, listed', '2026-10-18', { today: true, unavailable: false }],
    ['a listed date', '2026-10-22', { today: false, unavailable: false }],
    ['an unlisted date', '2026-10-23', { today: false, unavailable: true }],
    ['a past date', '2026-10-10', { today: false, unavailable: true }],
  ])('%s', (_name, date, expected) => {
    expect(dayFlags(date, today, available)).toEqual(expected);
  });

  it('marks today even when it has no sessions', () => {
    expect(dayFlags(today, today, [])).toEqual({
      today: true,
      unavailable: true,
    });
  });
});
