import { describe, expect, it } from 'vitest';
import {
  canTransition,
  giftStatuses,
  giftTransitions,
  isTerminal,
  requireGiftTransition,
  type TransitionTable,
} from './transitions';

// Behaviours under test: a move is allowed only if the table lists it, and a status with no
// moves is terminal.

type Light = 'red' | 'green' | 'done';
const table: TransitionTable<Light> = {
  red: ['green'],
  green: ['red', 'done'],
  done: [],
};

describe('transition tables', () => {
  it.each([
    ['red', 'green', true],
    ['green', 'done', true],
    ['red', 'done', false],
    ['red', 'red', false],
    ['done', 'red', false],
  ] as const)('%s to %s is %s', (from, to, expected) => {
    expect(canTransition(table, from, to)).toBe(expected);
  });

  it.each([
    ['red', false],
    ['green', false],
    ['done', true],
  ] as const)('%s terminal: %s', (status, expected) => {
    expect(isTerminal(table, status)).toBe(expected);
  });
});

describe('gift transitions', () => {
  it.each([
    ['pending_payment', 'scheduled'],
    ['scheduled', 'delivered'],
    ['delivered', 'redeemed'],
    ['redeemed', 'delivered'],
  ] as const)('%s to %s is allowed', (from, to) => {
    expect(() => {
      requireGiftTransition(from, to);
    }).not.toThrow();
  });

  it.each([
    ['pending_payment', 'delivered'],
    ['pending_payment', 'redeemed'],
    ['scheduled', 'redeemed'],
    ['scheduled', 'pending_payment'],
    ['delivered', 'scheduled'],
    ['delivered', 'delivered'],
    ['redeemed', 'scheduled'],
  ] as const)('%s to %s is refused', (from, to) => {
    expect(() => {
      requireGiftTransition(from, to);
    }).toThrow(`A gift does not move from ${from} to ${to}`);
  });

  it('has a row for every status, none of them a refund state, and no status is terminal', () => {
    expect(Object.keys(giftTransitions).sort()).toEqual(
      [...giftStatuses].sort(),
    );
    expect(giftStatuses.some((status) => status.includes('refund'))).toBe(
      false,
    );
    expect(
      giftStatuses.some((status) => isTerminal(giftTransitions, status)),
    ).toBe(false);
  });
});
