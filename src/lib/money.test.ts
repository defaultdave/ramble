import { describe, expect, it } from 'vitest';
import {
  priceInputTextOrNull,
  formatMoney,
  formatPrice,
  priceInputText,
  priceMinorFromText,
} from './money';

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

describe('prices typed in a form', () => {
  it.each([
    ['85', 8500],
    ['$85', 8500],
    ['12.5', 1250],
    ['12.05', 1205],
    ['1,200.00', 120000],
    ['1,250', 125000],
    ['1,250.50', 125050],
    ['12,345,678', 1234567800],
    ['$1,250', 125000],
    [' 0 ', 0],
  ])('reads %s as %i cents', (text, minor) => {
    expect(priceMinorFromText(text)).toBe(minor);
  });

  it.each([
    '',
    'free',
    '12.345',
    '-5',
    '1e3',
    '12.',
    '1234567',
    '12,50',
    '1,25',
    '12,500,0',
    ',50',
    '1,,250',
    '1,2500',
    '1,250,',
    '1 200',
  ])('does not read %j as a price', (text) => {
    expect(priceMinorFromText(text)).toBeUndefined();
  });

  it.each([
    [8500, '85'],
    [1250, '12.50'],
    [1205, '12.05'],
    [0, '0'],
    [170000, '1700'],
  ])('writes %i cents as %s', (minor, text) => {
    expect(priceInputText(minor)).toBe(text);
  });
});

describe('priceInputTextOrNull', () => {
  it.each([
    [null, null],
    [0, '0'],
    [1250, '12.50'],
  ])('%j is %j', (minor, text) => {
    expect(priceInputTextOrNull(minor)).toBe(text);
  });
});
