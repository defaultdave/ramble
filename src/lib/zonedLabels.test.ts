import { describe, expect, it } from 'vitest';
import {
  zonedDayLabel,
  zonedClockLabel,
  zonedDeadlineLabel,
  zonedDeadlineNoZoneLabel,
  zonedShortDayLabel,
  zonedTimeLabel,
} from './zonedLabels';

// Behaviours under test, one per decision or risk:
// - the day, time, and deadline read in the zone given, not the server's
// - the zone abbreviation follows daylight saving
// - a day that differs between two zones is the zone's day
// - the narrow no-break space before PM is a plain space
// - a zone that is not an IANA name throws

const winter = new Date('2026-11-07T19:00:00Z');
const summer = new Date('2026-07-07T18:00:00Z');

describe('zoned labels', () => {
  it('writes the day, time, and deadline on the zone clock', () => {
    expect(zonedDayLabel(winter, 'America/New_York')).toBe(
      'Saturday, November 7, 2026',
    );
    expect(zonedTimeLabel(winter, 'America/New_York')).toBe('2:00 PM EST');
    expect(zonedDeadlineLabel(winter, 'America/New_York')).toBe(
      'Sat, Nov 7, 2:00 PM EST',
    );
  });

  it('follows daylight saving', () => {
    expect(zonedTimeLabel(summer, 'America/New_York')).toBe('2:00 PM EDT');
  });

  it('gives the zone its own day', () => {
    const lateNight = new Date('2026-11-08T03:30:00Z');
    expect(zonedDayLabel(lateNight, 'America/New_York')).toBe(
      'Saturday, November 7, 2026',
    );
    expect(zonedDayLabel(lateNight, 'Asia/Tokyo')).toBe(
      'Sunday, November 8, 2026',
    );
  });

  it('uses no narrow no-break space', () => {
    expect(zonedTimeLabel(winter, 'America/New_York')).not.toContain(' ');
  });

  it('refuses a zone that is not an IANA name', () => {
    expect(() => zonedDayLabel(winter, 'Not/AZone')).toThrow(RangeError);
  });
});

describe('zoned labels without the zone name', () => {
  const start = new Date('2026-10-24T21:30:00Z');

  it.each([
    ['America/New_York', 'Sat, Oct 24', '5:30 PM', 'Sat, Oct 24, 5:30 PM'],
    ['Asia/Tokyo', 'Sun, Oct 25', '6:30 AM', 'Sun, Oct 25, 6:30 AM'],
    ['UTC', 'Sat, Oct 24', '9:30 PM', 'Sat, Oct 24, 9:30 PM'],
  ])(
    'writes the day, the clock, and the deadline in %s',
    (zone, day, clock, deadline) => {
      expect(zonedShortDayLabel(start, zone)).toBe(day);
      expect(zonedClockLabel(start, zone)).toBe(clock);
      expect(zonedDeadlineNoZoneLabel(start, zone)).toBe(deadline);
    },
  );

  it('uses a plain space before PM', () => {
    expect(zonedClockLabel(start, 'America/New_York')).not.toContain('\u202f');
  });

  it('refuses a zone it does not know', () => {
    expect(() => zonedShortDayLabel(start, 'Not/AZone')).toThrow(RangeError);
  });
});
