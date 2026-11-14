import { describe, expect, it } from 'vitest';
import { andList, count, formatMoney, guestsLabel } from './format';

// Behaviours under test, one per decision or risk:
// - count pluralises with `s`, with a given plural, and says zero in the plural
// - guestsLabel is count for guests, and refuses what is not a positive integer
// - andList words a list the way the site does
// - the money formatter is the one from money.ts, re-exported

describe('count', () => {
  it.each([
    [1, 'adult', undefined, '1 adult'],
    [0, 'adult', undefined, '0 adults'],
    [2, 'adult', undefined, '2 adults'],
    [1, 'child', 'children', '1 child'],
    [3, 'child', 'children', '3 children'],
  ])('says %i %s (plural %s) as "%s"', (n, one, many, label) => {
    expect(count(n, one, many)).toBe(label);
  });
});

describe('guestsLabel', () => {
  it.each([
    [1, '1 guest'],
    [2, '2 guests'],
    [6, '6 guests'],
  ])('labels %i guests', (n, label) => {
    expect(guestsLabel(n)).toBe(label);
  });

  it.each([0, -1, 1.5, Number.NaN])('throws on %s', (n) => {
    expect(() => guestsLabel(n)).toThrow(RangeError);
  });
});

describe('andList', () => {
  it.each([
    [['A'], 'A'],
    [['A', 'B'], 'A and B'],
    [['A', 'B', 'C'], 'A, B, and C'],
  ])('joins %j as "%s"', (names, text) => {
    expect(andList.format(names)).toBe(text);
  });
});

describe('re-exports', () => {
  it('formats money as money.ts does', () => {
    expect(formatMoney(1250)).toBe('$12.50');
  });
});
