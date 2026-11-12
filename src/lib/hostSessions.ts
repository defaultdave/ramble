import { CalendarDateTime, toZoned } from '@internationalized/date';
import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { formatPrice, priceInputTextOrNull, priceMinorFromText } from './money';
import { wholeNumberPattern } from './text';
import {
  IsoDateSchema,
  TimeZoneSchema,
  generationHorizon,
  isUpcoming,
  localDateIn,
  sessionStatuses,
} from './sessions';
import { dateChipLabel, msPerDay, msPerMinute } from './time';
import { zonedTimeLabel } from './zonedLabels';

// The host's week of sessions: which week the address names, what each row lets the host do, and
// how an edit's answer reads. The rules for what may change live in `sessions.ts`.

export const hostSessionsPath = '/host/sessions';

const daysInWeek = 7;
/** How far back a host can look: eight weeks. */
const weeksBack = 8;

/** A calendar date moved by whole days. It is calendar arithmetic, so no zone or DST moves it. */
export function addDays(date: string, days: number): string {
  const moved = new Date(Date.parse(`${date}T00:00:00Z`) + days * msPerDay);
  return moved.toISOString().slice(0, 10);
}

/** The Monday of the week a calendar date falls in. A week is Monday to Sunday. */
export function weekStartOf(date: string): string {
  const day = new Date(`${date}T00:00:00Z`);
  const sinceMonday = (day.getUTCDay() + 6) % daysInWeek;
  return addDays(date, -sinceMonday);
}

/** The first week the host may open (eight weeks back from today's) and the last, which must end inside the generation horizon. */
function weekLimits(today: string, now: Date): { first: string; last: string } {
  return {
    first: addDays(weekStartOf(today), -weeksBack * daysInWeek),
    last: addDays(weekStartOf(generationHorizon(now)), -daysInWeek),
  };
}

/**
 * The week the address asks for (`?week=` with any date in it), or this week in the host's zone when
 * it names nothing usable or a week outside the limits.
 */
export function resolveWeek(
  raw: string | undefined,
  now: Date,
  timeZone: string,
): string {
  const today = localDateIn(now, timeZone);
  const current = weekStartOf(today);
  const parsed = IsoDateSchema.safeParse(raw);
  if (!parsed.success) return current;
  const week = weekStartOf(parsed.data);
  const { first, last } = weekLimits(today, now);
  return week < first || week > last ? current : week;
}

/** The instants a week covers in `timeZone`: its Monday's midnight up to, not including, the next Monday's. */
export function weekBounds(
  weekStart: string,
  timeZone: string,
): { from: Date; to: Date } {
  const midnight = (date: string) => {
    const [year = 0, month = 0, day = 0] = date.split('-').map(Number);
    return toZoned(
      new CalendarDateTime(year, month, day, 0, 0),
      timeZone,
      'compatible',
    ).toDate();
  };
  return {
    from: midnight(weekStart),
    to: midnight(addDays(weekStart, daysInWeek)),
  };
}

const weekHref = (weekStart: string) => `${hostSessionsPath}?week=${weekStart}`;

/** What the data layer hands over for one session in the week. */
export const HostWeekSessionSchema = z.object({
  id: EntityIdSchema,
  experienceName: z.string().min(1),
  startsAt: z.date(),
  endsAt: z.date(),
  timeZone: TimeZoneSchema,
  allocation: z.int().min(0),
  seatsSold: z.int().min(0),
  status: z.enum(sessionStatuses),
  version: z.int().min(1),
  /** The experience's adult price, which every one of its sessions sells at; null when it has none. */
  adultPriceMinor: z.int().min(0).nullable(),
});
export type HostWeekSession = z.infer<typeof HostWeekSessionSchema>;

export type HostWeekData = {
  hostName: string;
  timeZone: string;
  weekStart: string;
  experiences: readonly { id: string; name: string }[];
  sessions: readonly HostWeekSession[];
};

export type HostWeekRowView = {
  id: string;
  experienceName: string;
  /** "2:00 PM EST". */
  timeLabel: string;
  soldLabel: string;
  statusLabel: string;
  priceLabel: string | null;
  /** The version the editor read, posted back so a second edit cannot overwrite a first unseen. */
  version: number;
  /** HH:MM, and minutes, as the time form starts. */
  startTime: string;
  durationMinutes: number;
  allocation: number;
  /** Dollars as typed, "85" or "12.50"; null when the experience has no adult price. */
  adultPrice: string | null;
  /** A scheduled session that has not started: the only kind whose capacity and price the server will change (a started or cancelled one is refused). */
  editable: boolean;
  /** The same, with no seat sold: its time may change and it may be cancelled. The server also refuses while a guest holds seats mid-payment. */
  movable: boolean;
};

type HostWeekDayView = {
  date: string;
  label: string;
  sessions: readonly HostWeekRowView[];
};

export type HostWeekView = {
  hostName: string;
  /** The host's owner changes the week; read-only staff only look. */
  canEdit: boolean;
  weekStart: string;
  /** "Mon, Nov 9 to Sun, Nov 15". */
  weekLabel: string;
  timeZone: string;
  prevHref: string | null;
  nextHref: string | null;
  /** Null when the week shown is this one. */
  thisWeekHref: string | null;
  days: readonly HostWeekDayView[];
  experiences: readonly { id: string; name: string }[];
};

const statusLabels = {
  scheduled: 'Scheduled',
  cancelled: 'Cancelled',
  completed: 'Completed',
} as const satisfies Record<HostWeekSession['status'], string>;

const wallClock = (instant: Date, timeZone: string) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(instant);

function rowView(session: HostWeekSession, now: Date): HostWeekRowView {
  const editable =
    session.status === 'scheduled' && isUpcoming(session.startsAt, now);
  return {
    id: session.id,
    experienceName: session.experienceName,
    timeLabel: zonedTimeLabel(session.startsAt, session.timeZone),
    soldLabel: `${String(session.seatsSold)} of ${String(session.allocation)} seats sold`,
    statusLabel: statusLabels[session.status],
    priceLabel:
      session.adultPriceMinor === null
        ? null
        : `${formatPrice(session.adultPriceMinor)} adult`,
    version: session.version,
    startTime: wallClock(session.startsAt, session.timeZone),
    durationMinutes: Math.round(
      (session.endsAt.getTime() - session.startsAt.getTime()) / msPerMinute,
    ),
    allocation: session.allocation,
    adultPrice: priceInputTextOrNull(session.adultPriceMinor),
    editable,
    movable: editable && session.seatsSold === 0,
  };
}

/** The week's rows grouped by the day each falls on in its own zone, in the order handed over; a day with no session is left out. */
export function buildHostWeek(
  data: HostWeekData,
  now: Date,
  canEdit: boolean,
): HostWeekView {
  const today = localDateIn(now, data.timeZone);
  const limits = weekLimits(today, now);
  const previous = addDays(data.weekStart, -daysInWeek);
  const next = addDays(data.weekStart, daysInWeek);
  const days: { date: string; sessions: HostWeekRowView[] }[] = [];
  for (const session of data.sessions) {
    const date = localDateIn(session.startsAt, session.timeZone);
    const row = rowView(session, now);
    const last = days.at(-1);
    if (last?.date === date) last.sessions.push(row);
    else days.push({ date, sessions: [row] });
  }
  return {
    hostName: data.hostName,
    canEdit,
    weekStart: data.weekStart,
    weekLabel: `${dateChipLabel(data.weekStart)} to ${dateChipLabel(addDays(data.weekStart, daysInWeek - 1))}`,
    timeZone: data.timeZone,
    prevHref: previous < limits.first ? null : weekHref(previous),
    nextHref: next > limits.last ? null : weekHref(next),
    thisWeekHref:
      data.weekStart === weekStartOf(today) ? null : hostSessionsPath,
    days: days.map(({ date, sessions }) => ({
      date,
      label: dateChipLabel(date),
      sessions,
    })),
    experiences: data.experiences,
  };
}

const hostSessionFieldMessages = {
  allocation: 'Enter a whole number of seats, from 0 to 1000.',
  startTime: 'Enter a start time, like 14:00.',
  durationMinutes: 'Enter the length in minutes, from 1 to 1440.',
  price: 'Enter a price in dollars, like 85 or 12.50.',
  localDate: 'Choose a date.',
  experienceId: 'Choose an experience.',
} as const;

type HostSessionField = keyof typeof hostSessionFieldMessages;

export type HostSessionFieldErrors = Partial<Record<HostSessionField, string>>;

/** What a form's answer is: nothing yet, saved, refused for a reason the host can act on, a field to fix, or a failure on our side. */
export type HostSessionFormState =
  | { status: 'idle' }
  | { status: 'done'; message: string }
  | { status: 'problem'; message: string }
  | { status: 'invalid'; errors: HostSessionFieldErrors }
  | { status: 'failed' };

export const hostSessionFailureMessage =
  'Something went wrong on our side, and nothing was saved. Please try again.';

type Get = (field: string) => unknown;

function text(get: Get, field: string): string {
  const value = get(field);
  return typeof value === 'string' ? value.trim() : '';
}

/** A whole number typed in a field, or undefined for anything else, so the schema names the field. */
function wholeNumber(get: Get, field: string): number | undefined {
  const value = text(get, field);
  return wholeNumberPattern.test(value) ? Number(value) : undefined;
}

/** The values of the session forms as the schemas expect them: a field that is not a number is left undefined. */
export const hostSessionFormValues = {
  capacity: (get: Get) => ({
    sessionId: text(get, 'sessionId'),
    expectedVersion: wholeNumber(get, 'expectedVersion'),
    allocation: wholeNumber(get, 'allocation'),
  }),
  time: (get: Get) => ({
    sessionId: text(get, 'sessionId'),
    expectedVersion: wholeNumber(get, 'expectedVersion'),
    startTime: text(get, 'startTime'),
    durationMinutes: wholeNumber(get, 'durationMinutes'),
  }),
  price: (get: Get) => ({
    sessionId: text(get, 'sessionId'),
    kind: 'adult',
    priceMinor: priceMinorFromText(text(get, 'price')),
  }),
  cancel: (get: Get) => ({
    sessionId: text(get, 'sessionId'),
    expectedVersion: wholeNumber(get, 'expectedVersion'),
  }),
  oneOff: (get: Get) => ({
    experienceId: text(get, 'experienceId'),
    localDate: text(get, 'localDate'),
    startTime: text(get, 'startTime'),
    durationMinutes: wholeNumber(get, 'durationMinutes'),
    allocation: wholeNumber(get, 'allocation'),
  }),
  week: (get: Get) => ({ weekStart: text(get, 'weekStart') }),
};

const fieldOfKey: Record<string, HostSessionField> = {
  allocation: 'allocation',
  startTime: 'startTime',
  durationMinutes: 'durationMinutes',
  priceMinor: 'price',
  localDate: 'localDate',
  experienceId: 'experienceId',
};

/** The form's answer for a refused parse: each field it names with its message. An id or version that is wrong is a stale form, not a field. */
export function hostSessionInvalid(error: z.ZodError): HostSessionFormState {
  const errors: HostSessionFieldErrors = {};
  for (const issue of error.issues) {
    const field = fieldOfKey[String(issue.path[0])];
    if (field) errors[field] = hostSessionFieldMessages[field];
  }
  return Object.keys(errors).length > 0
    ? { status: 'invalid', errors }
    : {
        status: 'problem',
        message: 'This form is out of date. Reload the page and try again.',
      };
}

export type HostSessionProblem =
  | 'session_not_found'
  | 'not_scheduled'
  | 'version_conflict'
  | 'below_sold_and_held'
  | 'has_bookings'
  | 'has_holds'
  | 'in_the_past'
  | 'experience_not_found'
  | 'beyond_horizon'
  | 'invalid_time_zone'
  | 'no_such_price';

const problemMessages = {
  session_not_found: 'That session is no longer there. Reload the page.',
  not_scheduled: 'Only a scheduled session can be changed.',
  version_conflict:
    'This session was changed since you opened it. Reload the page and try again.',
  below_sold_and_held:
    'Capacity cannot go below the seats already booked or being paid for.',
  has_bookings:
    'Seats are booked on this session, so its time cannot change and it cannot be cancelled here.',
  has_holds:
    'A guest is paying for a seat on this session right now. Try again in a few minutes.',
  in_the_past: 'That time has already passed.',
  experience_not_found: 'That experience is no longer there. Reload the page.',
  beyond_horizon: 'That date is too far ahead.',
  invalid_time_zone:
    'Your time zone is not set up correctly. Contact Ramble support.',
  no_such_price: 'That experience has no adult price to change.',
} as const satisfies Record<HostSessionProblem, string>;

export function hostSessionProblem(
  reason: HostSessionProblem,
): HostSessionFormState {
  return { status: 'problem', message: problemMessages[reason] };
}

const countLabel = (count: number, noun: string) =>
  `${String(count)} ${noun}${count === 1 ? '' : 's'}`;

/** What publishing a week did, in words: sessions added, and those that were already there. */
export function publishWeekMessage(result: {
  templates: number;
  created: number;
  alreadyExisted: number;
  inThePast: number;
}): string {
  if (result.templates === 0) {
    return 'You have no weekly slots set up yet, so there is nothing to publish. Ramble can set them up for you.';
  }
  const added =
    result.created === 0
      ? 'No new sessions were needed'
      : `${countLabel(result.created, 'session')} added`;
  const rest = [
    result.alreadyExisted > 0
      ? `${countLabel(result.alreadyExisted, 'session')} already published`
      : null,
    result.inThePast > 0
      ? `${countLabel(result.inThePast, 'date')} already past`
      : null,
  ].filter((part) => part !== null);
  return `${[added, ...rest].join('; ')}.`;
}
