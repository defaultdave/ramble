import {
  CalendarDate,
  CalendarDateTime,
  getDayOfWeek,
  toZoned,
} from '@internationalized/date';
import { z } from 'zod';
import { EntityIdSchema, priceKinds } from './catalog';
import { MAX_UNIT_PRICE_MINOR } from './pricing';
import { calendarDateFormat, isoDateOf, msPerDay } from './time';

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

/** 0 is Sunday. */
const WeekdaySchema = z.int().min(0).max(6);

export const SessionTemplateInputSchema = z.object({
  experienceId: EntityIdSchema,
  weekday: WeekdaySchema,
  /** HH:MM in the host's time zone. */
  startTime: WallTimeInputSchema,
  durationMinutes: z.int().min(1).max(maxSessionMinutes),
  allocation: AllocationSchema,
  source: z.enum(templateSources),
});
export type SessionTemplateInput = z.input<typeof SessionTemplateInputSchema>;

/** One start time, length, seat cap and source set up on several weekdays at once: one template per weekday. */
export const AddSlotsInputSchema = SessionTemplateInputSchema.omit({
  weekday: true,
}).extend({
  weekdays: z
    .array(WeekdaySchema)
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length),
});
export type AddSlotsInput = z.input<typeof AddSlotsInputSchema>;

export const UpdateTemplateAllocationInputSchema = z.object({
  templateId: EntityIdSchema,
  allocation: AllocationSchema,
});
export type UpdateTemplateAllocationInput = z.input<
  typeof UpdateTemplateAllocationInputSchema
>;

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
  return Math.round((utc(toDate) - utc(fromDate)) / msPerDay) + 1;
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
  | { ok: true }
  | {
      ok: false;
      reason: 'below_sold_and_held';
      seatsSold: number;
      heldSeats: number;
    };

/**
 * Capacity may equal the seats already sold plus the seats in open holds, never go under them
 * (PRD-41). `heldSeats` is the open holds' seats at the moment the row is locked.
 */
export function checkAllocationChange(
  seatsSold: number,
  heldSeats: number,
  allocation: number,
): AllocationCheck {
  return allocation < seatsSold + heldSeats
    ? { ok: false, reason: 'below_sold_and_held', seatsSold, heldSeats }
    : { ok: true };
}

type FollowingSession = {
  id: string;
  allocation: number;
  seatsSold: number;
  heldSeats: number;
};

export type TemplateSeatPlan =
  | { ok: true; followIds: string[] }
  | { ok: false; reason: 'below_sold_and_held'; booked: number };

/**
 * What a new seat cap on a template does to its upcoming sessions. A session whose capacity still
 * equals the template's old cap follows the template; one with another number was set by hand and
 * keeps it. The change is refused, whole, when it would put any following session under the seats
 * sold plus held (PRD-41), and `booked` is the most seats one of them has claimed.
 */
export function planTemplateSeatChange(
  oldAllocation: number,
  newAllocation: number,
  upcoming: readonly FollowingSession[],
): TemplateSeatPlan {
  const following = upcoming.filter(
    (session) => session.allocation === oldAllocation,
  );
  const refused = following.filter(
    (session) =>
      !checkAllocationChange(
        session.seatsSold,
        session.heldSeats,
        newAllocation,
      ).ok,
  );
  if (refused.length > 0) {
    return {
      ok: false,
      reason: 'below_sold_and_held',
      booked: Math.max(
        ...refused.map((session) => session.seatsSold + session.heldSeats),
      ),
    };
  }
  return { ok: true, followIds: following.map((session) => session.id) };
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
  const reach = now.getTime() + generationHorizonDays * msPerDay;
  if (reach >= limit) return lastGenerableDate;
  return isoDateOf(new Date(reach));
}

/** How far ahead of now the rolling job keeps every template's sessions generated. */
const rollingHorizonWeeks = 12;

const lastRollingInstant = Date.UTC(9999, 11, 29);

/**
 * The dates the rolling job asks `generateSessions` for at `now`: from the day before the UTC date
 * of `now` (a host west of UTC can still be on yesterday's date, and a date whose start has passed
 * is skipped anyway) to `rollingHorizonWeeks` ahead, never past `generationHorizon`. The range is
 * the same on every pulse of a day, so a second run finds every date already there.
 */
export function rollingRange(now: Date): { fromDate: string; toDate: string } {
  const horizon = generationHorizon(now);
  const wanted = now.getTime() + rollingHorizonWeeks * 7 * msPerDay;
  return {
    fromDate: isoDateOf(new Date(now.getTime() - msPerDay)),
    toDate:
      wanted >= lastRollingInstant ? horizon : isoDateOf(new Date(wanted)),
  };
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

export const UpdateSessionTimeInputSchema = z.object({
  sessionId: EntityIdSchema,
  /** HH:MM on the session's own date, in the host's time zone. */
  startTime: WallTimeInputSchema,
  durationMinutes: z.int().min(1).max(maxSessionMinutes),
  expectedVersion: z.int().min(1),
});
export type UpdateSessionTimeInput = z.input<
  typeof UpdateSessionTimeInputSchema
>;

export const CancelSessionInputSchema = z.object({
  sessionId: EntityIdSchema,
  expectedVersion: z.int().min(1),
});
export type CancelSessionInput = z.input<typeof CancelSessionInputSchema>;

export const UpdateSessionPriceInputSchema = z.object({
  sessionId: EntityIdSchema,
  kind: z.enum(priceKinds),
  priceMinor: z.int().min(0).max(MAX_UNIT_PRICE_MINOR),
});
export type UpdateSessionPriceInput = z.input<
  typeof UpdateSessionPriceInputSchema
>;

export const AddOneOffSessionInputSchema = z.object({
  experienceId: EntityIdSchema,
  localDate: IsoDateSchema,
  startTime: WallTimeInputSchema,
  durationMinutes: z.int().min(1).max(maxSessionMinutes),
  allocation: AllocationSchema.min(1),
});
export type AddOneOffSessionInput = z.input<typeof AddOneOffSessionInputSchema>;

export type UnbookedCheck =
  | { ok: true }
  | {
      ok: false;
      reason: 'has_bookings' | 'has_holds';
      seatsSold: number;
      heldSeats: number;
    };

/**
 * A session's time moves, or it is cancelled, only while nobody has a claim on it (PRD-41: a change
 * to a booked session runs the cancellation flow, which this does not). An open hold is a guest
 * partway through paying, so it counts as a claim until it lapses.
 */
export function checkUnbooked(
  seatsSold: number,
  heldSeats: number,
): UnbookedCheck {
  if (seatsSold > 0) {
    return { ok: false, reason: 'has_bookings', seatsSold, heldSeats };
  }
  return heldSeats > 0
    ? { ok: false, reason: 'has_holds', seatsSold, heldSeats }
    : { ok: true };
}

/** A session that has started, or starts at this instant, is not edited. */
export function isUpcoming(startsAt: Date, now: Date): boolean {
  return startsAt.getTime() > now.getTime();
}

/**
 * The one occurrence on `localDate` at `startTime` in `timeZone`, for an edit or a one-off date.
 * It reads the date's weekday itself, so the DST rules are the ones the generator applies.
 */
export function occurrenceOn(
  localDate: string,
  startTime: string,
  durationMinutes: number,
  timeZone: string,
): Occurrence {
  const [occurrence] = occurrencesBetween(
    {
      weekday: getDayOfWeek(parseLocalDate(localDate), 'en-US'),
      startTime,
      durationMinutes,
    },
    timeZone,
    localDate,
    localDate,
  );
  if (!occurrence) throw new RangeError('A date has an occurrence on itself');
  return occurrence;
}

/** The date `instant` falls on in `timeZone`, as the session's own calendar names it. */
export function localDateIn(instant: Date, timeZone: string): string {
  return calendarDateFormat(timeZone).format(instant);
}
