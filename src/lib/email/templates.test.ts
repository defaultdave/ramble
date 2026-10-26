import { describe, expect, it } from 'vitest';
import { parseEmailRequest, subjectFor } from './templates';

// Behaviours under test, one per decision or risk:
// - a valid request parses and its recipient is lower-cased
// - an unknown template, bad data, a bad address, and a bad key are each refused, not repaired
// - the subject comes from the template registry

const valid = {
  template: 'dev-check',
  to: 'Guest@Example.com',
  data: { recipientName: 'Sam' },
  idempotencyKey: 'dev-check:1',
};

describe('parseEmailRequest', () => {
  it('parses a valid request and folds the recipient to lower case', () => {
    expect(parseEmailRequest(valid)).toEqual({
      ...valid,
      to: 'guest@example.com',
    });
  });

  it.each([
    ['an unknown template', { template: 'surprise' }],
    ['no template', { template: undefined }],
    ['a bad address', { to: 'guest' }],
    ['a second recipient', { to: 'a@example.com,b@example.com' }],
    ['a blank name', { data: { recipientName: '' } }],
    ['a name over 80 characters', { data: { recipientName: 'x'.repeat(81) } }],
    ['no data', { data: undefined }],
    ['a key with a space', { idempotencyKey: 'two words' }],
    ['no key', { idempotencyKey: undefined }],
  ])('refuses %s', (_label, override) => {
    expect(() => parseEmailRequest({ ...valid, ...override })).toThrow();
  });

  it('refuses something that is not an object', () => {
    expect(() => parseEmailRequest('hello')).toThrow();
  });
});

describe('subjectFor', () => {
  it('reads the subject from the template registry', () => {
    expect(subjectFor(parseEmailRequest(valid))).toBe('Ramble email check');
  });
});
