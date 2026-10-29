import type { taxTreatments } from './catalog';
import { formatMoney } from './money';
import { MAX_LINES } from './pricing';

export type TaxTreatment = (typeof taxTreatments)[number];

export type OrderSummaryLine = { label: string; amountMinor: number };

export type OrderSummaryAmounts = {
  lines: { label: string; amount: string }[];
  tax: { label: string; amount: string } | null;
  total: string;
};

export function guestsLabel(count: number): string {
  if (!Number.isSafeInteger(count) || count < 1) {
    throw new RangeError(
      `Guests must be a positive integer, got ${String(count)}`,
    );
  }
  return count === 1 ? '1 guest' : `${String(count)} guests`;
}

export function bookingMeta(details: {
  dateLabel: string;
  timeLabel: string;
  guests: number;
}): string {
  return `${details.dateLabel} · ${details.timeLabel} · ${guestsLabel(details.guests)}`;
}

export function giftMeta(details: {
  recipientName: string;
  deliveryLabel: string;
}): string {
  return `Gift for ${details.recipientName} · email on ${details.deliveryLabel}`;
}

/**
 * The tax line follows the experience's treatment (PRD-78): only a taxable
 * experience shows one, even when it rounds to $0.00. Unknown is charged as
 * not taxable, so it shows none.
 */
function showsTaxLine(treatment: TaxTreatment): boolean {
  return treatment === 'taxable';
}

/**
 * The total shown is the amount charged (PRD-19), so a summary whose parts do
 * not add up to it is refused rather than shown: a guest must never see one
 * number itemized and another charged.
 */
export function orderSummaryAmounts(input: {
  lines: readonly OrderSummaryLine[];
  taxTreatment: TaxTreatment;
  taxMinor: number;
  totalMinor: number;
}): OrderSummaryAmounts {
  const { lines, taxTreatment, taxMinor, totalMinor } = input;
  if (lines.length === 0 || lines.length > MAX_LINES) {
    throw new RangeError(
      `An order summary has 1 to ${String(MAX_LINES)} lines, got ${String(lines.length)}`,
    );
  }
  const taxShown = showsTaxLine(taxTreatment);
  if (!taxShown && taxMinor !== 0) {
    throw new RangeError(
      `Tax must be 0 when the experience is ${taxTreatment}, got ${String(taxMinor)}`,
    );
  }
  const itemizedMinor =
    lines.reduce((sum, line) => sum + line.amountMinor, 0) + taxMinor;
  if (itemizedMinor !== totalMinor) {
    throw new RangeError(
      `Order summary lines add up to ${String(itemizedMinor)} but the total is ${String(totalMinor)}`,
    );
  }
  return {
    lines: lines.map((line) => ({
      label: line.label,
      amount: formatMoney(line.amountMinor),
    })),
    tax: taxShown
      ? { label: 'Sales tax', amount: formatMoney(taxMinor) }
      : null,
    total: formatMoney(totalMinor),
  };
}
