import { describe, expect, it } from 'vitest';
import { lockRetryLimit, locksCoverOrder } from './orderLocks';

// Behaviours under test, one per decision, branch, or risk:
// - the locks cover the order only when both the session and the hold it points at now are the ones taken
// - an order that is gone, or no longer a booking, is covered by nothing
// - a path starts over a small, fixed number of times

const taken = {
  sessionId: 'a0000000-0000-4000-8000-0000000000aa',
  holdId: 'c0000000-0000-4000-8000-0000000000cc',
};

describe('locksCoverOrder', () => {
  it('covers an order that points at the locked session and hold', () => {
    expect(locksCoverOrder(taken, { ...taken })).toBe(true);
  });

  it.each([
    [
      'another session',
      { ...taken, sessionId: 'b0000000-0000-4000-8000-0000000000bb' },
    ],
    [
      'another hold',
      { ...taken, holdId: 'd0000000-0000-4000-8000-0000000000dd' },
    ],
    ['no session', { ...taken, sessionId: null }],
    ['no hold', { ...taken, holdId: null }],
    ['no order', undefined],
  ])('does not cover an order with %s', (_name, locked) => {
    expect(locksCoverOrder(taken, locked)).toBe(false);
  });
});

describe('lockRetryLimit', () => {
  it('is three tries', () => {
    expect(lockRetryLimit).toBe(3);
  });
});
