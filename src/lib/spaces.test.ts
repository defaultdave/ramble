import { describe, expect, it } from 'vitest';
import {
  hasSpaceForParty,
  hasSpaceLeft,
  spacesLabel,
  spacesLeft,
  spacesStatus,
} from './spaces';

describe('hasSpaceForParty', () => {
  it.each([
    { allocation: 8, seatsSold: 2, party: 6, expected: true },
    { allocation: 8, seatsSold: 3, party: 6, expected: false },
    { allocation: 8, seatsSold: 7, party: 1, expected: true },
    { allocation: 8, seatsSold: 7, party: 2, expected: false },
    { allocation: 8, seatsSold: 8, party: 1, expected: false },
    { allocation: 0, seatsSold: 0, party: 1, expected: false },
    { allocation: 4, seatsSold: 9, party: 1, expected: false },
  ])(
    '$seatsSold sold of $allocation holds a party of $party: $expected',
    ({ allocation, seatsSold, party, expected }) => {
      expect(hasSpaceForParty({ allocation, seatsSold }, party)).toBe(expected);
    },
  );
});

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

describe('spacesLeft', () => {
  it.each([
    { allocation: 8, seatsSold: 3, expected: 5 },
    { allocation: 8, seatsSold: 8, expected: 0 },
    { allocation: 0, seatsSold: 0, expected: 0 },
    { allocation: 8, seatsSold: 9, expected: -1 },
  ])(
    '$seatsSold sold of $allocation leaves $expected',
    ({ allocation, seatsSold, expected }) => {
      expect(spacesLeft({ allocation, seatsSold })).toBe(expected);
    },
  );
});

describe('hasSpaceLeft', () => {
  it.each([
    { allocation: 8, seatsSold: 0, expected: true },
    { allocation: 8, seatsSold: 7, expected: true },
    { allocation: 8, seatsSold: 8, expected: false },
    { allocation: 0, seatsSold: 0, expected: false },
    { allocation: 8, seatsSold: 9, expected: false },
  ])(
    '$seatsSold sold of $allocation is $expected',
    ({ allocation, seatsSold, expected }) => {
      expect(hasSpaceLeft({ allocation, seatsSold })).toBe(expected);
    },
  );

  it.each([-1, 0, 1, 3, 4, 8])(
    'agrees with spacesStatus at %i left',
    (left) => {
      expect(hasSpaceLeft({ allocation: left, seatsSold: 0 })).toBe(
        spacesStatus(left) !== 'sold-out',
      );
    },
  );
});
