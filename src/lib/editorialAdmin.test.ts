import { describe, expect, it } from 'vitest';
import {
  auditFor,
  buildEntryRows,
  entryRedirect,
  parseBody,
  saveLabel,
  toggleIntent,
  entryAuditAction,
  entryAuditEntry,
  entryPath,
  parseEntryForm,
  savedNotice,
  statusAfter,
} from './editorialAdmin';
import type { HelpArticle } from './editorial';
import { parseAuditEntry } from './audit';

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

describe('statusAfter', () => {
  it.each([
    ['save', 'draft', 'draft'],
    ['save', 'published', 'published'],
    ['publish', 'draft', 'published'],
    ['unpublish', 'published', 'draft'],
  ] as const)('%s on a %s entry leaves it %s', (intent, current, expected) => {
    expect(statusAfter(intent, current)).toBe(expected);
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

  it('saves an empty body as a draft but refuses to publish it', () => {
    expect(parseEntryForm(form({ ...base, body: emptyBody }))).toMatchObject({
      ok: true,
    });
    expect(
      parseEntryForm(form({ ...base, body: emptyBody, intent: 'publish' })),
    ).toEqual({ ok: false, fields: ['body'] });
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

describe('savedNotice', () => {
  it.each([
    ['save', 'saved'],
    ['publish', 'published'],
    ['unpublish', 'unpublished'],
  ] as const)('%s is the %s notice', (intent, notice) => {
    expect(savedNotice(intent)).toBe(notice);
  });
});

describe('entryAuditAction', () => {
  it.each([
    [undefined, 'draft', 'help_article.created'],
    [undefined, 'published', 'help_article.published'],
    ['draft', 'draft', 'help_article.saved'],
    ['draft', 'published', 'help_article.published'],
    ['published', 'published', 'help_article.saved'],
    ['published', 'draft', 'help_article.unpublished'],
  ] as const)('%s to %s is %s', (before, after, action) => {
    expect(entryAuditAction(before, after)).toBe(action);
  });
});

describe('entryAuditEntry', () => {
  it('names the user and passes the audit schema', () => {
    const user = entryAuditEntry(id, 'help_article.saved', id);
    expect(parseAuditEntry(user)).toMatchObject({
      actorKind: 'user',
      subjectKind: 'help_article',
      subjectId: id,
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

describe('parseBody', () => {
  it.each([
    ['nothing', undefined, undefined],
    ['JSON', '{"a":1}', { a: 1 }],
    ['text that is not JSON, as it is', '{oops', '{oops'],
  ])('reads %s', (_name, raw, expected) => {
    expect(parseBody(raw)).toEqual(expected);
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
  ] as const)('%s with %j goes to %s', (postedId, outcome, href) => {
    expect(entryRedirect(postedId, outcome)).toBe(href);
  });
});

describe('auditFor', () => {
  it('writes no row for the seed, which saves as no one', () => {
    expect(auditFor(null, undefined, 'published', id)).toBeNull();
  });

  it('names the user and what the save did', () => {
    expect(auditFor('u1', 'published', 'draft', id)).toMatchObject({
      action: 'help_article.unpublished',
      subjectId: id,
    });
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
