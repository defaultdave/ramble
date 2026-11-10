import { describe, expect, it } from 'vitest';
import { fieldControl, fieldIds } from './fieldIds';

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

describe('fieldControl', () => {
  it('uses the caller id, else the generated one', () => {
    expect(fieldControl({ id: 'mine', generatedId: 'gen' }).fieldId).toBe(
      'mine',
    );
    expect(fieldControl({ generatedId: 'gen' }).fieldId).toBe('gen');
  });

  it('points describedBy at the shown hint and error, by the id in use', () => {
    expect(
      fieldControl({
        id: 'mine',
        generatedId: 'gen',
        hint: 'h',
        errorText: 'e',
        describedBy: 'x',
      }).describedBy,
    ).toBe('mine-hint mine-error x');
  });

  it.each([
    ['an error forces it on', 'Bad', undefined, true],
    ['an error overrides the caller', 'Bad', 'false', true],
    ['no error keeps the caller value', undefined, 'true', 'true'],
    [
      'no error and no caller value leaves it off',
      undefined,
      undefined,
      undefined,
    ],
  ] as const)('aria-invalid: %s', (_case, errorText, ariaInvalid, expected) => {
    expect(
      fieldControl({ generatedId: 'g', errorText, ariaInvalid }).ariaInvalid,
    ).toBe(expected);
  });
});
