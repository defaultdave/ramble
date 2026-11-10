import { describe, expect, it } from 'vitest';
import {
  SupportRequestSchema,
  readSupportValues,
  supportFieldErrors,
  supportFieldMessages,
  supportLimits,
} from './support';

// Behaviours under test, one per decision, branch or risk:
// - a valid request parses, with the name and message trimmed and the address trimmed and lower-cased
// - each field the form refuses is refused: blank or over-long text, a character Postgres cannot store, a bad address, an unknown topic
// - a refusal is reported once per field, in the form's words, whatever the number of issues
// - reading the form takes text fields only; a file or a missing field reads as empty

const valid = {
  name: 'Pat Smith',
  email: 'pat@example.com',
  topic: 'booking',
  message: 'Where do we meet?',
};

describe('SupportRequestSchema', () => {
  it('trims the text and folds the address', () => {
    expect(
      SupportRequestSchema.parse({
        ...valid,
        name: '  Pat Smith ',
        email: ' Pat@Example.COM ',
        message: '\nWhere do we meet?\n',
      }),
    ).toEqual(valid);
  });

  it.each([
    ['a blank name', { name: '   ' }],
    [
      'a name over the limit',
      { name: 'x'.repeat(supportLimits.nameMaxChars + 1) },
    ],
    ['a blank message', { message: '' }],
    [
      'a message over the limit',
      { message: 'x'.repeat(supportLimits.messageMaxChars + 1) },
    ],
    ['a message Postgres cannot store', { message: 'hi\u0000there' }],
    ['an address with no domain', { email: 'pat' }],
    ['an address with a display name', { email: 'Pat <pat@example.com>' }],
    ['two addresses', { email: 'a@example.com,b@example.com' }],
    ['an unknown topic', { topic: 'complaint' }],
    ['no topic', { topic: '' }],
  ])('refuses %s', (_label, override) => {
    expect(
      SupportRequestSchema.safeParse({ ...valid, ...override }).success,
    ).toBe(false);
  });
});

describe('supportFieldErrors', () => {
  it('names each refused field once, in the form words', () => {
    const result = SupportRequestSchema.safeParse({
      name: '',
      email: 'nope',
      topic: 'booking',
      message: 'x'.repeat(supportLimits.messageMaxChars * 3),
    });

    expect(result.success ? null : supportFieldErrors(result.error)).toEqual({
      name: supportFieldMessages.name,
      email: supportFieldMessages.email,
      message: supportFieldMessages.message,
    });
  });
});

describe('readSupportValues', () => {
  it('reads text fields and turns anything else into an empty value', () => {
    const fields: Record<string, unknown> = {
      name: 'Pat',
      email: new File(['x'], 'x.txt'),
      topic: null,
      message: 'x'.repeat(supportLimits.messageMaxChars * 2 + 1),
    };

    expect(readSupportValues((field) => fields[field])).toEqual({
      name: 'Pat',
      email: '',
      topic: '',
      message: '',
    });
  });
});
