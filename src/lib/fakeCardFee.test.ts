import { describe, expect, it } from 'vitest';
import { fakeCardFeeMinor } from './fakeCardFee';

describe('fakeCardFeeMinor', () => {
  it.each([
    [100, 33],
    [500, 45],
    [6_500, 219],
    [10_000, 320],
    [13_000, 407],
    [14_950, 464],
  ])('charges 2.9%% plus 30 cents on %i cents: %i', (amount, fee) => {
    expect(fakeCardFeeMinor(amount)).toBe(fee);
  });

  it.each([0, -100, 12.5, Number.NaN])('refuses %p', (amount) => {
    expect(() => fakeCardFeeMinor(amount)).toThrow(RangeError);
  });
});
