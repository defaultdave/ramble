import { isSafeIntegerInRange } from '../integers';

export { formatMoney } from '../money';
/** @public Re-exported so a page's copy and its date labels come from one import; phase 1 starts using them. */
export {
  zonedClockLabel,
  zonedDayLabel,
  zonedDeadlineLabel,
  zonedDeadlineNoZoneLabel,
  zonedShortDayLabel,
  zonedTimeLabel,
} from '../zonedLabels';

/** "1 adult", "2 adults", "2 children": a count and its noun, the plural `s` unless one is given. */
export function count(n: number, noun: string, plural = `${noun}s`): string {
  return `${String(n)} ${n === 1 ? noun : plural}`;
}

export function guestsLabel(n: number): string {
  if (!isSafeIntegerInRange(n, 1)) {
    throw new RangeError(`Guests must be a positive integer, got ${String(n)}`);
  }
  return count(n, 'guest');
}

/** "A, B, and C": names joined the way the site words a list of choices. */
export const andList = new Intl.ListFormat('en-US', {
  style: 'long',
  type: 'conjunction',
});
