export const msPerMinute = 60_000;
export const msPerDay = 86_400_000;

/**
 * `now` cut down to the minute, as an ISO string. A cached read takes it as an argument, so two
 * guests inside the same minute share one cache entry instead of each making their own.
 */
export function minuteAsOf(now: Date): string {
  const cut = Math.floor(now.getTime() / msPerMinute) * msPerMinute;
  return new Date(cut).toISOString();
}

/** A formatter that writes an instant as the calendar date (YYYY-MM-DD) it falls on in `zone`. Build it once per zone and reuse it. */
export function calendarDateFormat(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

/** The UTC calendar date of `date`, as YYYY-MM-DD. */
export function isoDateOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}
