import { taxTreatments, type PriceOption } from './catalog';
import { fromPriceLabel } from './booking';
import { formatPrice } from './money';

// Integer minor units (cents) and parts per million only: no float touches an amount.
export const PPM = 1_000_000;

// A booking has an adult and a child price option at most (design doc 4.2.1), one line each.
export const MAX_LINES = 4;
// The largest party a booking can hold; sessions are far smaller, so this only stops a runaway caller.
export const MAX_QUANTITY = 100;
// $100,000 a person. With MAX_LINES lines of MAX_QUANTITY, the subtotal stays under 4e9 and
// subtotal * PPM under 4e15, inside Number.MAX_SAFE_INTEGER (9.007e15), so no step loses a cent.
export const MAX_UNIT_PRICE_MINOR = 10_000_000;

export type TaxTreatment = (typeof taxTreatments)[number];

export type PricedOption = Pick<
  PriceOption,
  'id' | 'kind' | 'priceMinor' | 'usesSpace'
>;

export type PricingItem = { priceOptionId: string; quantity: number };

type PriceLine = {
  priceOptionId: string;
  kind: PricedOption['kind'];
  quantity: number;
  unitPriceMinor: number;
  usesSpace: boolean;
  lineTotalMinor: number;
};

export type PricingLines = {
  lines: PriceLine[];
  ticketSubtotalMinor: number;
  taxRatePpm: number;
  taxMinor: number;
  totalMinor: number;
};

function requireInt(
  value: number,
  min: number,
  max: number,
  what: string,
): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) {
    throw new RangeError(
      `${what} must be an integer from ${String(min)} to ${String(max)}, got ${String(value)}`,
    );
  }
}

/**
 * `round_half_up(amountMinor * ratePpm / 1_000_000)` (design doc 4.2.3) on integers: the quotient
 * is exact because the remainder is taken first, and a remainder of exactly half rounds up.
 */
export function roundHalfUpPpm(amountMinor: number, ratePpm: number): number {
  const scaled = amountMinor * ratePpm;
  const remainder = scaled % PPM;
  const quotient = (scaled - remainder) / PPM;
  return remainder * 2 >= PPM ? quotient + 1 : quotient;
}

/**
 * The rate to charge for an experience (PRD-78): the configured rate when it is taxable, and 0
 * when it is not taxable or unknown (unknown is charged as not taxable until Q-12 is answered).
 * The configured rate is checked in every case so a broken setting fails loudly instead of
 * waiting for the first taxable experience.
 * TODO(U-014a): first caller, the held total in `reserveSpaces`.
 */
export function taxRatePpm(
  taxTreatment: TaxTreatment,
  configuredRatePpm: number,
): number {
  requireInt(configuredRatePpm, 0, PPM, 'Tax rate (ppm)');
  switch (taxTreatment) {
    case 'taxable':
      return configuredRatePpm;
    case 'not_taxable':
    case 'unknown':
      return 0;
    default:
      throw new RangeError(
        `Unknown tax treatment: ${String(taxTreatment satisfies never)}`,
      );
  }
}

/**
 * Price lines, the tax line, and the total for a party (PRD-19, PRD-23). Each line is its price
 * option's unit price times its quantity, so adults and children are priced on their own options.
 * Tax is the caller's rate over the ticket subtotal, rounded half up once for the whole order
 * (not per line), and the total is exactly subtotal plus tax: the amount charged.
 *
 * Bad input is refused, never repaired: a quantity or price that is negative, fractional, or out
 * of range, an unknown or repeated price option, or too many lines throws a RangeError.
 * TODO(U-014a): first caller, the held total in `reserveSpaces`.
 */
export function lines(
  items: readonly PricingItem[],
  priceOptions: readonly PricedOption[],
  ratePpm: number,
): PricingLines {
  requireInt(ratePpm, 0, PPM, 'Tax rate (ppm)');
  if (priceOptions.length > MAX_LINES) {
    throw new RangeError(
      `At most ${String(MAX_LINES)} price options, got ${String(priceOptions.length)}`,
    );
  }
  if (items.length < 1 || items.length > MAX_LINES) {
    throw new RangeError(
      `A booking has 1 to ${String(MAX_LINES)} lines, got ${String(items.length)}`,
    );
  }

  const optionsById = new Map<string, PricedOption>();
  const kinds = new Set<string>();
  for (const option of priceOptions) {
    requireInt(option.priceMinor, 0, MAX_UNIT_PRICE_MINOR, 'Unit price');
    if (optionsById.has(option.id) || kinds.has(option.kind)) {
      throw new RangeError('Price options must have distinct ids and kinds');
    }
    optionsById.set(option.id, option);
    kinds.add(option.kind);
  }

  const seen = new Set<string>();
  const priced: PriceLine[] = [];
  let ticketSubtotalMinor = 0;
  for (const item of items) {
    requireInt(item.quantity, 1, MAX_QUANTITY, 'Quantity');
    const option = optionsById.get(item.priceOptionId);
    if (!option) {
      throw new RangeError('A line names a price option that is not offered');
    }
    if (seen.has(option.id)) {
      throw new RangeError('A price option appears on more than one line');
    }
    seen.add(option.id);
    const lineTotalMinor = option.priceMinor * item.quantity;
    ticketSubtotalMinor += lineTotalMinor;
    priced.push({
      priceOptionId: option.id,
      kind: option.kind,
      quantity: item.quantity,
      unitPriceMinor: option.priceMinor,
      usesSpace: option.usesSpace,
      lineTotalMinor,
    });
  }

  const taxMinor = roundHalfUpPpm(ticketSubtotalMinor, ratePpm);
  return {
    lines: priced,
    ticketSubtotalMinor,
    taxRatePpm: ratePpm,
    taxMinor,
    totalMinor: ticketSubtotalMinor + taxMinor,
  };
}

/** What a card knows of a price option: its amount, and whether a guest holding it takes a space. */
export type CardPriceOption = Pick<PriceOption, 'priceMinor' | 'usesSpace'>;

/**
 * The per-person price a browse or home card shows: the lowest price among the options that take a
 * space, with "From" only when those prices differ (an adult and a child price). An option that
 * takes no space, such as the free adult who goes with a child, is not a price a guest pays to
 * come, so it never sets the card price. Null when no option takes a space.
 */
export function cardPriceLabel(
  options: readonly CardPriceOption[],
): string | null {
  const prices = options
    .filter((option) => option.usesSpace)
    .map((option) => option.priceMinor);
  if (prices.length === 0) return null;
  const lowest = Math.min(...prices);
  return prices.some((price) => price !== lowest)
    ? fromPriceLabel(lowest)
    : formatPrice(lowest);
}
