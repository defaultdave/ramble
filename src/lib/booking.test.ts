import { describe, expect, it } from 'vitest';
import {
  chosenPartyLabel,
  continueLabel,
  fromPriceLabel,
  perPersonLabel,
} from './booking';

describe('booking bar copy', () => {
  it.each([
    [8500, 'From $85'],
    [6550, 'From $65.50'],
  ])('labels a lowest price of %i', (minor, label) => {
    expect(fromPriceLabel(minor)).toBe(label);
  });

  it.each([
    ['Sat, Oct 24', 'per person · next Sat, Oct 24'],
    [undefined, 'per person'],
  ])('labels the next date %s', (nextDate, label) => {
    expect(perPersonLabel(nextDate)).toBe(label);
  });

  it('shows the party and the amount charged', () => {
    expect(chosenPartyLabel(2, 17000)).toBe('2 guests · $170.00');
  });

  it('puts the amount charged on Continue', () => {
    expect(continueLabel(13000)).toBe('Continue · $130.00');
  });
});
