import { describe, expect, it, vi } from 'vitest';
import {
  CollectionInputSchema,
  HelpArticleInputSchema,
  HomeModulesInputSchema,
  PageCopyInputSchema,
} from './editorial';
import { LegalDraftInputSchema } from './legal';
import { SettingsChangeSchema } from './settings';
import { isStorable, isStorableJson } from './text';

// Behaviours under test, one per decision, branch or risk:
// - a string is storable unless it holds U+0000 or a lone surrogate, and a pair is not lone
// - a JSON value is storable unless a key or any nested string is not
// - every text field and every rich-text document on every write contract refuses U+0000 and a lone
//   surrogate, and accepts the same field with clean text (so the refusal is the cause)

const id = '00000000-0000-4000-8000-000000000001';

function richText(text: string) {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  };
}

const collection = (overrides: Record<string, unknown>) =>
  CollectionInputSchema.safeParse({
    kind: 'pick',
    slug: 'a-pick',
    title: 'Title',
    summary: null,
    intro: null,
    status: 'draft',
    items: [],
    ...overrides,
  }).success;

const homeModules = (overrides: Record<string, unknown>) =>
  HomeModulesInputSchema.safeParse([
    {
      kind: 'hero_search',
      enabled: true,
      heading: null,
      body: null,
      collectionId: null,
      ...overrides,
    },
  ]).success;

const pageCopy = (overrides: Record<string, unknown>) =>
  PageCopyInputSchema.safeParse({
    kind: 'category',
    targetId: id,
    heading: null,
    metaDescription: null,
    status: 'draft',
    intro: null,
    body: null,
    ...overrides,
  }).success;

const helpArticle = (overrides: Record<string, unknown>) =>
  HelpArticleInputSchema.safeParse({
    slug: 'a-help-article',
    title: 'Title',
    summary: null,
    position: 0,
    status: 'draft',
    body: richText('Body'),
    ...overrides,
  }).success;

const legalDraft = (overrides: Record<string, unknown>) =>
  LegalDraftInputSchema.safeParse({
    doc: 'terms',
    title: 'Title',
    body: richText('Body'),
    ...overrides,
  }).success;

const fields: [string, (value: string) => boolean][] = [
  ['collection title', (v) => collection({ title: v })],
  ['collection summary', (v) => collection({ summary: v })],
  [
    'collection entry note',
    (v) => collection({ items: [{ experienceId: id, note: v }] }),
  ],
  ['collection intro', (v) => collection({ intro: richText(v) })],
  ['home module heading', (v) => homeModules({ heading: v })],
  ['home module body', (v) => homeModules({ body: richText(v) })],
  ['page heading', (v) => pageCopy({ heading: v })],
  ['page meta description', (v) => pageCopy({ metaDescription: v })],
  ['page intro', (v) => pageCopy({ intro: richText(v) })],
  ['page body', (v) => pageCopy({ body: richText(v) })],
  ['help article title', (v) => helpArticle({ title: v })],
  ['help article summary', (v) => helpArticle({ summary: v })],
  ['help article body', (v) => helpArticle({ body: richText(v) })],
  ['legal document title', (v) => legalDraft({ title: v })],
  ['legal document body', (v) => legalDraft({ body: richText(v) })],
  [
    'settings banner',
    (v) => SettingsChangeSchema.safeParse({ bannerText: v }).success,
  ],
];

const unstorable = [
  ['a NUL', 'before\u0000after'],
  ['only a NUL', '\u0000'],
  ['a lone high surrogate', 'before\ud800after'],
  ['a lone low surrogate', 'before\udc00after'],
  ['a high surrogate at the end', 'before\ud83d'],
  ['a low surrogate then a high one', '\ude00\ud83d'],
] as const;

describe('isStorable', () => {
  it.each([
    ['plain text', 'hello', true],
    ['an emoji, which is a surrogate pair', '😀', true],
    ['a NUL', 'a\u0000', false],
    ['a lone high surrogate', '\ud83d', false],
    ['a lone low surrogate', '\ude00', false],
    ['a pair split by text', '\ud83dx\ude00', false],
  ])('%s: %s', (_name, value, expected) => {
    expect(isStorable(value)).toBe(expected);
  });
});

describe('isStorableJson', () => {
  it.each([
    ['a clean tree', { a: ['x', { b: 'y' }], c: 1, d: null }, true],
    ['a NUL deep in an array', { a: [[['x\u0000']]] }, false],
    ['a lone surrogate in a value', { a: { b: 'x\ud800' } }, false],
    ['a NUL in a key', { 'k\u0000': 'x' }, false],
    ['a bare string', 'x\u0000', false],
    ['numbers, booleans and null', [1, true, null], true],
  ])('%s', (_name, value, expected) => {
    expect(isStorableJson(value)).toBe(expected);
  });
});

describe('every write contract', () => {
  it.each(fields)('accepts clean text in the %s', (_field, accepts) => {
    expect(accepts('Clean text 😀')).toBe(true);
  });

  describe.each(unstorable)('with %s', (_name, value) => {
    it.each(fields)('refuses it in the %s', (_field, accepts) => {
      expect(accepts(value)).toBe(false);
    });
  });
});

describe('a string over the limit', () => {
  it('is refused without walking it by code point or for storability', () => {
    const fromSpy = vi.spyOn(Array, 'from');
    const wellFormedSpy = vi.spyOn(String.prototype, 'isWellFormed');
    const result = CollectionInputSchema.safeParse({
      kind: 'pick',
      slug: 'a-pick',
      title: 'x'.repeat(10_000),
      summary: null,
      intro: null,
      status: 'draft',
      items: [],
    });
    const walked = fromSpy.mock.calls.length + wellFormedSpy.mock.calls.length;
    fromSpy.mockRestore();
    wellFormedSpy.mockRestore();

    expect(result.success).toBe(false);
    expect(walked).toBe(0);
  });
});
