import { describe, expect, it } from 'vitest';
import { dayFlags, dayLabel, isDateAvailable, visibleDate } from './datePicker';

const today = '2026-10-18';
const available = ['2026-10-18', '2026-10-22', '2026-10-25', '2026-10-10'];
const context = { today, value: '2026-10-22', availableDates: available };

describe('visibleDate', () => {
  it.each([
    ['the chosen date', '2026-11-07', ['2026-10-22'], '2026-11-07'],
    [
      'the first date on offer when nothing is chosen',
      null,
      ['2026-11-09', '2026-11-03'],
      '2026-11-03',
    ],
    [
      'a date on offer, skipping any before today',
      null,
      ['2026-10-10', '2026-11-03'],
      '2026-11-03',
    ],
    ['today when nothing is on offer', null, [], today],
  ])('shows the month of %s', (_name, value, dates, expected) => {
    expect(visibleDate({ today, value, availableDates: dates })).toBe(expected);
  });
});

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
    [
      'today, listed',
      '2026-10-18',
      { today: true, selected: false, unavailable: false },
    ],
    [
      'the chosen date',
      '2026-10-22',
      { today: false, selected: true, unavailable: false },
    ],
    [
      'an unlisted date',
      '2026-10-23',
      { today: false, selected: false, unavailable: true },
    ],
    [
      'a past date',
      '2026-10-10',
      { today: false, selected: false, unavailable: true },
    ],
  ])('%s', (_name, date, expected) => {
    expect(dayFlags(date, context)).toEqual(expected);
  });

  it('marks today even when it has no sessions', () => {
    expect(dayFlags(today, { today, value: null, availableDates: [] })).toEqual(
      { today: true, selected: false, unavailable: true },
    );
  });
});

describe('dayLabel', () => {
  const plain = { today: false, selected: false, unavailable: false };

  it.each([
    ['a plain date', plain, 'Thursday, October 22, 2026'],
    ['today', { ...plain, today: true }, 'Today, Thursday, October 22, 2026'],
    [
      'the chosen date',
      { ...plain, selected: true },
      'Thursday, October 22, 2026 selected',
    ],
    [
      'an unavailable date',
      { ...plain, unavailable: true },
      'Thursday, October 22, 2026, unavailable',
    ],
    [
      'today, chosen, and unavailable',
      { today: true, selected: true, unavailable: true },
      'Today, Thursday, October 22, 2026 selected, unavailable',
    ],
  ])('words %s', (_name, flags, expected) => {
    expect(dayLabel('2026-10-22', flags)).toBe(expected);
  });
});
