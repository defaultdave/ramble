import { describe, expect, it } from 'vitest';
import {
  auditFor,
  buildEntryRows,
  entryBody,
  entryRedirect,
  entryOutcomeFor,
  saveLabel,
  toggleIntent,
  entryPath,
  parseEntryForm,
  settleEntry,
  toggleLabel,
} from './editorialAdmin';
import type { HelpArticle } from './editorial';
import { parseAuditEntry } from './audit';
import type { RichTextDoc } from './richText/format';

// Behaviours under test:
// - saving keeps an entry's status, publishing and unpublishing move it
// - a body with no block cannot be published but can be saved as a draft
// - a form with a blank slug takes it from the title, and a refused form names its fields
// - a form with no known intent, a broken body, or an oversized field changes nothing
// - the notice names what the click did
// - a blank address keeps the stored one on an existing article and is made from the title for a new one
// - a body that is not JSON is passed on as text for the schema to refuse, never swallowed
// - the editor's heading, list and bold text reach the saved input whole
// - each outcome of a save has one destination, and the list shows the missing-article notice
// - the seed (no user) writes no audit row, a person writes one
// - the audit action says what happened to the article, and its row holds ids, never words
// - the editor opens on the article's body, or an empty one for a new article
// - a row shows the status and the time the way the other ops lists do

const body = JSON.stringify({
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
});
const emptyBody = JSON.stringify({ type: 'doc', content: [] });
const id = '0f1e2d3c-4b5a-4697-8a9b-0c1d2e3f4a5b';

function form(fields: Record<string, string>) {
  return (name: string) => fields[name];
}

const base = { intent: 'save', title: 'How to cancel', body };

const textDoc: RichTextDoc = {
  type: 'doc',
  content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Hello' }] }],
};
const publishedRow = { status: 'published', position: 4 } as const;
const draftRow = { status: 'draft', position: 4 } as const;
type Input = Parameters<typeof settleEntry>[2];
const text: Input = { status: 'draft', position: 9, body: textDoc };
const empty: Input = { ...text, body: { type: 'doc', content: [] } };

describe('settleEntry', () => {
  it.each([
    [
      'a new article with an intent keeps the form status',
      'publish',
      null,
      text,
      'draft',
      9,
    ],
    [
      'a new article with no intent keeps the form status and position',
      undefined,
      null,
      text,
      'draft',
      9,
    ],
    [
      'an existing article with no intent keeps the form status and position',
      undefined,
      draftRow,
      { ...text, status: 'published' },
      'published',
      9,
    ],
    [
      'a stale tab saving a draft cannot unpublish',
      'save',
      publishedRow,
      text,
      'published',
      4,
    ],
    [
      'publish moves a draft to published',
      'publish',
      draftRow,
      text,
      'published',
      4,
    ],
    [
      'unpublish moves a published article to draft',
      'unpublish',
      publishedRow,
      text,
      'draft',
      4,
    ],
  ] as const)('%s', (_name, intent, stored, input, status, position) => {
    expect(settleEntry(intent, stored, input)).toEqual({
      kind: 'settled',
      status,
      position,
    });
  });

  it.each([
    ['publishing', 'publish', draftRow],
    ['saving a published article', 'save', publishedRow],
    ['a new article published by the form', 'publish', null],
  ] as const)('refuses an empty body when %s', (_name, intent, stored) => {
    expect(
      settleEntry(intent, stored, { ...empty, status: 'published' }),
    ).toEqual({ kind: 'empty_body' });
  });

  it('saves an empty body as a draft and takes down an empty published one', () => {
    expect(settleEntry('save', draftRow, empty)).toMatchObject({
      kind: 'settled',
      status: 'draft',
    });
    expect(settleEntry('unpublish', publishedRow, empty)).toMatchObject({
      kind: 'settled',
      status: 'draft',
    });
  });
});

describe('toggleLabel', () => {
  it.each([
    ['published', 'Unpublish'],
    ['draft', 'Publish'],
    [undefined, 'Publish'],
  ] as const)('%s offers %s', (status, label) => {
    expect(toggleLabel(status)).toBe(label);
  });
});

describe('parseEntryForm', () => {
  it('derives the slug from the title and keeps a draft a draft', () => {
    const parsed = parseEntryForm(form(base));
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        intent: 'save',
        input: { slug: 'how-to-cancel', status: 'draft', summary: null },
      },
    });
  });

  it('carries the id, typed slug, summary and the status the entry has now', () => {
    const parsed = parseEntryForm(
      form({
        ...base,
        id,
        slug: 'cancel',
        summary: 'Short',
        status: 'published',
        position: '3',
      }),
    );
    expect(parsed).toMatchObject({
      ok: true,
      value: {
        input: {
          id,
          slug: 'cancel',
          summary: 'Short',
          status: 'published',
          position: 3,
        },
      },
    });
  });

  it('publishes and unpublishes through the intent', () => {
    expect(parseEntryForm(form({ ...base, intent: 'publish' }))).toMatchObject({
      value: { input: { status: 'published' } },
    });
    expect(
      parseEntryForm(
        form({ ...base, intent: 'unpublish', status: 'published' }),
      ),
    ).toMatchObject({ value: { input: { status: 'draft' } } });
  });

  it('leaves an empty body to the settle rule, which refuses only a published one', () => {
    expect(
      parseEntryForm(form({ ...base, body: emptyBody, intent: 'publish' })),
    ).toMatchObject({ ok: true, value: { input: { status: 'published' } } });
  });

  it.each([
    [
      'a missing title, which leaves no slug to derive',
      { title: '' },
      ['title', 'slug'],
    ],
    ['a slug that is not a slug', { slug: 'Not A Slug' }, ['slug']],
    ['a body that is not JSON', { body: '{oops' }, ['body']],
    [
      'a link the format refuses',
      {
        body: JSON.stringify({
          type: 'doc',
          content: [
            {
              type: 'paragraph',
              content: [
                {
                  type: 'text',
                  text: 'x',
                  marks: [
                    { type: 'link', attrs: { href: 'javascript:alert(1)' } },
                  ],
                },
              ],
            },
          ],
        }),
      },
      ['body'],
    ],
    ['an oversized summary', { summary: 'a'.repeat(301) }, ['summary']],
    ['a field over the raw limit', { title: 'a'.repeat(1001) }, ['title']],
  ])('refuses %s and names the field', (_name, fields, expected) => {
    expect(parseEntryForm(form({ ...base, ...fields }))).toEqual({
      ok: false,
      fields: expected,
    });
  });

  it.each([
    ['no intent', { intent: '' }],
    ['an unknown intent', { intent: 'delete' }],
    ['a position that is not a number', { position: 'x' }],
  ])('refuses %s without naming a field', (_name, fields) => {
    expect(parseEntryForm(form({ ...base, ...fields }))).toEqual({
      ok: false,
      fields: [],
    });
  });
});

describe('buildEntryRows and entryPath', () => {
  it('shows each article with its status and New York time', () => {
    const article = {
      id,
      slug: 'cancel',
      title: 'How to cancel',
      status: 'published',
      updatedAt: new Date('2026-11-17T15:00:00Z'),
    } as HelpArticle;
    const [row] = buildEntryRows([article]);
    expect(row).toMatchObject({ id, slug: 'cancel', status: 'published' });
    expect(row?.updatedLabel).toContain('10:00');
    expect(entryPath(id)).toBe(`/ops/editorial/${id}`);
  });
});

describe('a form with no body field', () => {
  it('is refused, naming the body', () => {
    expect(parseEntryForm(form({ intent: 'save', title: 'T' }))).toEqual({
      ok: false,
      fields: ['body'],
    });
  });
});

describe('entryOutcomeFor', () => {
  it.each([
    [
      { status: 'saved', value: { id } },
      'publish',
      { status: 'saved', id, intent: 'publish' },
    ],
    [{ status: 'slug_taken' }, 'save', { status: 'slug_taken' }],
    [{ status: 'empty_body' }, 'publish', { status: 'empty_body' }],
    [{ status: 'not_found' }, 'unpublish', { status: 'not_found' }],
  ] as const)('turns %j with %s into %j', (result, intent, expected) => {
    expect(entryOutcomeFor(result, intent)).toEqual(expected);
  });
});

describe('a blank address', () => {
  it('keeps the stored address of an existing article', () => {
    expect(
      parseEntryForm(
        form({ ...base, id, slug: '', currentSlug: 'cancel-a-trip' }),
      ),
    ).toMatchObject({ ok: true, value: { input: { slug: 'cancel-a-trip' } } });
  });

  it('is made from the title for a new article, whatever the form carries', () => {
    expect(
      parseEntryForm(form({ ...base, slug: '', currentSlug: 'cancel-a-trip' })),
    ).toMatchObject({ value: { input: { slug: 'how-to-cancel' } } });
  });

  it('gives way to a typed address', () => {
    expect(
      parseEntryForm(
        form({ ...base, id, slug: 'new-one', currentSlug: 'old' }),
      ),
    ).toMatchObject({ value: { input: { slug: 'new-one' } } });
  });
});

describe('what the editor writes', () => {
  it('reaches the saved input whole: heading, bulleted list and bold text', () => {
    const typed = {
      type: 'doc',
      content: [
        {
          type: 'heading',
          attrs: { level: 2 },
          content: [{ type: 'text', text: 'Refunds' }],
        },
        {
          type: 'paragraph',
          content: [
            { type: 'text', text: 'Plain ' },
            { type: 'text', text: 'bold words', marks: [{ type: 'bold' }] },
          ],
        },
        {
          type: 'bulletList',
          content: [
            {
              type: 'listItem',
              content: [
                {
                  type: 'paragraph',
                  content: [{ type: 'text', text: 'One' }],
                },
              ],
            },
          ],
        },
      ],
    };
    const parsed = parseEntryForm(
      form({ ...base, body: JSON.stringify(typed) }),
    );
    expect(parsed).toMatchObject({ ok: true });
    if (parsed.ok) expect(parsed.value.input.body).toEqual(typed);
  });
});

describe('entryRedirect', () => {
  it.each([
    [
      null,
      { status: 'invalid', fields: ['title'] },
      '/ops/editorial/new?notice=invalid&fields=title',
    ],
    [
      id,
      { status: 'invalid', fields: [] },
      `/ops/editorial/${id}?notice=invalid`,
    ],
    [
      null,
      { status: 'slug_taken' },
      '/ops/editorial/new?notice=slug_taken&fields=slug',
    ],
    [
      id,
      { status: 'empty_body' },
      `/ops/editorial/${id}?notice=invalid&fields=body`,
    ],
    [id, { status: 'not_found' }, '/ops/editorial?notice=not_found'],
    [
      null,
      { status: 'saved', id, intent: 'publish' },
      `/ops/editorial/${id}?notice=published`,
    ],
    [
      id,
      { status: 'saved', id, intent: 'save' },
      `/ops/editorial/${id}?notice=saved`,
    ],
    [
      id,
      { status: 'saved', id, intent: 'unpublish' },
      `/ops/editorial/${id}?notice=unpublished`,
    ],
  ] as const)('%s with %j goes to %s', (postedId, outcome, href) => {
    expect(entryRedirect(postedId, outcome)).toBe(href);
  });
});

describe('auditFor', () => {
  it('writes no row for the seed, which saves as no one', () => {
    expect(auditFor(null, undefined, 'published', id)).toBeNull();
  });

  it.each([
    [undefined, 'draft', 'help_article.created'],
    [undefined, 'published', 'help_article.published'],
    ['draft', 'draft', 'help_article.saved'],
    ['draft', 'published', 'help_article.published'],
    ['published', 'published', 'help_article.saved'],
    ['published', 'draft', 'help_article.unpublished'],
  ] as const)('%s to %s is %s', (before, after, action) => {
    expect(auditFor(id, before, after, id)?.action).toBe(action);
  });

  it('names the user and what the save did, and passes the audit schema', () => {
    const row = auditFor(id, 'published', 'draft', id);
    expect(parseAuditEntry(row)).toMatchObject({
      actorKind: 'user',
      action: 'help_article.unpublished',
      subjectKind: 'help_article',
      subjectId: id,
    });
  });
});

describe('entryBody', () => {
  it('is the article body, or an empty document for a new article', () => {
    expect(entryBody({ body: textDoc } as HelpArticle)).toBe(textDoc);
    expect(entryBody(null)).toEqual({ type: 'doc', content: [] });
  });
});

describe('the form buttons', () => {
  it.each([
    [undefined, 'Save draft', 'publish'],
    ['draft', 'Save draft', 'publish'],
    ['published', 'Save changes', 'unpublish'],
  ] as const)('on a %s entry: %s and %s', (status, label, intent) => {
    expect(saveLabel(status)).toBe(label);
    expect(toggleIntent(status)).toBe(intent);
  });
});
