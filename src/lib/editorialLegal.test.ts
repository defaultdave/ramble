import { describe, expect, it } from 'vitest';
import { editorialLimits } from './editorial';
import {
  buildLegalDocRows,
  buildLegalVersionRows,
  draftStart,
  findVersion,
  legalAuditEntry,
  legalDocLabel,
  legalOutcomeFor,
  mayStartDraft,
  legalRedirect,
  parseLegalDocParam,
  parseLegalForm,
  wantsPublish,
} from './editorialLegal';
import type { LegalDocument } from './legal';
import { emptyDoc, paragraphs } from './richText/paragraphs';

// Behaviours under test, one per decision, branch or risk:
// - the list shows the three fixed documents first even with no version, then each stored waiver, each with what is live and what is waiting
// - a document key an address names is valid or nothing; labels name the kind
// - a draft may be started only for a fixed document or a key that already has a version
// - a draft starts from the newest version's words, and from nothing when there is none
// - a version is found by id among its document's versions; only a draft has an editor link
// - the form needs a known button and a title; publishing needs text in the body; a field too long to be read is refused unread
// - publishing follows a save that came through and nothing else; each step's refusal ends as one outcome
// - outcomes go to the version's editor, the document's versions, or back to the form with the fields; a started draft shows on the versions
// - the audit row names the document key and version and holds no words

const id = '00000000-0000-4000-8000-000000000001';
const other = '00000000-0000-4000-8000-000000000002';
const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;
const base = {
  intent: 'save',
  title: 'Marketplace terms',
  body: JSON.stringify(paragraphs('The terms.')),
};

function version(overrides: Partial<LegalDocument> = {}): LegalDocument {
  return {
    id,
    doc: 'terms',
    version: 2,
    title: 'Terms v2',
    body: paragraphs('Second.'),
    status: 'published',
    publishedAt: new Date('2026-11-02T15:00:00Z'),
    createdAt: new Date('2026-11-01T15:00:00Z'),
    ...overrides,
  };
}

describe('buildLegalDocRows', () => {
  it('lists the fixed documents first, with none stored, then each stored waiver', () => {
    const rows = buildLegalDocRows([
      {
        doc: 'waiver-kayak',
        versions: 2,
        latestVersion: 2,
        publishedVersion: 2,
      },
      { doc: 'terms', versions: 3, latestVersion: 3, publishedVersion: 2 },
    ]);
    expect(rows.map((row) => row.doc)).toEqual([
      'terms',
      'privacy',
      'host-agreement',
      'waiver-kayak',
    ]);
    expect(rows.map((row) => row.state)).toEqual([
      'Version 2 is live. Draft version 3 is waiting.',
      'No version yet.',
      'No version yet.',
      'Version 2 is live.',
    ]);
    expect(rows[3]?.href).toBe('/ops/editorial/legal/waiver-kayak');
  });

  it('says nothing is published when only drafts exist', () => {
    const [terms] = buildLegalDocRows([
      { doc: 'terms', versions: 1, latestVersion: 1, publishedVersion: null },
    ]);
    expect(terms?.state).toBe(
      'Nothing published yet. Draft version 1 is waiting.',
    );
  });
});

describe('legalDocLabel and parseLegalDocParam', () => {
  it.each([
    ['terms', 'Marketplace terms'],
    ['privacy', 'Privacy policy'],
    ['host-agreement', 'Host agreement'],
    ['waiver-kayak', 'Waiver: waiver-kayak'],
  ])('%s is labelled %s', (doc, label) => {
    expect(legalDocLabel(doc)).toBe(label);
  });

  it.each([
    ['terms', 'terms'],
    ['waiver-kayak', 'waiver-kayak'],
    ['Terms', null],
    ['waiver-', null],
    ['x'.repeat(editorialLimits.slug + 1), null],
  ])('%s is %s', (raw, expected) => {
    expect(parseLegalDocParam(raw)).toBe(expected);
  });
});

describe('mayStartDraft', () => {
  it.each([
    ['a fixed document with none stored', 'terms', [], true],
    ['the host agreement with none stored', 'host-agreement', [], true],
    ['a waiver that has a version', 'waiver-kayak', ['waiver-kayak'], true],
    ['a waiver nothing stores', 'waiver-kayak', ['terms'], false],
    ['a valid key typed from nothing', 'waiver-new-thing', [], false],
  ])('%s is %s', (_label, doc, stored, expected) => {
    expect(mayStartDraft(doc, stored)).toBe(expected);
  });
});

describe('draftStart and findVersion', () => {
  it('starts from the newest version and from nothing without one', () => {
    const newest = version({ version: 3, title: 'Newest' });
    expect(draftStart([newest, version()])).toEqual({
      title: 'Newest',
      body: newest.body,
    });
    expect(draftStart([])).toEqual({ title: '', body: null });
  });

  it('finds a version by id in either case and nothing for another', () => {
    const versions = [version()];
    expect(findVersion(versions, id.toUpperCase())).toBe(versions[0]);
    expect(findVersion(versions, other)).toBeNull();
    expect(findVersion(versions, 'nope')).toBeNull();
  });
});

describe('buildLegalVersionRows', () => {
  it('links only a draft to its editor and shows when a published one went live', () => {
    const rows = buildLegalVersionRows([
      version({ id: other, version: 3, status: 'draft', publishedAt: null }),
      version(),
    ]);
    expect(rows[0]).toMatchObject({
      statusLabel: 'Draft',
      publishedLabel: '',
      editHref: `/ops/editorial/legal/terms/${other}`,
    });
    expect(rows[1]).toMatchObject({ statusLabel: 'Published', editHref: null });
    expect(rows[1]?.publishedLabel).not.toBe('');
  });
});

describe('parseLegalForm', () => {
  it('reads the title, the document and the button', () => {
    expect(parseLegalForm(form(base))).toMatchObject({
      ok: true,
      value: { title: 'Marketplace terms', intent: 'save' },
    });
  });

  it('publishes a version that has text', () => {
    expect(parseLegalForm(form({ ...base, intent: 'publish' }))).toMatchObject({
      ok: true,
      value: { intent: 'publish' },
    });
  });

  it('refuses to publish a body with no text but saves it as a draft', () => {
    const empty = { ...base, body: JSON.stringify(emptyDoc) };
    expect(parseLegalForm(form({ ...empty, intent: 'publish' }))).toEqual({
      ok: false,
      fields: ['body'],
    });
    expect(parseLegalForm(form(empty)).ok).toBe(true);
  });

  it.each([
    ['no title', { title: ' ' }, ['title']],
    [
      'a title over the limit',
      { title: 't'.repeat(editorialLimits.title + 1) },
      ['title'],
    ],
    ['a body that is not a document', { body: '"words"' }, ['body']],
    ['no body', { body: '' }, ['body']],
  ])('names the field for %s', (_label, fields, named) => {
    expect(parseLegalForm(form({ ...base, ...fields }))).toEqual({
      ok: false,
      fields: named,
    });
  });

  it('refuses an over-long field unread, and a form with no known button changes nothing', () => {
    expect(parseLegalForm(form({ ...base, title: 't'.repeat(5000) }))).toEqual({
      ok: false,
      fields: ['title'],
    });
    expect(parseLegalForm(form({ ...base, intent: 'delete' }))).toEqual({
      ok: false,
      fields: [],
    });
  });
});

describe('what a save and its publish come to', () => {
  it.each([
    ['publish', 'saved', true],
    ['publish', 'not_a_draft', false],
    ['save', 'saved', false],
    ['save', 'not_a_draft', false],
  ] as const)(
    'the %s button after a save that is %s publishes: %s',
    (intent, status, publishes) => {
      expect(wantsPublish(intent, { status })).toBe(publishes);
    },
  );

  it.each([
    ['save', { status: 'saved' }, undefined, 'saved'],
    ['save', { status: 'not_a_draft' }, undefined, 'not_a_draft'],
    ['publish', { status: 'not_a_draft' }, undefined, 'not_a_draft'],
    ['publish', { status: 'saved' }, { status: 'published' }, 'published'],
    ['publish', { status: 'saved' }, { status: 'superseded' }, 'superseded'],
    ['publish', { status: 'saved' }, { status: 'not_a_draft' }, 'not_a_draft'],
  ] as const)(
    '%s with %j then %j is %s',
    (intent, edited, published, status) => {
      expect(legalOutcomeFor(intent, edited, published)).toEqual({ status });
    },
  );

  it('says so when a publish was meant and not made', () => {
    expect(() =>
      legalOutcomeFor('publish', { status: 'saved' }, undefined),
    ).toThrow('The publish was not made');
  });
});

describe('legalRedirect', () => {
  it.each([
    [
      'a saved draft stays in its editor',
      { id },
      { status: 'saved' },
      `/ops/editorial/legal/terms/${id}?notice=saved`,
    ],
    [
      'a published one shows on the versions',
      { id },
      { status: 'published' },
      '/ops/editorial/legal/terms?notice=published',
    ],
    [
      'a started draft shows on the versions',
      null,
      { status: 'drafted' },
      '/ops/editorial/legal/terms?notice=drafted',
    ],
    [
      'a key no document has leaves for the documents',
      null,
      { status: 'unknown_document' },
      '/ops/editorial/legal',
    ],
    [
      'a final version shows on the versions',
      { id },
      { status: 'not_a_draft' },
      '/ops/editorial/legal/terms?notice=not_a_draft',
    ],
    [
      'a superseded draft shows on the versions',
      { id },
      { status: 'superseded' },
      '/ops/editorial/legal/terms?notice=superseded',
    ],
    [
      'a refused edit returns to the editor',
      { id },
      { status: 'invalid', fields: ['body'] },
      `/ops/editorial/legal/terms/${id}?notice=invalid&fields=body`,
    ],
    [
      'a refused new draft returns to the versions form',
      null,
      { status: 'invalid', fields: ['title'] },
      '/ops/editorial/legal/terms?notice=invalid&fields=title',
    ],
  ] as const)('%s', (_label, editing, outcome, href) => {
    expect(legalRedirect('terms', editing, outcome)).toBe(href);
  });
});

describe('legalAuditEntry', () => {
  it('names the user, the version and its document, and no words', () => {
    expect(legalAuditEntry(other, 'published', version())).toEqual({
      actorKind: 'user',
      actorId: other,
      action: 'legal_document.published',
      subjectKind: 'legal_document',
      subjectId: id,
      details: { doc: 'terms', version: 2 },
    });
  });
});
