import { describe, expect, it } from 'vitest';
import {
  LegalDocSchema,
  LegalDraftInputSchema,
  legalChange,
  legalKindOf,
} from './legal';
import { tagsForChanges } from './cacheTags';

// Behaviours under test, one per decision, branch or risk:
// - a document key is one of the three fixed keys or waiver- and a slug, and nothing else
// - the kind of a document follows from its key, and a malformed key has none
// - publishing a document reaches the tag of its page

describe('document keys', () => {
  it.each([
    ['terms', true],
    ['privacy', true],
    ['host-agreement', true],
    ['waiver-harbor-kayak', true],
    ['waiver-a', true],
    ['waiver', false],
    ['waiver-', false],
    ['waiver--x', false],
    ['waiver-X', false],
    ['Terms', false],
    ['terms-2', false],
    ['cookies', false],
    ['', false],
    ['terms\n', false],
    [`waiver-${'a'.repeat(80)}`, false],
  ])('%j is a key: %s', (key, accepted) => {
    expect(LegalDocSchema.safeParse(key).success).toBe(accepted);
  });

  it.each([
    ['terms', 'marketplace_terms'],
    ['privacy', 'privacy_policy'],
    ['host-agreement', 'host_agreement'],
    ['waiver-harbor-kayak', 'waiver'],
    ['waiver', null],
    ['nonsense', null],
  ])('%j is the kind %j', (key, kind) => {
    expect(legalKindOf(key)).toBe(kind);
  });
});

describe('a new draft', () => {
  const draft = {
    doc: 'terms',
    title: 'Marketplace terms',
    body: {
      type: 'doc',
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hi' }] }],
    },
  };

  it('accepts a titled document with a valid body', () => {
    expect(LegalDraftInputSchema.safeParse(draft).success).toBe(true);
  });

  it.each([
    ['a blank title', { title: '  ' }],
    [
      'a body that needs repair',
      { body: { type: 'doc', content: [{ type: 'x' }] } },
    ],
    ['a version number', { version: 4 }],
    ['a status', { status: 'published' }],
  ])('refuses %s', (_name, change) => {
    expect(
      LegalDraftInputSchema.safeParse({ ...draft, ...change }).success,
    ).toBe(false);
  });
});

describe('publishing a document', () => {
  it.each([
    ['terms', 'legal:terms'],
    ['privacy', 'legal:privacy'],
    ['host-agreement', 'legal:host-agreement'],
    ['waiver-harbor-kayak', 'legal:waiver-harbor-kayak'],
  ])('invalidates only the tag of %s', (doc, tag) => {
    expect(tagsForChanges([legalChange(doc)])).toEqual([tag]);
  });
});
