import { isSafeIntegerInRange } from './integers';

// Money is integer minor units (cents, USD) everywhere; these two functions are the only place it becomes text.
const CENTS_PER_DOLLAR = 100;

function splitMinor(minor: number): { dollars: string; cents: number } {
  if (!isSafeIntegerInRange(minor, 0)) {
    throw new RangeError(
      `Money must be a non-negative integer of minor units, got ${String(minor)}`,
    );
  }
  const cents = minor % CENTS_PER_DOLLAR;
  const dollars = (minor - cents) / CENTS_PER_DOLLAR;
  return { dollars: dollars.toLocaleString('en-US'), cents };
}

/** An amount charged or itemized: always two decimals, "$170.00". */
export function formatMoney(minor: number): string {
  const { dollars, cents } = splitMinor(minor);
  return `$${dollars}.${String(cents).padStart(2, '0')}`;
}

/** A per-person price: whole dollars drop the decimals, "$85", and cents keep them, "$12.50". */
export function formatPrice(minor: number): string {
  const { dollars, cents } = splitMinor(minor);
  return cents === 0
    ? `$${dollars}`
    : `$${dollars}.${String(cents).padStart(2, '0')}`;
}

// Whole dollars are plain digits, or digits in groups of three after a first group of one to three.
const dollarsPattern = /^(\d{1,6}|\d{1,3}(?:,\d{3})+)(?:\.(\d{1,2}))?$/;

/**
 * Dollars as typed ("85", "$12.5", "1,200.00") in cents, or undefined when it is not a price. A
 * comma is a thousands separator in valid groups only, so "12,50" is refused, not read as 1250.
 * Integer arithmetic only.
 */
export function priceMinorFromText(value: string): number | undefined {
  const match = dollarsPattern.exec(value.trim().replace(/^\$/, ''));
  if (!match) return undefined;
  const [, dollars = '', cents = ''] = match;
  return (
    Number(dollars.replaceAll(',', '')) * CENTS_PER_DOLLAR +
    Number(cents.padEnd(2, '0'))
  );
}

/** A saved price as the dollars a person types, or null when there is none. */
export function priceInputTextOrNull(minor: number | null): string | null {
  return minor === null ? null : priceInputText(minor);
}

/** Cents as the dollars a person types: "85" for 8500, "12.50" for 1250. */
export function priceInputText(minor: number): string {
  const { dollars, cents } = splitMinor(minor);
  const plain = dollars.replaceAll(',', '');
  return cents === 0 ? plain : `${plain}.${String(cents).padStart(2, '0')}`;
}
