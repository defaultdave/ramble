import { describe, expect, it } from 'vitest';
import {
  LegalAcceptancesInputSchema,
  LegalDocSchema,
  LegalDraftInputSchema,
  legalChange,
  legalKindOf,
  maxAcceptancesPerSubmission,
} from './legal';
import { tagsForChanges } from './cacheTags';

// Behaviours under test, one per decision, branch or risk:
// - a document key is one of the three fixed keys or waiver- and a slug, and nothing else
// - the kind of a document follows from its key, and a malformed key has none
// - an acceptance names one to five distinct-shaped documents and a subject, and nothing else
// - publishing a document reaches the tag of its page

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

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

describe('an acceptance', () => {
  const acceptance = {
    subjectKind: 'order',
    subjectId: id(1),
    documentIds: [id(2), id(3)],
  };

  it('accepts an order or a host with one to the limit of documents', () => {
    expect(LegalAcceptancesInputSchema.safeParse(acceptance).success).toBe(
      true,
    );
    expect(
      LegalAcceptancesInputSchema.safeParse({
        ...acceptance,
        subjectKind: 'host',
        documentIds: Array.from(
          { length: maxAcceptancesPerSubmission },
          (_, n) => id(n + 10),
        ),
      }).success,
    ).toBe(true);
  });

  it.each([
    ['no documents', { documentIds: [] }],
    [
      'more documents than the limit',
      {
        documentIds: Array.from(
          { length: maxAcceptancesPerSubmission + 1 },
          (_, n) => id(n + 10),
        ),
      },
    ],
    ['a malformed document ID', { documentIds: ['nope'] }],
    ['a subject that is neither an order nor a host', { subjectKind: 'guest' }],
    ['a malformed subject ID', { subjectId: 'nope' }],
    [
      'a field it does not know',
      { acceptedAt: new Date('2026-10-26T12:00:00Z') },
    ],
  ])('refuses %s', (_name, change) => {
    expect(
      LegalAcceptancesInputSchema.safeParse({ ...acceptance, ...change })
        .success,
    ).toBe(false);
  });
});

describe('publishing a document', () => {
  it('invalidates the tag of its page', () => {
    expect(tagsForChanges([legalChange('terms')])).toEqual(['legal:terms']);
  });
});
