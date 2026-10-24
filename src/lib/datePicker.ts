export type DayFlags = { today: boolean; unavailable: boolean };

// Dates are ISO calendar dates (YYYY-MM-DD), which order the same as strings.
export function isDateAvailable(
  date: string,
  today: string,
  availableDates: readonly string[],
): boolean {
  return date >= today && availableDates.includes(date);
}

export function dayFlags(
  date: string,
  today: string,
  availableDates: readonly string[],
): DayFlags {
  return {
    today: date === today,
    unavailable: !isDateAvailable(date, today, availableDates),
  };
}
