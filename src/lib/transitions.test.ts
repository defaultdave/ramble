import { describe, expect, it } from 'vitest';
import { canTransition, isTerminal, type TransitionTable } from './transitions';

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
