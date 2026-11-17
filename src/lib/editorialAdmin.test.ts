import { describe, expect, it } from 'vitest';
import {
  buildEntryRows,
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
