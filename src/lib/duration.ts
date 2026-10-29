/**
 * "2 hr", "2.5 hr", "45 min", "2 hr 15 min". A no-break space joins each number to its unit, so a
 * narrow card never leaves "2" at the end of one line and "hr" at the start of the next.
 */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${String(minutes)}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${String(hours)}\u00a0hr`;
  if (rest === 30) return `${String(hours)}.5\u00a0hr`;
  return `${String(hours)}\u00a0hr ${String(rest)}\u00a0min`;
}
