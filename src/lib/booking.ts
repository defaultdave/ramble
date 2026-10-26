import { formatMoney, formatPrice } from './money';
import { guestsLabel } from './orderSummary';

export function fromPriceLabel(priceMinor: number): string {
  return `From ${formatPrice(priceMinor)}`;
}

export function perPersonLabel(nextDate: string | undefined): string {
  return nextDate ? `per person · next ${nextDate}` : 'per person';
}

export function chosenPartyLabel(guests: number, totalMinor: number): string {
  return `${guestsLabel(guests)} · ${formatMoney(totalMinor)}`;
}

export function continueLabel(totalMinor: number): string {
  return `Continue · ${formatMoney(totalMinor)}`;
}
