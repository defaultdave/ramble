import type { CancellationTier } from './catalog';
import { PPM } from './pricing';

// The longest tier is 7 days (PRD-46); a year is far past any tier and keeps the arithmetic small.
export const MAX_FULL_REFUND_HOURS = 24 * 365;

const MS_PER_HOUR = 3_600_000;
// Local dates are printed with a four-digit year, so instants stay inside 1970 to 9999.
const MIN_INSTANT_MS = 0;
const MAX_INSTANT_MS = Date.UTC(9999, 11, 31, 23, 59, 59, 999);
const MAX_TIME_ZONE_LENGTH = 64;
// An IANA name is letters, digits, and `_+-` in up to three parts joined by `/`. A numeric offset such as
// "+05:00", which newer engines accept as a time zone, is not a host's zone and fails the first-letter rule.
const TIME_ZONE_NAME = /^[A-Za-z][A-Za-z0-9_+-]*(?:\/[A-Za-z0-9_+-]+){0,2}$/;

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
    timeZone.length > MAX_TIME_ZONE_LENGTH ||
    !TIME_ZONE_NAME.test(timeZone)
  ) {
    throw new RangeError(
      'Time zone must be an IANA name such as America/New_York',
    );
  }
  try {
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
  } catch {
    throw new RangeError(
      'Time zone must be an IANA name such as America/New_York',
    );
  }
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
 * TODO(U-047a): first caller, the `free_cancel_until` snapshot written with the order.
 */
export function cancellationWindow(
  tier: Pick<CancellationTier, 'fullRefundHoursBefore'>,
  startsAt: Date,
  now: Date,
  timeZone: string,
): CancellationWindow {
  const hours = tier.fullRefundHoursBefore;
  if (
    !Number.isSafeInteger(hours) ||
    hours < 0 ||
    hours > MAX_FULL_REFUND_HOURS
  ) {
    throw new RangeError(
      `Full refund hours must be an integer from 0 to ${String(MAX_FULL_REFUND_HOURS)}, got ${String(hours)}`,
    );
  }
  requireInstant(startsAt, 'Start time');
  requireInstant(now, 'Now');

  const freeCancelUntil = new Date(startsAt.getTime() - hours * MS_PER_HOUR);
  requireInstant(freeCancelUntil, 'Free cancel deadline');
  const isFree = now.getTime() <= freeCancelUntil.getTime();
  return {
    freeCancelUntil,
    freeCancelUntilLocal: localDeadline(freeCancelUntil, timeZone),
    isFree,
    refundPpm: isFree ? PPM : 0,
  };
}
