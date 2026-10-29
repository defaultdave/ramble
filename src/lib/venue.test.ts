import { describe, expect, it } from 'vitest';
import { venueCity, venueTimeZone, venueToday } from './venue';

// Behaviours under test, one per decision, branch or risk:
// - the venue is in New York, and "today" is the New York calendar date
// - that date is right on both sides of New York midnight, in summer and winter time, across the
//   night the clocks go back, and at the end of a year

describe('the venue', () => {
  it('is in New York', () => {
    expect(venueTimeZone).toBe('America/New_York');
    expect(venueCity).toBe('New York');
  });
});

describe('venueToday', () => {
  it.each([
    ['just before New York midnight', '2026-11-03T04:59:00.000Z', '2026-11-02'],
    [
      'at UTC midnight, still the evening before in New York',
      '2026-11-03T00:00:00.000Z',
      '2026-11-02',
    ],
    ['just after New York midnight', '2026-11-03T05:00:00.000Z', '2026-11-03'],
    ['in summer time', '2026-07-01T03:59:00.000Z', '2026-06-30'],
    [
      'on the night the clocks go back',
      '2026-11-01T05:30:00.000Z',
      '2026-11-01',
    ],
    [
      'just before midnight in summer time',
      '2026-10-26T03:59:59Z',
      '2026-10-25',
    ],
    ['midnight in summer time', '2026-10-26T04:00:00Z', '2026-10-26'],
    [
      'just before midnight in winter time',
      '2026-11-02T04:59:59Z',
      '2026-11-01',
    ],
    ['midnight in winter time', '2026-11-02T05:00:00Z', '2026-11-02'],
    ['the end of a year', '2027-01-01T04:59:59Z', '2026-12-31'],
  ])('is the New York date %s', (_name, now, expected) => {
    expect(venueToday(new Date(now))).toBe(expected);
  });
});
