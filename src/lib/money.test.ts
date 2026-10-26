import { describe, expect, it } from 'vitest';
import { formatMoney, formatPrice } from './money';

describe('formatMoney', () => {
  it.each([
    [0, '$0.00'],
    [5, '$0.05'],
    [99, '$0.99'],
    [100, '$1.00'],
    [8500, '$85.00'],
    [17000, '$170.00'],
    [18509, '$185.09'],
    [123456789, '$1,234,567.89'],
  ])('formats %i minor units as %s', (minor, text) => {
    expect(formatMoney(minor)).toBe(text);
  });
});

describe('formatPrice', () => {
  it.each([
    [0, '$0'],
    [8500, '$85'],
    [1250, '$12.50'],
    [1205, '$12.05'],
    [100000, '$1,000'],
  ])('formats %i minor units as %s', (minor, text) => {
    expect(formatPrice(minor)).toBe(text);
  });
});

describe.each([
  ['formatMoney', formatMoney],
  ['formatPrice', formatPrice],
])('%s refuses what is not money', (_name, format) => {
  it.each([
    ['a fraction of a cent', 1.5],
    ['a negative amount', -1],
    ['NaN', Number.NaN],
    ['Infinity', Number.POSITIVE_INFINITY],
    ['a value past the safe integer range', Number.MAX_SAFE_INTEGER + 1],
  ])('throws on %s', (_label, value) => {
    expect(() => format(value)).toThrow(RangeError);
  });
});
