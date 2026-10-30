import { describe, expect, it } from 'vitest';
import {
  zonedDayLabel,
  zonedDeadlineLabel,
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

  it("writes the short day on the zone's calendar", () => {
    const lateNight = new Date('2026-11-08T03:30:00Z');
    expect(zonedShortDayLabel(winter, 'America/New_York')).toBe('Sat, Nov 7');
    expect(zonedShortDayLabel(lateNight, 'America/New_York')).toBe(
      'Sat, Nov 7',
    );
    expect(zonedShortDayLabel(lateNight, 'Asia/Tokyo')).toBe('Sun, Nov 8');
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
