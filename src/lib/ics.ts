// An iCalendar file (RFC 5545) for one booking, and the link that adds the same event to Google
// Calendar. Both are built from the event alone, so a retried email sends the same bytes.

export type CalendarEvent = {
  /** Stable for the booking, so a calendar updates the event instead of adding a second. */
  uid: string;
  startsAt: Date;
  endsAt: Date;
  summary: string;
  location: string | null;
  description: string | null;
  /** DTSTAMP: when the file was made. A retry passes the same instant. */
  stampedAt: Date;
};

export const calendarLimits = {
  uid: 200,
  summary: 200,
  location: 300,
  description: 1000,
} as const;

const lineLimitOctets = 75;
const encoder = new TextEncoder();

/** `20261107T190000Z`: the UTC basic form both iCalendar and Google Calendar read. */
export function basicUtc(instant: Date): string {
  return instant.toISOString().replace(/[-:]/g, '').replace('.000', '');
}

function clip(text: string, max: number): string {
  return Array.from(text).slice(0, max).join('');
}

/** Backslash, semicolon, comma, and line breaks are escaped; other control characters are dropped. */
export function escapeIcsText(text: string): string {
  return text
    .replaceAll(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
    .replaceAll('\\', '\\\\')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,')
    .replaceAll(/\r\n|\r|\n/g, '\\n');
}

/** Folds a line at 75 octets, never inside a character; each continuation starts with one space. */
export function foldIcsLine(line: string): string {
  const parts: string[] = [];
  let current = '';
  let octets = 0;
  for (const character of line) {
    const size = encoder.encode(character).length;
    const limit = parts.length === 0 ? lineLimitOctets : lineLimitOctets - 1;
    if (octets + size > limit) {
      parts.push(current);
      current = '';
      octets = 0;
    }
    current += character;
    octets += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

/** The event as a `.ics` file: CRLF lines, UTC times, text escaped, long lines folded. */
export function buildIcs(event: CalendarEvent): string {
  if (!(event.endsAt.getTime() > event.startsAt.getTime())) {
    throw new RangeError('A calendar event must end after it starts');
  }
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Ramble//Bookings//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeIcsText(clip(event.uid, calendarLimits.uid))}`,
    `DTSTAMP:${basicUtc(event.stampedAt)}`,
    `DTSTART:${basicUtc(event.startsAt)}`,
    `DTEND:${basicUtc(event.endsAt)}`,
    `SUMMARY:${escapeIcsText(clip(event.summary, calendarLimits.summary))}`,
    ...(event.location
      ? [
          `LOCATION:${escapeIcsText(clip(event.location, calendarLimits.location))}`,
        ]
      : []),
    ...(event.description
      ? [
          `DESCRIPTION:${escapeIcsText(clip(event.description, calendarLimits.description))}`,
        ]
      : []),
    'STATUS:CONFIRMED',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return `${lines.map(foldIcsLine).join('\r\n')}\r\n`;
}

/** A Google Calendar "add event" link for the same event. */
export function googleCalendarUrl(event: CalendarEvent): string {
  const url = new URL('https://calendar.google.com/calendar/render');
  url.searchParams.set('action', 'TEMPLATE');
  url.searchParams.set('text', clip(event.summary, calendarLimits.summary));
  url.searchParams.set(
    'dates',
    `${basicUtc(event.startsAt)}/${basicUtc(event.endsAt)}`,
  );
  if (event.location) {
    url.searchParams.set(
      'location',
      clip(event.location, calendarLimits.location),
    );
  }
  if (event.description) {
    url.searchParams.set(
      'details',
      clip(event.description, calendarLimits.description),
    );
  }
  return url.toString();
}
