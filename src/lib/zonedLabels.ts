// An instant written as the host's wall clock. The zone is the session's own, so a guest in another
// city reads the time the host will stand there. A zone that is not an IANA name throws a RangeError.

type LabelKind =
  'day' | 'time' | 'deadline' | 'shortDay' | 'clock' | 'deadlineNoZone';

const options: Record<LabelKind, Intl.DateTimeFormatOptions> = {
  day: { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' },
  time: { hour: 'numeric', minute: '2-digit', timeZoneName: 'short' },
  deadline: {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  },
  shortDay: { weekday: 'short', month: 'short', day: 'numeric' },
  clock: { hour: 'numeric', minute: '2-digit' },
  deadlineNoZone: {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  },
};

const formats = new Map<string, Intl.DateTimeFormat>();

function formatter(kind: LabelKind, timeZone: string): Intl.DateTimeFormat {
  const key = `${kind}|${timeZone}`;
  const cached = formats.get(key);
  if (cached) return cached;
  const made = new Intl.DateTimeFormat('en-US', {
    ...options[kind],
    timeZone,
  });
  formats.set(key, made);
  return made;
}

// Newer engines put a narrow no-break space before AM and PM; mail clients and plain text show it as a gap.
function plain(text: string): string {
  return text.replaceAll(' ', ' ');
}

/** "Saturday, November 7, 2026". */
export function zonedDayLabel(instant: Date, timeZone: string): string {
  return plain(formatter('day', timeZone).format(instant));
}

/** "2:00 PM EST". */
export function zonedTimeLabel(instant: Date, timeZone: string): string {
  return plain(formatter('time', timeZone).format(instant));
}

/** "Sat, Nov 7, 2:00 PM EST", for a deadline in running text. */
export function zonedDeadlineLabel(instant: Date, timeZone: string): string {
  return plain(formatter('deadline', timeZone).format(instant));
}

/** "Sat, Nov 7": the day in the zone, for a summary line that is not about a deadline. */
export function zonedShortDayLabel(instant: Date, timeZone: string): string {
  return plain(formatter('shortDay', timeZone).format(instant));
}

/** "2:00 PM": the clock time in the zone, without its name, where the page already says where it is. */
export function zonedClockLabel(instant: Date, timeZone: string): string {
  return plain(formatter('clock', timeZone).format(instant));
}

/** "Fri, Nov 6, 2:00 PM": a deadline in the zone, without the zone's name. */
export function zonedDeadlineNoZoneLabel(
  instant: Date,
  timeZone: string,
): string {
  return plain(formatter('deadlineNoZone', timeZone).format(instant));
}
