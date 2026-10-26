// The US card list rate (2.9% plus 30 cents) the fake gateway charges, so demo
// ledgers carry the same unreturned fee a real provider would keep on a refund.
const rateBasisPoints = 290;
const fixedFeeMinor = 30;

/** Card fee in cents for a charge of `amountMinor` cents, rounded half up. */
export function fakeCardFeeMinor(amountMinor: number): number {
  if (!Number.isInteger(amountMinor) || amountMinor <= 0) {
    throw new RangeError('amountMinor must be a positive integer');
  }
  return (
    Math.floor((amountMinor * rateBasisPoints + 5_000) / 10_000) + fixedFeeMinor
  );
}
