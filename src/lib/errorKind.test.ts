import { describe, expect, it } from 'vitest';
import { errorKind } from './errorKind';

// Behaviours under test, one per decision, branch or risk:
// - an Error gives its name, a subclass gives its own name, and neither gives the message
// - a thrown value that is not an Error gives the fallback: 'unknown' by default, or the caller's own

class DriverError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DriverError';
  }
}

describe('errorKind', () => {
  it.each([
    ['a plain error', new Error('secret'), 'Error'],
    ['a subclass', new DriverError('secret'), 'DriverError'],
  ])('gives the name of %s and not its message', (_name, thrown, expected) => {
    expect(errorKind(thrown)).toBe(expected);
  });

  it.each([
    ['a string', 'secret'],
    ['an object that only looks like an error', { name: 'Error' }],
    ['nothing', undefined],
  ])('gives the fallback for %s', (_name, thrown) => {
    expect(errorKind(thrown)).toBe('unknown');
    expect(errorKind(thrown, 'NonError')).toBe('NonError');
  });
});
