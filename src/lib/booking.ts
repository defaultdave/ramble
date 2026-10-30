import { formatMoney } from './money';
import { guestsLabel } from './orderSummary';

export function perPersonLabel(nextDate: string | undefined): string {
  return nextDate ? `per person · next ${nextDate}` : 'per person';
}

export function chosenPartyLabel(guests: number, totalMinor: number): string {
  return `${guestsLabel(guests)} · ${formatMoney(totalMinor)}`;
}

export function continueLabel(totalMinor: number): string {
  return `Continue · ${formatMoney(totalMinor)}`;
}

/** The line under Continue. The length is not stated: it is a setting, and the checkout page shows the countdown. */
export const holdNote =
  'We hold your spaces while you pay. The countdown starts on the next page.';

/** What the bar, sheet, and panel say while ops have bookings paused (PRD-16). */
export const pausedNotice = {
  title: 'Bookings are paused',
  body: "We've paused new bookings for a little while. Please check back soon.",
} as const;
