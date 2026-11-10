import { MAX_FULL_REFUND_HOURS, type CancellationTier } from './catalog';
import { isSafeIntegerInRange, requireIntegerInRange } from './integers';
import { PPM } from './pricing';
import { isKnownTimeZone, TimeZoneSchema } from './sessions';
import { msPerHour } from './time';

export { MAX_FULL_REFUND_HOURS };

// Local dates are printed with a four-digit year, so instants stay inside 1970 to 9999.
const MIN_INSTANT_MS = 0;
const MAX_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

type LocalDeadline = {
  /** `YYYY-MM-DD` in the host's time zone. */
  date: string;
  /** `HH:mm` on a 24-hour clock, truncated to the minute so it never reads later than the deadline. */
  time: string;
  /** The zone's offset from UTC at that instant, `-05:00`; it tells a repeated hour's two passes apart. */
  offset: string;
};

export type CancellationWindow = {
  /** The last instant a guest may cancel for a full refund. */
  freeCancelUntil: Date;
  freeCancelUntilLocal: LocalDeadline;
  /** True at `now` up to and including the deadline. */
  isFree: boolean;
  /** Share of what remains refunded if cancelled at `now`, in parts per million: all or nothing. */
  refundPpm: number;
};

function requireInstant(instant: Date, what: string): void {
  const ms = instant.getTime();
  if (!Number.isFinite(ms) || ms < MIN_INSTANT_MS || ms > MAX_INSTANT_MS) {
    throw new RangeError(`${what} must be a date from 1970 to 9999`);
  }
}

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  if (
    !TimeZoneSchema.safeParse(timeZone).success ||
    !isKnownTimeZone(timeZone)
  ) {
    throw new RangeError(
      'Time zone must be an IANA name such as America/New_York',
    );
  }
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    timeZoneName: 'longOffset',
  });
}

function localDeadline(instant: Date, timeZone: string): LocalDeadline {
  const parts = new Map<string, string>();
  for (const part of formatterFor(timeZone).formatToParts(instant)) {
    parts.set(part.type, part.value);
  }
  const year = (parts.get('year') ?? '').padStart(4, '0');
  // longOffset prints "GMT-05:00", or a bare "GMT" at UTC.
  const rawOffset = (parts.get('timeZoneName') ?? '').replace('GMT', '');
  return {
    date: `${year}-${parts.get('month') ?? ''}-${parts.get('day') ?? ''}`,
    time: `${parts.get('hour') ?? ''}:${parts.get('minute') ?? ''}`,
    offset: rawOffset === '' ? '+00:00' : rawOffset.replace('−', '-'),
  };
}

/** Free up to and including the deadline: the one place that says where "up to 24 hours before" ends. */
export function isWithinFreeWindow(freeCancelUntil: Date, now: Date): boolean {
  return now.getTime() <= freeCancelUntil.getTime();
}

/**
 * When a booking stops being free to cancel, and what cancelling at `now` refunds (PRD-10, PRD-46).
 * The deadline is `fullRefundHoursBefore` elapsed hours before `startsAt`, so across a daylight
 * saving change the wall clock moves by an hour but the guest still gets the full tier: 24 hours
 * before a 10:00 session the morning after clocks go forward is 09:00, not 10:00, the day before.
 * That also means a deadline is always a real instant, never inside a skipped hour, and the local
 * form carries its offset so a repeated hour reads two ways apart. Cancelling at the deadline is
 * still free ("up to 24 hours before").
 *
 * The tier gives a full refund before its deadline and none after; a part-way refund would
 * return a fraction between 0 and 1_000_000. Bad input is refused: a tier outside 0 to a year,
 * a date that is not a real time, or a time zone that is not an IANA name throws a RangeError.
 */
export function cancellationWindow(
  tier: Pick<CancellationTier, 'fullRefundHoursBefore'>,
  startsAt: Date,
  now: Date,
  timeZone: string,
): CancellationWindow {
  const hours = tier.fullRefundHoursBefore;
  requireIntegerInRange(hours, 0, MAX_FULL_REFUND_HOURS, 'Full refund hours');
  requireInstant(startsAt, 'Start time');
  requireInstant(now, 'Now');

  const freeCancelUntil = new Date(startsAt.getTime() - hours * msPerHour);
  requireInstant(freeCancelUntil, 'Free cancel deadline');
  const isFree = isWithinFreeWindow(freeCancelUntil, now);
  return {
    freeCancelUntil,
    freeCancelUntilLocal: localDeadline(freeCancelUntil, timeZone),
    isFree,
    refundPpm: isFree ? PPM : 0,
  };
}

/** A count of hours in words: "1 hour", "24 hours". */
export function hoursLabel(hours: number): string {
  return `${String(hours)} ${hours === 1 ? 'hour' : 'hours'}`;
}

/**
 * How long before the start a guest can still cancel, in the tier's own words: whole days from two
 * up, hours otherwise ("24 hours" stays hours, as the design shows it).
 */
function windowLabel(hours: number): string {
  const day = 24;
  return hours >= 2 * day && hours % day === 0
    ? `${String(hours / day)} days`
    : hoursLabel(hours);
}

/**
 * What the page says about cancelling, from the experience's tier (PRD-10, PRD-46). It is stated
 * before any date is chosen, so it names the window; the deadline for one session comes from
 * `cancellationWindow` when a session is picked. A tier outside 0 to a year is refused, as there.
 */
export function cancellationTerms(
  tier: Pick<CancellationTier, 'fullRefundHoursBefore'>,
): { fact: string; detail: string } {
  const hours = tier.fullRefundHoursBefore;
  if (!isSafeIntegerInRange(hours, 0, MAX_FULL_REFUND_HOURS)) {
    throw new RangeError('The cancellation window is out of range');
  }
  const refunded =
    'If the host or the weather cancels, you get everything back.';
  if (hours === 0) {
    return {
      fact: 'Free cancellation until it starts',
      detail: `Free cancellation until the experience starts. ${refunded}`,
    };
  }
  const window = windowLabel(hours);
  return {
    fact: `Free cancellation up to ${window} before`,
    detail: `Free cancellation up to ${window} before start. After that, no refund. ${refunded}`,
  };
}
