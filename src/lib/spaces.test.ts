import { describe, expect, it } from 'vitest';
import { spacesLabel, spacesStatus } from './spaces';

describe('spacesStatus', () => {
  it.each([
    { spacesLeft: 8, expected: 'open' },
    { spacesLeft: 4, expected: 'open' },
    { spacesLeft: 3, expected: 'few-left' },
    { spacesLeft: 1, expected: 'few-left' },
    { spacesLeft: 0, expected: 'sold-out' },
    { spacesLeft: -1, expected: 'sold-out' },
  ])('$spacesLeft left is $expected', ({ spacesLeft, expected }) => {
    expect(spacesStatus(spacesLeft)).toBe(expected);
  });
});

describe('spacesLabel', () => {
  it.each([
    { spacesLeft: 8, expected: '8 spaces' },
    { spacesLeft: 4, expected: '4 spaces' },
    { spacesLeft: 3, expected: '3 left' },
    { spacesLeft: 1, expected: '1 left' },
    { spacesLeft: 0, expected: 'Sold out' },
    { spacesLeft: -2, expected: 'Sold out' },
  ])('$spacesLeft left reads "$expected"', ({ spacesLeft, expected }) => {
    expect(spacesLabel(spacesLeft)).toBe(expected);
  });
});
