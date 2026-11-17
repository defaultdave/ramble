import { calendarDateFormat, msPerDay } from './time';

/** The instants a calendar day in a zone runs over: from its first instant up to, not including, the next day's first. */
export type DayWindow = { from: Date; to: Date };

/** Zones run from UTC-12 to UTC+14, so a day's first instant is within this far of its UTC midnight. */
const searchPadMs = 15 * 3_600_000;

/** The first instant at which `zone`'s calendar date is `date` or later. The date only grows with the instant, so a binary search finds it, across a daylight saving change too. */
function firstInstantOn(date: string, zone: string): Date {
  const format = calendarDateFormat(zone);
  const utcMidnight = Date.parse(`${date}T00:00:00Z`);
  let low = utcMidnight - searchPadMs;
  let high = utcMidnight + searchPadMs;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (format.format(new Date(mid)) >= date) high = mid;
    else low = mid + 1;
  }
  return new Date(low);
}

/** The calendar day in `zone` that contains `now`, as the instants it runs over. A day with a daylight saving change is 23 or 25 hours long. */
export function zonedDayWindow(now: Date, zone: string): DayWindow {
  const today = calendarDateFormat(zone).format(now);
  const tomorrow = new Date(Date.parse(`${today}T00:00:00Z`) + msPerDay)
    .toISOString()
    .slice(0, 10);
  return {
    from: firstInstantOn(today, zone),
    to: firstInstantOn(tomorrow, zone),
  };
}
