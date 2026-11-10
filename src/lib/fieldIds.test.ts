import { describe, expect, it } from 'vitest';
import { fieldIds } from './fieldIds';

// Behaviours under test, one per decision, branch or risk:
// - describedBy lists the hint, then the error, then the caller's ids, only for what is shown
// - nothing shown means no attribute

describe('fieldIds', () => {
  it.each([
    [{}, undefined],
    [{ hint: 'h' }, 'f-hint'],
    [{ errorText: 'e' }, 'f-error'],
    [{ hint: 'h', errorText: 'e', describedBy: 'x y' }, 'f-hint f-error x y'],
    [{ describedBy: 'x' }, 'x'],
  ])('%j -> %j', (parts, expected) => {
    expect(fieldIds('f', parts).describedBy).toBe(expected);
  });

  it('names the hint and error ids from the field id', () => {
    expect(fieldIds('f', {})).toMatchObject({
      hintId: 'f-hint',
      errorId: 'f-error',
    });
  });
});
