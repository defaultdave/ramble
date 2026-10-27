import {
  CalendarDate,
  CalendarDateTime,
  getDayOfWeek,
  toZoned,
} from '@internationalized/date';
import { z } from 'zod';
import { EntityIdSchema } from './catalog';

export const sessionSources = ['ramble', 'allocation', 'external'] as const;

/** A template generates sessions for Ramble to sell: the host's own capacity or an allocation. */
const templateSources = ['ramble', 'allocation'] as const;

export const sessionStatuses = ['scheduled', 'cancelled', 'completed'] as const;

export const sessionCancelReasons = ['host', 'weather', 'ramble'] as const;

export const maxAllocation = 1000;
export const maxSessionMinutes = 1440;
/** The longest span one generation call covers, so a call writes at most 53 rows per template. */
const maxGenerationDays = 366;
/** How far past `now` a call may generate: a year ahead, which a rolling window of a few months fits well inside. */
const generationHorizonDays = 366;
/**
 * The last date generation may reach. With zone offsets of up to 14 hours and a 24-hour session, a
 * start or end on this date stays before year 10000, so the CHECKs on `starts_at` and `ends_at` hold.
 */
const lastGenerableDate = '9999-12-29';
const earliestClock = Date.UTC(1001, 0, 1);

/** Area/Location, or UTC. The database CHECK on every time zone column spells the same pattern. */
export const ianaZonePattern = String.raw`^[A-Za-z_]+(/[A-Za-z0-9_+-]+)+$|^UTC$`;
export const maxTimeZoneLength = 64;

/** Years 1000 to 9999, so a stored date always reads back as a four-digit year. */
export const firstSessionDate = '1000-01-01';
export const lastSessionDate = '9999-12-31';

const IsoDatePattern = /^[1-9]\d{3}-\d{2}-\d{2}$/;

function isRealIsoDate(value: string): boolean {
  if (!IsoDatePattern.test(value)) return false;
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  return (
    probe.getUTCFullYear() === year &&
    probe.getUTCMonth() === month - 1 &&
    probe.getUTCDate() === day
  );
}

/** A calendar date as YYYY-MM-DD, which orders the same as a string. */
export const IsoDateSchema = z.string().refine(isRealIsoDate, {
  message: 'Expected a calendar date as YYYY-MM-DD',
});

export const TimeZoneSchema = z
  .string()
  .max(maxTimeZoneLength)
  .regex(new RegExp(ianaZonePattern));

/** The names Intl knows. A name that matches the pattern can still be unknown, and fails here. */
export function isKnownTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });
    return true;
  } catch (error) {
    if (error instanceof RangeError) return false;
    throw error;
  }
}

export type HostZone =
  { ok: true; zone: string } | { ok: false; reason: 'invalid_time_zone' };

/** The zone sessions are generated in, from the host's stored value: well formed and known to Intl. */
export function resolveHostZone(stored: unknown): HostZone {
  const parsed = TimeZoneSchema.safeParse(stored);
  return parsed.success && isKnownTimeZone(parsed.data)
    ? { ok: true, zone: parsed.data }
    : { ok: false, reason: 'invalid_time_zone' };
}

const WallTimePattern = /^([01]\d|2[0-3]):[0-5]\d$/;

/** Wall-clock time in the host's zone, as the database stores it: hours, minutes, and zero seconds. */
const StoredWallTimeSchema = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d:00$/);

const WallTimeInputSchema = z
  .string()
  .regex(WallTimePattern)
  .transform((value) => `${value}:00`);

const AllocationSchema = z.int().min(0).max(maxAllocation);

export const SessionTemplateInputSchema = z.object({
  experienceId: EntityIdSchema,
  /** 0 is Sunday. */
  weekday: z.int().min(0).max(6),
  /** HH:MM in the host's time zone. */
  startTime: WallTimeInputSchema,
  durationMinutes: z.int().min(1).max(maxSessionMinutes),
  allocation: AllocationSchema,
  source: z.enum(templateSources),
});
export type SessionTemplateInput = z.input<typeof SessionTemplateInputSchema>;

export const SessionTemplateSchema = z.object({
  id: EntityIdSchema,
  experienceId: EntityIdSchema,
  weekday: z.int().min(0).max(6),
  startTime: StoredWallTimeSchema,
  durationMinutes: z.int().min(1).max(maxSessionMinutes),
  allocation: AllocationSchema,
  source: z.enum(templateSources),
  createdAt: z.date(),
});
export type SessionTemplate = z.infer<typeof SessionTemplateSchema>;

export const SessionSchema = z.object({
  id: EntityIdSchema,
  experienceId: EntityIdSchema,
  templateId: EntityIdSchema.nullable(),
  localDate: IsoDateSchema.nullable(),
  startsAt: z.date(),
  endsAt: z.date(),
  timeZone: TimeZoneSchema,
  allocation: AllocationSchema,
  seatsSold: z.int().min(0),
  status: z.enum(sessionStatuses),
  source: z.enum(sessionSources),
  cancelReason: z.enum(sessionCancelReasons).nullable(),
  version: z.int().min(1),
});
export type Session = z.infer<typeof SessionSchema>;

export type Occurrence = {
  /** The date on the host's wall calendar. It names the occurrence even if the zone's rules change. */
  localDate: string;
  startsAt: Date;
  endsAt: Date;
};

type Recurrence = Pick<
  SessionTemplate,
  'weekday' | 'startTime' | 'durationMinutes'
>;

/** How many dates a range covers, both ends included. Both must be real dates. */
function daysInRange(fromDate: string, toDate: string): number {
  const utc = (value: string) => {
    const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
    return Date.UTC(year, month - 1, day);
  };
  return Math.round((utc(toDate) - utc(fromDate)) / 86_400_000) + 1;
}

function parseLocalDate(value: string): CalendarDate {
  const [year = 0, month = 0, day = 0] = value.split('-').map(Number);
  return new CalendarDate(year, month, day);
}

/**
 * Every date from `fromDate` to `toDate`, both included, that falls on the template's weekday,
 * with its start and end as instants. The wall time holds across daylight saving. A time the zone
 * skips (the spring-forward hour) starts after the gap, and a time it repeats (the fall-back hour)
 * starts at the first of the two. The end is the start plus the duration in elapsed minutes.
 * The span is limited to `maxGenerationDays`, and a longer one throws.
 */
export function occurrencesBetween(
  recurrence: Recurrence,
  timeZone: string,
  fromDate: string,
  toDate: string,
): Occurrence[] {
  if (!isRealIsoDate(fromDate) || !isRealIsoDate(toDate)) {
    throw new RangeError('Expected calendar dates as YYYY-MM-DD');
  }
  const days = daysInRange(fromDate, toDate);
  if (days < 1) return [];
  if (days > maxGenerationDays) {
    throw new RangeError(
      `A range covers at most ${String(maxGenerationDays)} days`,
    );
  }
  const first = parseLocalDate(fromDate);
  const [hour = 0, minute = 0] = recurrence.startTime.split(':').map(Number);
  const daysToFirst =
    (recurrence.weekday - getDayOfWeek(first, 'en-US') + 7) % 7;
  // Counted from the range, never by comparing dates: adding days clamps at year 9999, so a loop
  // that waits for a date to pass the end of the range would not finish there.
  const weeks =
    daysToFirst < days ? Math.floor((days - 1 - daysToFirst) / 7) + 1 : 0;
  const occurrences: Occurrence[] = [];
  for (let week = 0; week < weeks; week += 1) {
    const date = first.add({ days: daysToFirst + 7 * week });
    const start = toZoned(
      new CalendarDateTime(date.year, date.month, date.day, hour, minute),
      timeZone,
      'compatible',
    ).toDate();
    occurrences.push({
      localDate: date.toString(),
      startsAt: start,
      endsAt: new Date(start.getTime() + recurrence.durationMinutes * 60_000),
    });
  }
  return occurrences;
}

export const GenerateSessionsInputSchema = z
  .object({
    templateId: EntityIdSchema,
    fromDate: IsoDateSchema,
    toDate: IsoDateSchema,
  })
  .refine(
    ({ fromDate, toDate }) => {
      const days = daysInRange(fromDate, toDate);
      return days >= 1 && days <= maxGenerationDays;
    },
    {
      path: ['toDate'],
      message: `The range runs forward and covers at most ${String(maxGenerationDays)} days`,
    },
  );
export type GenerateSessionsInput = z.input<typeof GenerateSessionsInputSchema>;

export const UpdateSessionAllocationInputSchema = z.object({
  sessionId: EntityIdSchema,
  allocation: AllocationSchema,
  /** The version the editor read. A newer one means someone else edited first. */
  expectedVersion: z.int().min(1),
});
export type UpdateSessionAllocationInput = z.input<
  typeof UpdateSessionAllocationInputSchema
>;

export type AllocationCheck =
  { ok: true } | { ok: false; reason: 'below_seats_sold'; seatsSold: number };

/** Capacity may equal the seats already sold, never go under them. */
export function checkAllocationChange(
  seatsSold: number,
  allocation: number,
): AllocationCheck {
  return allocation < seatsSold
    ? { ok: false, reason: 'below_seats_sold', seatsSold }
    : { ok: true };
}

export type EditableCheck =
  { ok: true } | { ok: false; reason: 'not_scheduled' };

/** Only a scheduled session takes holds (design doc 4.2.2), so only a scheduled one has its capacity edited. */
export function checkAllocationEditable(
  status: (typeof sessionStatuses)[number],
): EditableCheck {
  return status === 'scheduled'
    ? { ok: true }
    : { ok: false, reason: 'not_scheduled' };
}

export type VersionCheck =
  { ok: true } | { ok: false; reason: 'version_conflict' };

/** An edit stands only if the editor read the version the row has now. */
export function checkExpectedVersion(
  current: number,
  expected: number,
): VersionCheck {
  return current === expected
    ? { ok: true }
    : { ok: false, reason: 'version_conflict' };
}

/**
 * An allocation is set up and changed by ops (PRD-42), so a session or template with that source is
 * staff-only. Ramble-sourced capacity belongs to the host (PRD-41), and ops may also edit it.
 */
export function requiresStaff(source: (typeof sessionSources)[number]) {
  return source !== 'ramble';
}

/**
 * The latest date a call made at `now` may generate for: `now` plus a year in UTC, never past
 * `lastGenerableDate`. A zone ahead of UTC can reach one day past it on the host's calendar.
 * Dates before `now` are skipped, so a start can never fall before year 1000; a `now` before year
 * 1001 or not a valid date throws, so that guarantee cannot be lost to a bad clock.
 */
export function generationHorizon(now: Date): string {
  if (!(now.getTime() >= earliestClock)) {
    throw new RangeError(
      'The clock is outside the years sessions are kept for',
    );
  }
  const limit = Date.UTC(9999, 11, 29);
  const reach = now.getTime() + generationHorizonDays * 86_400_000;
  if (reach >= limit) return lastGenerableDate;
  return new Date(reach).toISOString().slice(0, 10);
}

/** Whether `toDate` reaches past what a call made at `now` may generate for. */
export function isBeyondHorizon(toDate: string, now: Date): boolean {
  return toDate > generationHorizon(now);
}

export type UpcomingSplit = { upcoming: Occurrence[]; inThePast: number };

/** Occurrences that start after `now`, and how many do not. A start equal to `now` is past. */
export function splitUpcoming(
  occurrences: readonly Occurrence[],
  now: Date,
): UpcomingSplit {
  const upcoming = occurrences.filter(
    (occurrence) => occurrence.startsAt.getTime() > now.getTime(),
  );
  return { upcoming, inThePast: occurrences.length - upcoming.length };
}

/** Of the dates a call tried to write, how many already had a session. */
export function countAlreadyExisted(attempted: number, inserted: number) {
  return attempted - inserted;
}
