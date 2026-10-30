export type DayFlags = {
  today: boolean;
  selected: boolean;
  unavailable: boolean;
};

export type DayContext = {
  today: string;
  value: string | null;
  availableDates: readonly string[];
};

// Dates are ISO calendar dates (YYYY-MM-DD), which order the same as strings.
export function isDateAvailable(
  date: string,
  today: string,
  availableDates: readonly string[],
): boolean {
  return date >= today && availableDates.includes(date);
}

/** The date whose month the calendar shows: the chosen date, else the first date on offer, else today. */
export function visibleDate({
  today,
  value,
  availableDates,
}: DayContext): string {
  if (value !== null) return value;
  const offered = availableDates.filter((date) => date >= today).sort();
  return offered[0] ?? today;
}

export function dayFlags(
  date: string,
  { today, value, availableDates }: DayContext,
): DayFlags {
  return {
    today: date === today,
    selected: date === value,
    unavailable: !isDateAvailable(date, today, availableDates),
  };
}

const longDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'long',
  month: 'long',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
});

// The label comes from the caller's `today`, not the system clock, so what a
// screen reader announces always matches the ring that sighted users see.
export function dayLabel(date: string, flags: DayFlags): string {
  let label = longDate.format(new Date(`${date}T00:00:00Z`));
  if (flags.today) label = `Today, ${label}`;
  if (flags.selected) label += ' selected';
  if (flags.unavailable) label += ', unavailable';
  return label;
}
