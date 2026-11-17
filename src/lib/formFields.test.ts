import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { fieldErrorsFrom, readTextFields } from './formFields';

// Behaviours under test:
// - text fields are read as sent, untrimmed
// - a file, null or missing field reads as empty
// - a value over the limit is kept one character over, never emptied, so validation can refuse it
// - a value at the limit is kept whole
// - a refusal is reported once per form field, through the key-to-field map; an unmapped key is skipped

const fields = ['a', 'b'] as const;

describe('readTextFields', () => {
  it('reads strings as sent and anything else as empty', () => {
    const sent: Record<string, unknown> = {
      a: ' x ',
      b: new File(['x'], 'x.txt'),
    };
    expect(readTextFields(fields, (f) => sent[f], 10)).toEqual({
      a: ' x ',
      b: '',
    });
    expect(readTextFields(fields, () => null, 10)).toEqual({ a: '', b: '' });
  });

  it.each([
    ['at the limit', 10, 10],
    ['over the limit', 11, 11],
    ['far over the limit', 500, 11],
  ])('keeps a value %s', (_name, length, kept) => {
    const value = 'x'.repeat(length);
    expect(readTextFields(['a'], () => value, 10).a).toHaveLength(kept);
  });
});

describe('fieldErrorsFrom', () => {
  const schema = z.object({ a: z.string().min(1), amountMinor: z.string() });
  const fieldOfKey = { a: 'a', amountMinor: 'amount' } as const;
  const messages = { a: 'Say a.', amount: 'Say an amount.' };
  const errorsOf = (input: unknown) => {
    const result = schema.safeParse(input);
    return result.success
      ? null
      : fieldErrorsFrom(result.error, fieldOfKey, messages);
  };

  it('reports each refused field once, under the form field name', () => {
    expect(errorsOf({ a: '', amountMinor: 1 })).toEqual({
      a: 'Say a.',
      amount: 'Say an amount.',
    });
  });

  it('skips a key the map does not list', () => {
    const result = z.object({ other: z.string() }).safeParse({});
    expect(
      result.success
        ? null
        : fieldErrorsFrom(result.error, fieldOfKey, messages),
    ).toEqual({});
  });

  it('skips a key that is an inherited property name', () => {
    const result = z.object({ constructor: z.string() }).safeParse({});
    expect(
      result.success
        ? null
        : fieldErrorsFrom(result.error, fieldOfKey, messages),
    ).toEqual({});
  });
});
