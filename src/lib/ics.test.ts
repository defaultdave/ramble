import { describe, expect, it } from 'vitest';
import {
  basicUtc,
  buildIcs,
  calendarLimits,
  escapeIcsText,
  foldIcsLine,
  googleCalendarUrl,
  type CalendarEvent,
} from './ics';

// Behaviours under test, one per decision or risk:
// - the file is a CRLF VCALENDAR with one VEVENT carrying UID, stamp, start, end, and summary in UTC
// - location and description appear only when given
// - the same event gives the same bytes (a retry sends the same file)
// - text is escaped, so a value cannot add a property line
// - a line over 75 octets folds, never inside a multi-byte character, and unfolding restores it
// - an end at or before the start is refused
// - over-long text is cut to its limit
// - the Google link carries the same title, dates, and place

const event: CalendarEvent = {
  uid: 'order-1@ramble.example',
  startsAt: new Date('2026-11-07T19:00:00Z'),
  endsAt: new Date('2026-11-07T21:00:00Z'),
  summary: 'Harbor sunset sail',
  location: 'Pier 40, West Side Highway',
  description: 'Booking RMB-ABC123',
  stampedAt: new Date('2026-10-29T15:30:00Z'),
};

const unfold = (text: string) => text.replaceAll('\r\n ', '');

describe('buildIcs', () => {
  it('writes one event in UTC with CRLF line ends', () => {
    const ics = buildIcs(event);

    expect(ics.startsWith('BEGIN:VCALENDAR\r\nVERSION:2.0\r\n')).toBe(true);
    expect(ics.endsWith('END:VEVENT\r\nEND:VCALENDAR\r\n')).toBe(true);
    expect(ics.match(/BEGIN:VEVENT/g)).toHaveLength(1);
    expect(ics).toContain('UID:order-1@ramble.example\r\n');
    expect(ics).toContain('DTSTAMP:20261029T153000Z\r\n');
    expect(ics).toContain('DTSTART:20261107T190000Z\r\n');
    expect(ics).toContain('DTEND:20261107T210000Z\r\n');
    expect(ics).toContain('SUMMARY:Harbor sunset sail\r\n');
    expect(ics).toContain('LOCATION:Pier 40\\, West Side Highway\r\n');
    expect(ics).toContain('DESCRIPTION:Booking RMB-ABC123\r\n');
    expect(ics.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/);
  });

  it('leaves out a location and a description that are not given', () => {
    const ics = buildIcs({ ...event, location: null, description: null });

    expect(ics).not.toContain('LOCATION');
    expect(ics).not.toContain('DESCRIPTION');
  });

  it('gives the same bytes for the same event', () => {
    expect(buildIcs(event)).toBe(buildIcs({ ...event }));
  });

  it('cannot be made to add a property by the text it carries', () => {
    const ics = buildIcs({
      ...event,
      summary: 'Sail\r\nATTENDEE:mailto:x@example.com',
    });

    expect(ics).not.toMatch(/^ATTENDEE/m);
    expect(ics).toContain('SUMMARY:Sail\\nATTENDEE:mailto:x@example.com');
  });

  it.each([
    ['equal to the start', new Date('2026-11-07T19:00:00Z')],
    ['before the start', new Date('2026-11-07T18:00:00Z')],
  ])('refuses an end %s', (_label, endsAt) => {
    expect(() => buildIcs({ ...event, endsAt })).toThrow(RangeError);
  });

  it('cuts text to its limit', () => {
    const ics = unfold(
      buildIcs({ ...event, summary: 'a'.repeat(calendarLimits.summary + 50) }),
    );

    expect(ics).toContain(`SUMMARY:${'a'.repeat(calendarLimits.summary)}\r\n`);
  });
});

describe('escapeIcsText', () => {
  it.each([
    ['a backslash', 'a\\b', 'a\\\\b'],
    ['a semicolon', 'a;b', 'a\\;b'],
    ['a comma', 'a,b', 'a\\,b'],
    ['a line break', 'a\nb', 'a\\nb'],
    ['a CRLF', 'a\r\nb', 'a\\nb'],
    ['a control character', 'a\u0007b', 'ab'],
  ])('escapes %s', (_label, input, expected) => {
    expect(escapeIcsText(input)).toBe(expected);
  });
});

describe('foldIcsLine', () => {
  it('leaves a short line alone', () => {
    expect(foldIcsLine('SUMMARY:short')).toBe('SUMMARY:short');
  });

  it('folds at 75 octets and unfolds to the original', () => {
    const line = `SUMMARY:${'x'.repeat(200)}`;
    const folded = foldIcsLine(line);
    const pieces = folded.split('\r\n');

    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    }
    expect(unfold(folded)).toBe(line);
  });

  it('never splits a multi-byte character', () => {
    const line = `SUMMARY:${'é'.repeat(100)}${'🙂'.repeat(20)}`;
    const folded = foldIcsLine(line);

    expect(unfold(folded)).toBe(line);
    for (const piece of folded.split('\r\n')) {
      expect(new TextEncoder().encode(piece).length).toBeLessThanOrEqual(75);
    }
  });
});

describe('dates with milliseconds', () => {
  it('writes every date as whole seconds, so each matches the RFC 5545 form', () => {
    const ics = buildIcs({
      ...event,
      startsAt: new Date('2026-11-07T19:00:00.123Z'),
      endsAt: new Date('2026-11-07T21:00:00.999Z'),
      stampedAt: new Date('2026-10-29T15:30:00.456Z'),
    });

    const dates = ics.match(/^(DTSTAMP|DTSTART|DTEND):(.*)$/gm) ?? [];
    expect(dates).toHaveLength(3);
    for (const line of dates) {
      expect(line.split(':')[1]).toMatch(/^\d{8}T\d{6}Z$/);
    }
    expect(ics).toContain('DTSTAMP:20261029T153000Z');
    expect(ics).toContain('DTEND:20261107T210000Z');
  });

  it('cuts milliseconds down, never up', () => {
    expect(basicUtc(new Date('2026-11-07T19:00:59.999Z'))).toBe(
      '20261107T190059Z',
    );
  });
});

describe('basicUtc', () => {
  it('writes an instant without separators or milliseconds', () => {
    expect(basicUtc(new Date('2026-11-07T19:00:00.000Z'))).toBe(
      '20261107T190000Z',
    );
  });
});

describe('googleCalendarUrl', () => {
  it('carries the title, dates, place, and details', () => {
    const url = new URL(googleCalendarUrl(event));

    expect(url.origin + url.pathname).toBe(
      'https://calendar.google.com/calendar/render',
    );
    expect(url.searchParams.get('action')).toBe('TEMPLATE');
    expect(url.searchParams.get('text')).toBe('Harbor sunset sail');
    expect(url.searchParams.get('dates')).toBe(
      '20261107T190000Z/20261107T210000Z',
    );
    expect(url.searchParams.get('location')).toBe('Pier 40, West Side Highway');
    expect(url.searchParams.get('details')).toBe('Booking RMB-ABC123');
  });

  it('leaves out a place and details that are not given', () => {
    const url = new URL(
      googleCalendarUrl({ ...event, location: null, description: null }),
    );

    expect(url.searchParams.has('location')).toBe(false);
    expect(url.searchParams.has('details')).toBe(false);
  });
});
