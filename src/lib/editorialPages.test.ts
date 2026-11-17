import { describe, expect, it } from 'vitest';
import { editorialLimits, type PageCopy } from './editorial';
import {
  buildPageRows,
  findPageTarget,
  pageOutcomeFor,
  pageRedirect,
  parsePageForm,
  parsePageKind,
} from './editorialPages';
import { emptyDoc, paragraphs } from './richText/paragraphs';
import type { TaxonomyTerm } from './taxonomy';

// Behaviours under test, one per decision, branch or risk:
// - an address names a kind or nothing
// - the form's buttons set the status: save keeps the one the form was opened with, publish and unpublish move it
// - a form that names no known kind, id or button is nothing at all; an over-long field is refused unread and named
// - blank fields and an empty editor are stored as nothing; a bad document names its field
// - a list row shows the copy's status, or that there is none, and links to the term by id
// - the page opens the term of that kind and address id with its copy, and nothing for another
// - a save sends the editor back to the form with what the button did; an unknown target goes to the list

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;
const base = { kind: 'category', targetId: id, intent: 'save' };

const term = (termId: string, slug: string): TaxonomyTerm => ({
  id: termId,
  slug,
  name: slug.toUpperCase(),
  position: 0,
  retiredAt: null,
});

const copyOf = (overrides: Partial<PageCopy> = {}): PageCopy => ({
  id: other,
  kind: 'category',
  slug: 'hiking',
  heading: 'Hiking',
  metaDescription: null,
  status: 'published',
  intro: null,
  body: null,
  updatedAt: new Date('2026-11-09T15:30:00Z'),
  publishedAt: new Date('2026-11-02T00:00:00Z'),
  ...overrides,
});

describe('parsePageKind', () => {
  it.each([
    ['category', 'category'],
    ['neighborhood', 'neighborhood'],
    ['host', null],
  ])('%s is %s', (raw, expected) => {
    expect(parsePageKind(raw)).toBe(expected);
  });
});

describe('parsePageForm', () => {
  it.each([
    ['save', 'draft', 'draft'],
    ['save', 'published', 'published'],
    ['publish', 'draft', 'published'],
    ['unpublish', 'published', 'draft'],
  ])('the %s button on a %s form leaves it %s', (intent, opened, status) => {
    const parsed = parsePageForm(form({ ...base, intent, status: opened }));
    expect(parsed).toMatchObject({
      ok: true,
      value: { intent, input: { kind: 'category', targetId: id, status } },
    });
  });

  it('reads the heading, description and both documents, and lower-cases the id', () => {
    const intro = paragraphs('Hello');
    const parsed = parsePageForm(
      form({
        ...base,
        targetId: id.toUpperCase(),
        heading: ' Things to do ',
        metaDescription: 'For search',
        intro: JSON.stringify(intro),
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        input: {
          targetId: id,
          heading: 'Things to do',
          metaDescription: 'For search',
          intro,
          body: null,
        },
      },
    });
  });

  it('stores blank fields and an edited-down editor as nothing', () => {
    const parsed = parsePageForm(
      form({ ...base, heading: '  ', body: JSON.stringify(emptyDoc) }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: { input: { heading: null, metaDescription: null, body: null } },
    });
  });

  it.each([
    ['no kind', { targetId: id, intent: 'save' }],
    ['an unknown kind', { ...base, kind: 'host' }],
    ['no target', { kind: 'category', intent: 'save' }],
    ['a bad target', { ...base, targetId: 'nope' }],
    ['no button', { kind: 'category', targetId: id }],
    ['an unknown button', { ...base, intent: 'delete' }],
  ])('is nothing for a form with %s', (_label, fields) => {
    expect(parsePageForm(form(fields))).toBeNull();
  });

  it.each([
    [
      'a heading over the limit',
      { heading: 'h'.repeat(editorialLimits.heading + 1) },
      ['heading'],
    ],
    [
      'a description over the limit',
      { metaDescription: 'm'.repeat(editorialLimits.metaDescription + 1) },
      ['metaDescription'],
    ],
    ['text that is not a document', { body: '"just words"' }, ['body']],
    [
      'an introduction that is not a document',
      { intro: '{"type":"nope"}' },
      ['intro'],
    ],
  ])('names the field for %s', (_label, fields, named) => {
    expect(parsePageForm(form({ ...base, ...fields }))).toEqual({
      ok: false,
      kind: 'category',
      targetId: id,
      fields: named,
    });
  });

  it('refuses a field too long to be read, without parsing it', () => {
    expect(
      parsePageForm(form({ ...base, heading: 'h'.repeat(5000) })),
    ).toMatchObject({ ok: false, fields: ['heading'] });
    expect(
      parsePageForm(
        form({
          ...base,
          body: 'x'.repeat(editorialLimits.richTextStoredBytes + 1),
        }),
      ),
    ).toMatchObject({ ok: false, fields: ['body'] });
  });
});

describe('buildPageRows', () => {
  it('shows each term with the status of its copy, or that it has none', () => {
    const rows = buildPageRows(
      'category',
      [term(id, 'hiking'), term(other, 'baking')],
      [copyOf(), copyOf({ kind: 'neighborhood', slug: 'baking' })],
    );
    expect(rows).toMatchObject([
      {
        id,
        href: `/ops/editorial/pages/category/${id}`,
        status: 'published',
        statusLabel: 'Published',
      },
      { id: other, status: null, statusLabel: 'No copy yet', updatedLabel: '' },
    ]);
    expect(rows[0]?.updatedLabel).not.toBe('');
  });

  it('marks a retired term', () => {
    const [row] = buildPageRows(
      'neighborhood',
      [{ ...term(id, 'dumbo'), retiredAt: new Date('2026-11-01T00:00:00Z') }],
      [],
    );
    expect(row?.retired).toBe(true);
  });
});

describe('findPageTarget', () => {
  const terms = [term(id, 'hiking')];

  it('finds the term and its copy of the same kind and address', () => {
    expect(
      findPageTarget(terms, [copyOf()], 'category', id)?.copy,
    ).toMatchObject({ slug: 'hiking' });
    expect(
      findPageTarget(terms, [copyOf({ kind: 'neighborhood' })], 'category', id)
        ?.copy,
    ).toBeNull();
  });

  it.each([
    ['an id that is no term', other],
    ['a bad id', 'nope'],
  ])('is nothing for %s', (_label, raw) => {
    expect(findPageTarget(terms, [], 'category', raw)).toBeNull();
  });
});

describe('where a save goes', () => {
  it.each([
    ['save', 'saved'],
    ['publish', 'published'],
    ['unpublish', 'unpublished'],
  ] as const)(
    'the %s button returns to the form with the notice %s',
    (intent, notice) => {
      const outcome = pageOutcomeFor(
        { status: 'saved', value: { kind: 'neighborhood' } },
        id,
        intent,
      );
      expect(pageRedirect(outcome)).toBe(
        `/ops/editorial/pages/neighborhood/${id}?notice=${notice}`,
      );
    },
  );

  it('sends an unknown target to the list', () => {
    expect(
      pageRedirect(pageOutcomeFor({ status: 'unknown_target' }, id, 'save')),
    ).toBe('/ops/editorial/pages?notice=not_found');
  });

  it('returns a refused form to itself with the fields', () => {
    expect(
      pageRedirect({
        status: 'invalid',
        kind: 'category',
        id,
        fields: ['heading', 'body'],
      }),
    ).toBe(
      `/ops/editorial/pages/category/${id}?notice=invalid&fields=heading%2Cbody`,
    );
  });
});
