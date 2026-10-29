import { calendarDateFormat } from './time';

/** Every host is in New York today, and "today" on a guest page means a New York calendar date. */
export const venueTimeZone = 'America/New_York';

/** The city every venue is in, as a Maps search names it. */
export const venueCity = 'New York';

const venueDate = calendarDateFormat(venueTimeZone);

/** The calendar date in New York at `now`, as YYYY-MM-DD. */
export function venueToday(now: Date): string {
  return venueDate.format(now);
}
