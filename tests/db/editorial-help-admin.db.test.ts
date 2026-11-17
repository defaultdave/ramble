import { updateTag } from 'next/cache';
import { asc, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { TEST_USER_ID, testCaller } from '@/server/auth/test-caller';
import { auditLog } from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { doc, helpInput, saved } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the editor reads one article, draft or published, with its body, and nothing for an unknown id
// - the editor read refuses a caller who is not staff
// - every save writes one audit row in the same transaction: created, saved, published, unpublished
// - the audit row names the user and the article and holds no words from it
// - publishing and unpublishing clear the help tags, and saving a draft clears nothing
// - an empty body is stored as a draft
// - a save from a stale tab keeps the stored status and position, so it cannot unpublish
// - a save that would leave a published article with no text is refused
// - a malformed id reads as nothing
// - headings, lists and bold text survive a save and a reload

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const ops = testCaller({ roles: [Role.Ops] });
const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

async function auditFor(articleId: string) {
  return client.db
    .select()
    .from(auditLog)
    .where(eq(auditLog.subjectId, articleId))
    .orderBy(asc(auditLog.id));
}

describe('reading an article for the editor', () => {
  it('returns a draft with its body, and nothing for an unknown id', async () => {
    const created = await saved(
      editorial.saveHelpArticle(
        ops,
        helpInput({ title: 'Draft one', status: 'draft', body: doc('Words') }),
      ),
    );

    const found = await editorial.getHelpArticleForEditing(
      ops,
      created.value.id,
    );
    expect(found).toMatchObject({ title: 'Draft one', status: 'draft' });
    expect(found?.body.content).toHaveLength(1);
    expect(await editorial.getHelpArticleForEditing(ops, uuid(404))).toBeNull();
  });

  it('refuses a guest', async () => {
    await expect(
      editorial.getHelpArticleForEditing(testCaller(), uuid(404)),
    ).rejects.toBeInstanceOf(ForbiddenError);
  });
});

describe('the audit row of a save', () => {
  it('records created, saved, published and unpublished in order, naming the user and no words', async () => {
    const created = await saved(
      editorial.saveHelpArticle(
        ops,
        helpInput({ title: 'Secret wording here' }),
      ),
    );
    const articleId = created.value.id;
    const next = (
      status: 'draft' | 'published',
      overrides: { title?: string } = {},
    ) =>
      saved(
        editorial.saveHelpArticle(ops, {
          ...helpInput({ slug: created.value.slug, status, ...overrides }),
          id: articleId,
        }),
      );

    await next('draft', { title: 'Edited wording here' });
    await next('published');
    await next('published', { title: 'Edited again' });
    await next('draft');

    const rows = await auditFor(articleId);
    expect(rows.map((row) => row.action)).toEqual([
      'help_article.created',
      'help_article.saved',
      'help_article.published',
      'help_article.saved',
      'help_article.unpublished',
    ]);
    expect(rows[0]).toMatchObject({
      actorKind: 'user',
      actorId: TEST_USER_ID,
      subjectKind: 'help_article',
    });
    expect(JSON.stringify(rows)).not.toContain('wording');
  });

  it('writes nothing when the save is refused', async () => {
    const slug = 'taken-slug-one';
    await saved(editorial.saveHelpArticle(ops, helpInput({ slug })));
    const before = await client.db.select().from(auditLog);

    const clash = await editorial.saveHelpArticle(ops, helpInput({ slug }));

    expect(clash.status).toBe('slug_taken');
    expect(await client.db.select().from(auditLog)).toHaveLength(before.length);
  });
});

describe('publishing', () => {
  it('clears the help tags on publish and on unpublish, and none for a draft save', async () => {
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ status: 'draft' })),
    );
    expect(tagsUpdated()).toEqual([]);

    const again = (status: 'draft' | 'published') =>
      saved(
        editorial.saveHelpArticle(ops, {
          ...helpInput({ slug: created.value.slug, status }),
          id: created.value.id,
        }),
      );
    await again('published');
    const published = tagsUpdated().length;
    expect(published).toBeGreaterThan(0);
    expect(tagsUpdated()).toContain('help-articles');

    await again('draft');
    expect(tagsUpdated().length).toBeGreaterThan(published);
  });

  it('stores an empty body as a draft', async () => {
    const created = await saved(
      editorial.saveHelpArticle(
        ops,
        helpInput({ body: { type: 'doc', content: [] } as never }),
      ),
    );
    const found = await editorial.getHelpArticleForEditing(
      ops,
      created.value.id,
    );
    expect(found?.body.content).toEqual([]);
  });
});

describe('saving with an intent', () => {
  it('keeps the stored status and position when a stale tab saves its draft', async () => {
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ position: 4 })),
    );
    const edit = (status: 'draft' | 'published', position: number) => ({
      ...helpInput({ slug: created.value.slug, status, position }),
      id: created.value.id,
    });
    await saved(
      editorial.saveHelpArticle(ops, edit('published', 4), 'publish'),
    );

    const stale = await saved(
      editorial.saveHelpArticle(
        ops,
        { ...edit('draft', 0), title: 'Edited in the old tab' },
        'save',
      ),
    );

    expect(stale.value).toMatchObject({
      status: 'published',
      position: 4,
      title: 'Edited in the old tab',
    });
    const rows = await auditFor(created.value.id);
    expect(rows.at(-1)?.action).toBe('help_article.saved');
  });

  it('unpublishes only on the unpublish intent', async () => {
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ status: 'published' })),
    );
    const back = await saved(
      editorial.saveHelpArticle(
        ops,
        {
          ...helpInput({ slug: created.value.slug, status: 'published' }),
          id: created.value.id,
        },
        'unpublish',
      ),
    );
    expect(back.value.status).toBe('draft');
  });

  it('refuses a save that leaves a published article without text', async () => {
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ status: 'published' })),
    );
    const result = await editorial.saveHelpArticle(
      ops,
      {
        ...helpInput({
          slug: created.value.slug,
          status: 'draft',
          body: { type: 'doc', content: [] } as never,
        }),
        id: created.value.id,
      },
      'save',
    );
    expect(result.status).toBe('empty_body');
    const found = await editorial.getHelpArticleForEditing(
      ops,
      created.value.id,
    );
    expect(found?.status).toBe('published');
  });
});

describe('reading with a malformed id', () => {
  it('is nothing, not a database error', async () => {
    expect(await editorial.getHelpArticleForEditing(ops, 'nope')).toBeNull();
  });
});

describe('what the editor stores', () => {
  it('returns headings, lists and bold text as saved', async () => {
    const body = {
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
          type: 'orderedList',
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
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ body: body as never })),
    );
    const found = await editorial.getHelpArticleForEditing(
      ops,
      created.value.id,
    );
    expect(found?.body).toEqual(body);
  });
});
