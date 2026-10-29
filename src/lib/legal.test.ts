import { describe, expect, it } from 'vitest';
import {
  LegalDocSchema,
  isDraft,
  LegalDraftInputSchema,
  OrderAcceptancesInputSchema,
  legalChange,
  isSuperseded,
  legalKindOf,
  nextLegalVersion,
} from './legal';
import { tagsForChanges } from './cacheTags';

// Behaviours under test, one per decision, branch or risk:
// - a document key is one of the three fixed keys or waiver- and a slug, and nothing else
// - the kind of a document follows from its key, and a malformed key has none
// - publishing a document reaches the tag of its page
// - a checkout's acceptances name an order and one or two versions, ids lower-cased, and nothing else

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

describe('nextLegalVersion', () => {
  it.each([
    ['nothing written yet', undefined, 1],
    ['version 1 written', 1, 2],
    ['version 41 written', 41, 42],
  ])('is the next number after %s', (_name, latest, expected) => {
    expect(nextLegalVersion(latest)).toBe(expected);
  });
});

describe('isSuperseded', () => {
  it.each([
    ['no version is published', 3, [], false],
    ['only lower versions are published', 3, [1, 2], false],
    ['the same version is published', 3, [3], false],
    ['a higher version is published', 3, [4], true],
    ['higher and lower versions are published', 3, [7, 2, 1], true],
    ['the highest is published, in any order', 1, [2, 9, 4], true],
  ])(
    'a draft is superseded when %s: %s',
    (_name, draft, published, expected) => {
      expect(isSuperseded(draft, published)).toBe(expected);
    },
  );
});

describe('isDraft', () => {
  it.each([
    ['draft', true],
    ['published', false],
  ] as const)('a %s version is a draft: %s', (status, expected) => {
    expect(isDraft(status)).toBe(expected);
  });
});

describe('a document key of millions of characters', () => {
  it.each([
    ['a waiver slug', `waiver-${'a-'.repeat(3_000_000)}a`],
    ['letters', 'a'.repeat(6_000_000)],
  ])('is refused for %s without throwing', (_name, value) => {
    expect(LegalDocSchema.safeParse(value).success).toBe(false);
  });
});

describe('the acceptances a checkout records', () => {
  const orderId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
  const termsId = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d';
  const waiverId = '1b9d6bcd-bbfd-4b2d-9b5d-ab8dfbbd4bed';

  it('lower-cases the ids', () => {
    expect(
      OrderAcceptancesInputSchema.parse({
        orderId: orderId.toUpperCase(),
        legalDocumentIds: [termsId.toUpperCase()],
      }),
    ).toEqual({ orderId, legalDocumentIds: [termsId] });
  });

  it.each([
    ['no versions', { orderId, legalDocumentIds: [] }],
    [
      'three versions',
      { orderId, legalDocumentIds: [termsId, waiverId, orderId] },
    ],
    [
      'an order id that is not an id',
      { orderId: 'nope', legalDocumentIds: [termsId] },
    ],
    [
      'a field it does not know',
      { orderId, legalDocumentIds: [termsId], subjectKind: 'host' },
    ],
  ])('refuses %s', (_name, input) => {
    expect(OrderAcceptancesInputSchema.safeParse(input).success).toBe(false);
  });
});
