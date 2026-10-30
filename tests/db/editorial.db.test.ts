import { updateTag } from 'next/cache';
import { ZodError } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { editorialLimits } from '@/lib/editorial';
import { homeLimits } from '@/lib/pages/home';
import { ForbiddenError, Role, anonymousCaller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  categories,
  collectionItems,
  collections,
  experiences,
  helpArticles,
  homeModules,
  hosts,
  legalAcceptances,
  legalDocuments,
  neighborhoods,
  pages,
  settings,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - the database refuses each row the Zod schemas refuse: bad slugs, blank or long text, a stored
//   document that is not a rich-text root or is over the limit, a publication time that disagrees
//   with the status, positions out of range or repeated, two gift guides, both or neither page target
// - the database refuses a timestamp Zod cannot read as a Date, in each table that has one
// - the database refuses settings out of range and a second settings row, and the migration seeds one
// - a published legal version cannot be edited, deleted, re-keyed, or published under a newer one;
//   an acceptance names a published version only, is unique per subject and version, and never changes
// - an experience can name a legal document as its waiver, and an unknown one is refused
// - the home Picks read finds the Picks it is asked for however many others are published, reads their first entries and a count of the rest, and never the intro
// - guest reads return published content only; collection entries a guest cannot see are left out;
//   a home module whose collection is a draft is left out; a malformed key is null
// - a stored document that needs repair is repaired on read
// - every staff read and write refuses a guest, a host owner, and nobody signed in, and accepts ops and admin
// - saving a collection creates or replaces it with its entries in order, refuses a taken slug, a second
//   gift guide, an unknown experience, and a wrong id or kind, stamps the publication time once
// - saving the home page replaces the whole list in order and refuses an unknown collection
// - saving page copy creates or replaces it and refuses an unknown category or neighborhood
// - saving a help article creates or replaces it and refuses a taken slug and an unknown id
// - a save invalidates the tags of what was and is published, and nothing for a draft that stays a draft
// - input the Zod schemas refuse writes nothing
// - a legal version is numbered one above the last, a draft is editable, publishing makes it current and
//   invalidates its page, a stale draft is superseded
// - a document at the Zod size limit is stored
// - the settings update changes only the named settings, invalidates the settings tag, and a guest sees no rate

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let legal: typeof import('@/server/db/legal');
let settingsApi: typeof import('@/server/db/settings');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  legal = await import('@/server/db/legal');
  settingsApi = await import('@/server/db/settings');
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
const admin = testCaller({ roles: [Role.Admin] });
const guest = testCaller();
const hostOwner = testCaller({ roles: [Role.HostOwner], hostIds: ['h'] });

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

function uuid(n: number) {
  return `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
}

function doc(text = 'Hello') {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  } as never;
}

const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

async function insertOne<T>(rows: Promise<T[]>): Promise<T> {
  const [row] = await rows;
  if (!row) throw new Error('insert returned no row');
  return row;
}

async function insertCategory(slug = unique('category')) {
  return insertOne(
    client.db.insert(categories).values({ slug, name: slug }).returning(),
  );
}

async function insertNeighborhood(slug = unique('neighborhood')) {
  return insertOne(
    client.db.insert(neighborhoods).values({ slug, name: slug }).returning(),
  );
}

type Parents = {
  hostId: string;
  categoryId: string;
  neighborhoodId: string;
  cancellationTierId: string;
};

let sharedParents: Promise<Parents> | undefined;

function parents(): Promise<Parents> {
  sharedParents ??= (async () => {
    const host = await insertOne(
      client.db
        .insert(hosts)
        .values({
          slug: unique('host'),
          name: 'Host',
          timeZone: 'America/New_York',
        })
        .returning(),
    );
    const tier = await client.db.query.cancellationTiers.findFirst();
    if (!tier) throw new Error('The migration inserts the tiers');
    return {
      hostId: host.id,
      categoryId: (await insertCategory()).id,
      neighborhoodId: (await insertNeighborhood()).id,
      cancellationTierId: tier.id,
    };
  })();
  return sharedParents;
}

async function insertExperience(
  status: 'draft' | 'live' | 'paused' = 'live',
  overrides: Partial<typeof experiences.$inferInsert> = {},
) {
  return insertOne(
    client.db
      .insert(experiences)
      .values({
        ...(await parents()),
        slug: unique('experience'),
        name: unique('Experience'),
        status,
        ...overrides,
      })
      .returning(),
  );
}

function collectionInput(
  overrides: Partial<import('@/lib/editorial').CollectionInput> = {},
): import('@/lib/editorial').CollectionInput {
  return {
    kind: 'pick',
    slug: unique('pick'),
    title: 'A pick',
    summary: null,
    intro: null,
    status: 'draft',
    items: [],
    ...overrides,
  };
}

function helpInput(
  overrides: Partial<import('@/lib/editorial').HelpArticleInput> = {},
): import('@/lib/editorial').HelpArticleInput {
  return {
    slug: unique('help'),
    title: 'How do I cancel?',
    summary: null,
    position: 0,
    status: 'draft',
    body: doc(),
    ...overrides,
  };
}

async function saved<T extends { status: string }>(
  result: Promise<T>,
): Promise<Extract<T, { status: 'saved' | 'published' }>> {
  const outcome = await result;
  if (outcome.status !== 'saved' && outcome.status !== 'published') {
    throw new Error(`Expected a save, got ${outcome.status}`);
  }
  return outcome as Extract<T, { status: 'saved' | 'published' }>;
}

describe('constraints on editorial tables', () => {
  const collection = (overrides: Record<string, unknown> = {}) => ({
    kind: 'pick' as const,
    slug: unique('pick'),
    title: 'A pick',
    ...overrides,
  });
  const helpArticle = (overrides: Record<string, unknown> = {}) => ({
    slug: unique('help'),
    title: 'Help',
    body: doc(),
    ...overrides,
  });
  const aTime = new Date('2026-10-26T12:00:00Z');

  it.each([
    [
      'a slug with capitals',
      collection({ slug: 'Bad Slug' }),
      'collections_slug_shape',
    ],
    [
      'a slug over the limit',
      collection({ slug: 'a'.repeat(editorialLimits.slug + 1) }),
      'collections_slug_shape',
    ],
    ['a blank title', collection({ title: '  ' }), 'collections_title'],
    [
      'a title over the limit',
      collection({ title: 'a'.repeat(editorialLimits.title + 1) }),
      'collections_title',
    ],
    ['a blank summary', collection({ summary: '' }), 'collections_summary'],
    [
      'an intro that is a list',
      collection({ intro: [] }),
      'collections_intro_is_rich_text',
    ],
    [
      'an intro that is not a doc node',
      collection({ intro: { type: 'paragraph', content: [] } }),
      'collections_intro_is_rich_text',
    ],
    [
      'an intro with no content',
      collection({ intro: { type: 'doc' } }),
      'collections_intro_is_rich_text',
    ],
    [
      'an intro over the stored size limit',
      collection({
        intro: doc('a'.repeat(editorialLimits.richTextStoredBytes)),
      }),
      'collections_intro_is_rich_text',
    ],
    [
      'published with no publication time',
      collection({ status: 'published' }),
      'collections_published_at_matches_status',
    ],
    [
      'a draft with a publication time',
      collection({ status: 'draft', publishedAt: aTime }),
      'collections_published_at_matches_status',
    ],
  ])('collections refuse %s', async (_name, row, constraint) => {
    await expect(
      client.db.insert(collections).values(row as never),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('collections refuse a repeated slug', async () => {
    const slug = unique('twice');
    await client.db.insert(collections).values(collection({ slug }) as never);

    await expect(
      client.db.insert(collections).values(collection({ slug }) as never),
    ).rejects.toMatchObject({
      cause: { constraint: 'collections_slug_unique' },
    });
  });

  describe('collection entries', () => {
    let collectionId: string;
    let experienceId: string;

    beforeAll(async () => {
      collectionId = (
        await insertOne(
          client.db
            .insert(collections)
            .values(collection() as never)
            .returning(),
        )
      ).id;
      experienceId = (await insertExperience()).id;
      await client.db
        .insert(collectionItems)
        .values({ collectionId, experienceId, position: 0 });
    });

    it.each([
      [
        'a negative position',
        { position: -1 },
        'collection_items_position_in_range',
      ],
      [
        'a position at the limit',
        { position: editorialLimits.collectionItems },
        'collection_items_position_in_range',
      ],
      [
        'a position already taken',
        { position: 0 },
        'collection_items_position_unique',
      ],
      ['a blank note', { position: 1, note: ' ' }, 'collection_items_note'],
      [
        'a note over the limit',
        { position: 1, note: 'a'.repeat(editorialLimits.note + 1) },
        'collection_items_note',
      ],
      [
        'the same experience again',
        { position: 2, experienceId: 'same' },
        'collection_items_experience_unique',
      ],
      [
        'an experience that does not exist',
        { position: 3, experienceId: uuid(9) },
        'collection_items_experience_id_experiences_id_fk',
      ],
    ])('refuse %s', async (_name, change, constraint) => {
      const values = {
        collectionId,
        experienceId: (await insertExperience()).id,
        ...change,
      };
      if (values.experienceId === 'same') values.experienceId = experienceId;

      await expect(
        client.db.insert(collectionItems).values(values),
      ).rejects.toMatchObject({ cause: { constraint } });
    });

    it('restrict deleting an experience that a collection lists', async () => {
      await expect(
        client.db.delete(experiences).where(eq(experiences.id, experienceId)),
      ).rejects.toMatchObject({
        cause: {
          constraint: 'collection_items_experience_id_experiences_id_fk',
        },
      });
    });
  });

  describe('home modules', () => {
    const homeModule = (overrides: Record<string, unknown> = {}) => ({
      position: 0,
      kind: 'hero_search' as const,
      ...overrides,
    });

    it.each([
      [
        'a negative position',
        homeModule({ position: -1 }),
        'home_modules_position_in_range',
      ],
      [
        'a position at the limit',
        homeModule({ position: editorialLimits.homeModules }),
        'home_modules_position_in_range',
      ],
      ['a blank heading', homeModule({ heading: '' }), 'home_modules_heading'],
      [
        'a body that is not a document',
        homeModule({ body: { type: 'text' } }),
        'home_modules_body_is_rich_text',
      ],
      [
        'a collection on a module that shows none',
        homeModule({ collectionId: 'a-collection' }),
        'home_modules_collection_only_where_shown',
      ],
      [
        'a collection that does not exist',
        homeModule({ kind: 'picks', collectionId: uuid(9) }),
        'home_modules_collection_kind_fk',
      ],
    ])('refuse %s', async (_name, row, constraint) => {
      const values = { ...row } as Record<string, unknown>;
      if (values.collectionId === 'a-collection') {
        values.collectionId = (
          await insertOne(
            client.db
              .insert(collections)
              .values(collection() as never)
              .returning(),
          )
        ).id;
      }

      await expect(
        client.db.insert(homeModules).values(values as never),
      ).rejects.toMatchObject({ cause: { constraint } });
    });

    it('refuse a position used twice', async () => {
      await client.db.delete(homeModules);
      await client.db.insert(homeModules).values(homeModule());

      await expect(
        client.db.insert(homeModules).values(homeModule({ kind: 'this_week' })),
      ).rejects.toMatchObject({
        cause: { constraint: 'home_modules_position_unique' },
      });
      await client.db.delete(homeModules);
    });
  });

  describe('pages', () => {
    it('refuse a row with both targets and a row with none', async () => {
      const category = await insertCategory();
      const neighborhood = await insertNeighborhood();

      for (const row of [
        { categoryId: category.id, neighborhoodId: neighborhood.id },
        {},
      ]) {
        await expect(client.db.insert(pages).values(row)).rejects.toMatchObject(
          {
            cause: { constraint: 'pages_one_target' },
          },
        );
      }
    });

    it('refuse a second row for the same category or neighborhood', async () => {
      const category = await insertCategory();
      const neighborhood = await insertNeighborhood();
      await client.db.insert(pages).values({ categoryId: category.id });
      await client.db.insert(pages).values({ neighborhoodId: neighborhood.id });

      await expect(
        client.db.insert(pages).values({ categoryId: category.id }),
      ).rejects.toMatchObject({
        cause: { constraint: 'pages_category_unique' },
      });
      await expect(
        client.db.insert(pages).values({ neighborhoodId: neighborhood.id }),
      ).rejects.toMatchObject({
        cause: { constraint: 'pages_neighborhood_unique' },
      });
    });

    it.each([
      ['a blank heading', { heading: ' ' }, 'pages_heading'],
      [
        'a meta description over the limit',
        { metaDescription: 'a'.repeat(editorialLimits.metaDescription + 1) },
        'pages_meta_description',
      ],
      [
        'an intro that is not a document',
        { intro: [] },
        'pages_intro_is_rich_text',
      ],
      [
        'a body that is not a document',
        { body: {} },
        'pages_body_is_rich_text',
      ],
      [
        'published with no time',
        { status: 'published' },
        'pages_published_at_matches_status',
      ],
    ])('refuse %s', async (_name, change, constraint) => {
      const category = await insertCategory();

      await expect(
        client.db
          .insert(pages)
          .values({ categoryId: category.id, ...change } as never),
      ).rejects.toMatchObject({ cause: { constraint } });
    });
  });

  describe('help articles', () => {
    it.each([
      [
        'a slug with capitals',
        helpArticle({ slug: 'Bad' }),
        'help_articles_slug_shape',
      ],
      ['a blank title', helpArticle({ title: '' }), 'help_articles_title'],
      [
        'a blank summary',
        helpArticle({ summary: ' ' }),
        'help_articles_summary',
      ],
      [
        'a body that is not a document',
        helpArticle({ body: [] }),
        'help_articles_body_is_rich_text',
      ],
      [
        'a position below zero',
        helpArticle({ position: -1 }),
        'help_articles_position_in_range',
      ],
      [
        'a position past the limit',
        helpArticle({ position: editorialLimits.helpPosition + 1 }),
        'help_articles_position_in_range',
      ],
      [
        'a draft with a publication time',
        helpArticle({ publishedAt: aTime }),
        'help_articles_published_at_matches_status',
      ],
    ])('refuse %s', async (_name, row, constraint) => {
      await expect(
        client.db.insert(helpArticles).values(row as never),
      ).rejects.toMatchObject({ cause: { constraint } });
    });

    it('refuse a repeated slug', async () => {
      const slug = unique('help-twice');
      await client.db
        .insert(helpArticles)
        .values(helpArticle({ slug }) as never);

      await expect(
        client.db.insert(helpArticles).values(helpArticle({ slug }) as never),
      ).rejects.toMatchObject({
        cause: { constraint: 'help_articles_slug_unique' },
      });
    });
  });
});

describe('timestamps in the editorial tables', () => {
  it.each([
    'infinity',
    '-infinity',
    '0999-12-31 23:59:59+00',
    '10000-01-01 00:00:00+00',
    '0044-03-15 00:00:00+00 BC',
  ])('refuse %s, which Zod cannot read as a Date', async (instant) => {
    const emptyDoc = '{"type":"doc","content":[]}';
    const attempts = [
      [
        'collections_dates_in_range',
        sql`INSERT INTO collections (kind, slug, title, created_at) VALUES ('pick', ${unique('range')}, 'T', ${instant}::timestamptz)`,
      ],
      [
        'help_articles_dates_in_range',
        sql`INSERT INTO help_articles (slug, title, body, updated_at) VALUES (${unique('range')}, 'T', ${emptyDoc}::jsonb, ${instant}::timestamptz)`,
      ],
      [
        'legal_documents_dates_in_range',
        sql`INSERT INTO legal_documents (doc, version, title, body, created_at) VALUES ('terms', 1, 'T', ${emptyDoc}::jsonb, ${instant}::timestamptz)`,
      ],
      [
        'settings_updated_at_in_range',
        sql`UPDATE settings SET updated_at = ${instant}::timestamptz`,
      ],
    ] as const;

    for (const [constraint, statement] of attempts) {
      await expect(client.db.execute(statement)).rejects.toMatchObject({
        cause: { constraint },
      });
    }
  });
});

/** The only way a published row exists: written as a draft, then published, as the guard requires. */
async function insertPublishedLegal(values: Record<string, unknown>) {
  const draft = await insertOne(
    client.db
      .insert(legalDocuments)
      .values({ ...values, status: 'draft', publishedAt: null } as never)
      .returning(),
  );
  return insertOne(
    client.db
      .update(legalDocuments)
      .set({
        status: 'published',
        publishedAt: new Date('2026-10-01T00:00:00Z'),
      })
      .where(eq(legalDocuments.id, draft.id))
      .returning(),
  );
}

describe('legal documents and acceptances in the database', () => {
  const version = (overrides: Record<string, unknown> = {}) => ({
    doc: 'terms',
    version: 1,
    title: 'Terms',
    body: doc(),
    ...overrides,
  });

  it.each([
    ['a capitalised key', { doc: 'Terms' }, 'legal_documents_doc_key'],
    ['a bare waiver key', { doc: 'waiver' }, 'legal_documents_doc_key'],
    ['an unknown key', { doc: 'cookies' }, 'legal_documents_doc_key'],
    [
      'a key over the length limit',
      { doc: `waiver-${'a'.repeat(editorialLimits.slug)}` },
      'legal_documents_doc_key',
    ],
    ['version zero', { version: 0 }, 'legal_documents_version_positive'],
    ['a blank title', { title: ' ' }, 'legal_documents_title'],
    [
      'a body that is a list',
      { body: [] },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body whose root is not a doc node',
      { body: { type: 'paragraph', content: [] } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body with no root type',
      { body: { content: [] } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a body with no content',
      { body: { type: 'doc' } },
      'legal_documents_body_is_rich_text',
    ],
    [
      'a draft with a publication time',
      { publishedAt: new Date('2026-10-01T00:00:00Z') },
      'legal_documents_published_at_matches_status',
    ],
  ])('refuse %s', async (_name, change, constraint) => {
    await expect(
      client.db.insert(legalDocuments).values(version(change) as never),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuse a version number used twice for one document', async () => {
    await client.db
      .insert(legalDocuments)
      .values(version({ doc: 'waiver-dup' }) as never);

    await expect(
      client.db
        .insert(legalDocuments)
        .values(version({ doc: 'waiver-dup' }) as never),
    ).rejects.toMatchObject({
      cause: { constraint: 'legal_documents_doc_version_unique' },
    });
  });

  describe('a version written as published', () => {
    const asPublished = (overrides: Record<string, unknown>) =>
      client.db.insert(legalDocuments).values(
        version({
          status: 'published',
          publishedAt: new Date('2026-10-01T00:00:00Z'),
          ...overrides,
        }) as never,
      );

    it('is refused when nothing is published yet', async () => {
      await expect(
        asPublished({ doc: 'waiver-insert-first' }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
    });

    it('is refused below the current version and when back-dated', async () => {
      await insertPublishedLegal(
        version({ doc: 'waiver-insert-below', version: 5 }),
      );

      await expect(
        asPublished({ doc: 'waiver-insert-below', version: 3 }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
      await expect(
        asPublished({
          doc: 'waiver-insert-below',
          version: 6,
          publishedAt: new Date('2001-01-01T00:00:00Z'),
        }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining('starts as a draft') as string,
        },
      });
    });
  });

  describe('a published version', () => {
    let publishedId: string;

    beforeAll(async () => {
      publishedId = (
        await insertPublishedLegal(version({ doc: 'privacy', version: 1 }))
      ).id;
    });

    it.each([
      [
        'edited',
        () =>
          client.db
            .update(legalDocuments)
            .set({ title: 'Changed' })
            .where(eq(legalDocuments.id, publishedId)),
      ],
      [
        'unpublished',
        () =>
          client.db
            .update(legalDocuments)
            .set({ status: 'draft', publishedAt: null })
            .where(eq(legalDocuments.id, publishedId)),
      ],
      [
        'deleted',
        () =>
          client.db
            .delete(legalDocuments)
            .where(eq(legalDocuments.id, publishedId)),
      ],
    ])('cannot be %s', async (_name, attempt) => {
      await expect(attempt()).rejects.toMatchObject({
        cause: { message: expect.stringContaining('is final') as string },
      });
    });
  });

  describe('a draft', () => {
    it('can be edited and deleted, but not re-keyed or renumbered', async () => {
      const draft = await insertOne(
        client.db
          .insert(legalDocuments)
          .values(version({ doc: 'waiver-draft-rules' }) as never)
          .returning(),
      );

      await client.db
        .update(legalDocuments)
        .set({ title: 'Edited' })
        .where(eq(legalDocuments.id, draft.id));
      for (const change of [{ doc: 'waiver-other' }, { version: 2 }]) {
        await expect(
          client.db
            .update(legalDocuments)
            .set(change)
            .where(eq(legalDocuments.id, draft.id)),
        ).rejects.toMatchObject({
          cause: {
            message: expect.stringContaining('keeps its document') as string,
          },
        });
      }
      await client.db
        .delete(legalDocuments)
        .where(eq(legalDocuments.id, draft.id));
    });

    it('cannot be published under a newer published version', async () => {
      const older = await insertOne(
        client.db
          .insert(legalDocuments)
          .values(version({ doc: 'waiver-order', version: 1 }) as never)
          .returning(),
      );
      await insertPublishedLegal(version({ doc: 'waiver-order', version: 2 }));

      await expect(
        client.db
          .update(legalDocuments)
          .set({
            status: 'published',
            publishedAt: new Date('2026-10-02T00:00:00Z'),
          })
          .where(eq(legalDocuments.id, older.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('newer version') as string },
      });
    });
  });

  describe('an acceptance', () => {
    let publishedId: string;
    let draftId: string;

    beforeAll(async () => {
      publishedId = (
        await insertPublishedLegal(version({ doc: 'host-agreement' }))
      ).id;
      draftId = (
        await insertOne(
          client.db
            .insert(legalDocuments)
            .values(version({ doc: 'host-agreement', version: 2 }) as never)
            .returning(),
        )
      ).id;
    });

    it('cannot name a draft', async () => {
      await expect(
        client.db.insert(legalAcceptances).values({
          legalDocumentId: draftId,
          subjectKind: 'host',
          subjectId: uuid(1),
        }),
      ).rejects.toMatchObject({
        cause: {
          message: expect.stringContaining(
            'Only a published version',
          ) as string,
        },
      });
    });

    it('cannot name a document that does not exist', async () => {
      await expect(
        client.db.insert(legalAcceptances).values({
          legalDocumentId: uuid(404),
          subjectKind: 'host',
          subjectId: uuid(1),
        }),
      ).rejects.toThrow();
    });

    it('is written once per subject and version, and never changes', async () => {
      const row = {
        legalDocumentId: publishedId,
        subjectKind: 'order' as const,
        subjectId: uuid(2),
      };
      const accepted = await insertOne(
        client.db.insert(legalAcceptances).values(row).returning(),
      );

      await expect(
        client.db.insert(legalAcceptances).values(row),
      ).rejects.toMatchObject({
        cause: { constraint: 'legal_acceptances_once_per_subject' },
      });
      await expect(
        client.db
          .update(legalAcceptances)
          .set({ subjectId: uuid(3) })
          .where(eq(legalAcceptances.id, accepted.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('never changes') as string },
      });
      await expect(
        client.db
          .delete(legalAcceptances)
          .where(eq(legalAcceptances.id, accepted.id)),
      ).rejects.toMatchObject({
        cause: { message: expect.stringContaining('never changes') as string },
      });
    });

    it('keeps its version from being deleted', async () => {
      await expect(
        client.db
          .delete(legalDocuments)
          .where(eq(legalDocuments.id, publishedId)),
      ).rejects.toThrow();
    });
  });

  it('can be the waiver of an experience, and an unknown document is refused', async () => {
    const waiver = await insertPublishedLegal(version({ doc: 'waiver-kayak' }));

    const experience = await insertExperience('live', {
      waiverRequired: true,
      waiverDocumentId: waiver.id,
    });

    expect(experience.waiverDocumentId).toBe(waiver.id);
    await expect(
      insertExperience('live', { waiverDocumentId: uuid(404) }),
    ).rejects.toMatchObject({
      cause: {
        constraint: 'experiences_waiver_document_id_legal_documents_id_fk',
      },
    });
  });
});

describe('settings in the database', () => {
  it('cannot be deleted or truncated', async () => {
    await expect(client.db.delete(settings)).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining('never deleted') as string,
      },
    });
    await expect(
      client.db.execute(sql`TRUNCATE TABLE settings`),
    ).rejects.toMatchObject({
      cause: {
        message: expect.stringContaining('never deleted') as string,
      },
    });
    expect(await client.db.select().from(settings)).toHaveLength(1);
  });

  it('starts as one row at the defaults, with the NYC tax rate', async () => {
    const rows = await client.db.select().from(settings);

    expect(rows).toEqual([
      expect.objectContaining({
        id: true,
        bannerText: null,
        bookingsPaused: false,
        giftsEnabled: true,
        checkoutMaintenance: false,
        holdMinutes: 10,
        paymentGraceMinutes: 5,
        giftValidityMonths: 12,
        giftExpiryAction: 'refund_buyer',
        taxRatePpm: 88_750,
      }),
    ]);
  });

  it('cannot hold a second row', async () => {
    await expect(client.db.insert(settings).values({})).rejects.toMatchObject({
      cause: { constraint: 'settings_pkey' },
    });
    await expect(
      client.db.insert(settings).values({ id: false }),
    ).rejects.toMatchObject({ cause: { constraint: 'settings_single_row' } });
  });

  it.each([
    ['hold length 0', { holdMinutes: 0 }, 'settings_hold_minutes'],
    ['hold length 61', { holdMinutes: 61 }, 'settings_hold_minutes'],
    ['grace -1', { paymentGraceMinutes: -1 }, 'settings_payment_grace_minutes'],
    ['grace 31', { paymentGraceMinutes: 31 }, 'settings_payment_grace_minutes'],
    [
      'gift validity 0',
      { giftValidityMonths: 0 },
      'settings_gift_validity_months',
    ],
    [
      'gift validity 121',
      { giftValidityMonths: 121 },
      'settings_gift_validity_months',
    ],
    ['a negative tax rate', { taxRatePpm: -1 }, 'settings_tax_rate_ppm'],
    [
      'a tax rate over 25 percent',
      { taxRatePpm: 250_001 },
      'settings_tax_rate_ppm',
    ],
    ['a blank banner', { bannerText: '  ' }, 'settings_banner_text'],
    [
      'a banner over the limit',
      { bannerText: 'a'.repeat(281) },
      'settings_banner_text',
    ],
  ])('refuse %s', async (_name, change, constraint) => {
    await expect(client.db.update(settings).set(change)).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it('accept the lowest and highest values', async () => {
    await client.db.update(settings).set({
      holdMinutes: 1,
      paymentGraceMinutes: 0,
      giftValidityMonths: 120,
      taxRatePpm: 250_000,
      bannerText: 'a'.repeat(280),
    });
    await client.db.update(settings).set({
      holdMinutes: 60,
      paymentGraceMinutes: 30,
      giftValidityMonths: 1,
      taxRatePpm: 0,
      bannerText: null,
    });
    await client.db.update(settings).set({
      holdMinutes: 10,
      paymentGraceMinutes: 5,
      giftValidityMonths: 12,
      taxRatePpm: 88_750,
    });
  });
});

describe('guest reads', () => {
  let liveId: string;
  let guideId: string;
  let draftExperienceId: string;
  let pausedExperienceId: string;

  beforeAll(async () => {
    liveId = (await insertExperience('live')).id;
    guideId = (
      await insertExperience('live', {
        status: 'guide_only',
        linkOutUrl: 'https://example.com/class',
      })
    ).id;
    draftExperienceId = (await insertExperience('draft')).id;
    pausedExperienceId = (await insertExperience('paused')).id;
  });

  describe('collections', () => {
    const published = unique('read-pick');
    const draft = unique('read-draft');
    let publishedId: string;
    let draftId: string;
    let emptyId: string;

    beforeAll(async () => {
      publishedId = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({
              slug: published,
              title: 'Published',
              status: 'published',
              intro: doc('Intro'),
              items: [
                { experienceId: guideId, note: 'Second on the list' },
                { experienceId: draftExperienceId, note: null },
                { experienceId: liveId, note: null },
                { experienceId: pausedExperienceId, note: null },
              ],
            }),
          ),
        )
      ).value.id;
      draftId = (
        await saved(
          editorial.saveCollection(ops, collectionInput({ slug: draft })),
        )
      ).value.id;
      emptyId = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({
              status: 'published',
              items: [{ experienceId: draftExperienceId, note: null }],
            }),
          ),
        )
      ).value.id;
    });

    it('reads a published pick by ID with only the entries a guest can see, in order, and their count', async () => {
      const [pick] = await editorial.listHomePicks([publishedId]);

      expect(pick).toEqual({
        id: publishedId,
        slug: published,
        title: 'Published',
        summary: null,
        itemCount: 2,
        experienceIds: [guideId, liveId],
      });
      expect(pick).not.toHaveProperty('intro');
    });

    it('leaves out a draft pick and an ID nothing has', async () => {
      const picks = await editorial.listHomePicks([draftId, uuid(404)]);

      expect(picks).toEqual([]);
    });

    it('reads nothing for no IDs', async () => {
      expect(await editorial.listHomePicks([])).toEqual([]);
    });

    it('refuses more IDs than the home page has modules, and an ID that is not one', async () => {
      const tooMany = Array.from(
        { length: editorialLimits.homeModules + 1 },
        (_, n) => uuid(n + 1),
      );

      await expect(editorial.listHomePicks(tooMany)).rejects.toThrow(ZodError);
      await expect(editorial.listHomePicks(['nope'])).rejects.toThrow(ZodError);
    });

    it('reads a pick with no visible entry as an empty one', async () => {
      const [pick] = await editorial.listHomePicks([emptyId]);

      expect(pick).toMatchObject({ itemCount: 0, experienceIds: [] });
    });

    it.each([
      ['a draft', () => draft],
      ['a slug that does not exist', () => 'no-such-pick'],
      ['a malformed slug', () => 'Not A Slug'],
      ['an empty slug', () => ''],
    ])('looks up %s as null', async (_name, slug) => {
      expect(await editorial.getPublishedPick(slug())).toBeNull();
    });

    it('looks up a published pick by slug', async () => {
      expect(await editorial.getPublishedPick(published)).toMatchObject({
        slug: published,
      });
    });

    it('shows a draft to staff, with every entry', async () => {
      const all = await editorial.listCollectionsForEditing(ops);

      expect(all.map((entry) => entry.slug)).toContain(draft);
      expect(all.find((entry) => entry.slug === published)?.items).toHaveLength(
        4,
      );
    });
  });

  describe('the gift guide', () => {
    it('is null until one is published, then is the one guide with its visible entries', async () => {
      expect(await editorial.getPublishedGiftGuide()).toBeNull();

      const guide = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({
            kind: 'gift_guide',
            slug: 'gift-guide',
            status: 'draft',
            items: [{ experienceId: liveId, note: null }],
          }),
        ),
      );
      expect(await editorial.getPublishedGiftGuide()).toBeNull();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({
            kind: 'gift_guide',
            slug: 'gift-guide',
            status: 'published',
            items: [{ experienceId: liveId, note: null }],
          }),
          id: guide.value.id,
        }),
      );

      expect(await editorial.getPublishedGiftGuide()).toMatchObject({
        kind: 'gift_guide',
        items: [{ experienceId: liveId }],
      });
    });

    it('cannot be a second one, in the data layer or the table', async () => {
      await expect(
        editorial.saveCollection(
          ops,
          collectionInput({ kind: 'gift_guide', slug: 'second-guide' }),
        ),
      ).resolves.toEqual({ status: 'gift_guide_exists' });
      await expect(
        client.db
          .insert(collections)
          .values({ kind: 'gift_guide', slug: 'third-guide', title: 'Third' }),
      ).rejects.toMatchObject({
        cause: { constraint: 'collections_one_gift_guide' },
      });
    });
  });

  describe('home modules', () => {
    let draftPickId: string;
    let publishedPickId: string;

    beforeAll(async () => {
      draftPickId = (
        await saved(editorial.saveCollection(ops, collectionInput()))
      ).value.id;
      publishedPickId = (
        await saved(
          editorial.saveCollection(
            ops,
            collectionInput({ status: 'published' }),
          ),
        )
      ).value.id;
    });

    const homeModule = (
      kind: 'hero_search' | 'picks' | 'this_week' | 'reassurance',
      extra: Partial<{
        enabled: boolean;
        heading: string;
        collectionId: string;
      }> = {},
    ) => ({
      kind,
      enabled: extra.enabled ?? true,
      heading: extra.heading ?? null,
      body: null,
      collectionId: extra.collectionId ?? null,
    });

    it('lists the enabled modules in order and leaves out one whose collection is a draft', async () => {
      await saved(
        editorial.saveHomeModules(ops, [
          homeModule('hero_search', { heading: 'First' }),
          homeModule('picks', { collectionId: draftPickId, heading: 'Hidden' }),
          homeModule('this_week', { enabled: false, heading: 'Off' }),
          homeModule('picks', {
            collectionId: publishedPickId,
            heading: 'Third',
          }),
          homeModule('reassurance', { heading: 'Last' }),
        ]),
      );

      const listed = await editorial.listHomeModules();

      expect(listed.map((entry) => entry.heading)).toEqual([
        'First',
        'Third',
        'Last',
      ]);
      const forEditing = await editorial.listHomeModulesForEditing(ops);
      expect(forEditing.map((entry) => entry.position)).toEqual([
        0, 1, 2, 3, 4,
      ]);
    });

    it('leaves out a switched-off module pinned to a published collection, and lists it once switched on', async () => {
      const save = (enabled: boolean) =>
        saved(
          editorial.saveHomeModules(ops, [
            homeModule('picks', {
              enabled,
              collectionId: publishedPickId,
              heading: 'Pinned',
            }),
            homeModule('reassurance', { heading: 'Last' }),
          ]),
        );

      await save(false);
      expect((await editorial.listHomeModules()).map((m) => m.heading)).toEqual(
        ['Last'],
      );

      await save(true);
      expect((await editorial.listHomeModules()).map((m) => m.heading)).toEqual(
        ['Pinned', 'Last'],
      );
    });
  });

  describe('page copy', () => {
    it('returns published copy by the slug of its category or neighborhood and nothing else', async () => {
      const category = await insertCategory();
      const neighborhood = await insertNeighborhood();
      const draftCategory = await insertCategory();
      const copy = (
        kind: 'category' | 'neighborhood',
        targetId: string,
        status: 'draft' | 'published',
      ) => ({
        kind,
        targetId,
        heading: 'Things to do',
        metaDescription: 'Meta',
        status,
        intro: doc('Intro'),
        body: null,
      });
      await saved(
        editorial.savePageCopy(ops, copy('category', category.id, 'published')),
      );
      await saved(
        editorial.savePageCopy(
          ops,
          copy('neighborhood', neighborhood.id, 'published'),
        ),
      );
      await saved(
        editorial.savePageCopy(
          ops,
          copy('category', draftCategory.id, 'draft'),
        ),
      );

      expect(
        await editorial.getPublishedPageCopy('category', category.slug),
      ).toMatchObject({
        kind: 'category',
        slug: category.slug,
        heading: 'Things to do',
      });
      expect(
        await editorial.getPublishedPageCopy('neighborhood', neighborhood.slug),
      ).toMatchObject({ kind: 'neighborhood', slug: neighborhood.slug });
      expect(
        await editorial.getPublishedPageCopy('category', draftCategory.slug),
      ).toBeNull();
      expect(
        await editorial.getPublishedPageCopy('neighborhood', category.slug),
      ).toBeNull();
      expect(
        await editorial.getPublishedPageCopy('category', 'Bad Slug'),
      ).toBeNull();
      const all = await editorial.listPageCopyForEditing(ops);
      expect(all.map((entry) => entry.slug)).toEqual(
        expect.arrayContaining([
          category.slug,
          neighborhood.slug,
          draftCategory.slug,
        ]),
      );
    });
  });

  describe('help articles', () => {
    it('lists published articles by position without their body and finds one by slug', async () => {
      const second = unique('help-b');
      const first = unique('help-a');
      const hidden = unique('help-draft');
      await saved(
        editorial.saveHelpArticle(
          ops,
          helpInput({
            slug: second,
            title: 'Second',
            position: 2000,
            status: 'published',
          }),
        ),
      );
      await saved(
        editorial.saveHelpArticle(
          ops,
          helpInput({
            slug: first,
            title: 'First',
            position: 1000,
            status: 'published',
          }),
        ),
      );
      await saved(editorial.saveHelpArticle(ops, helpInput({ slug: hidden })));

      const listed = await editorial.listPublishedHelpArticles();

      const slugs = listed.map((article) => article.slug);
      expect(slugs.indexOf(first)).toBeLessThan(slugs.indexOf(second));
      expect(slugs).not.toContain(hidden);
      expect(listed[0]).not.toHaveProperty('body');
      expect(await editorial.getPublishedHelpArticle(first)).toMatchObject({
        title: 'First',
        body: doc(),
      });
      expect(await editorial.getPublishedHelpArticle(hidden)).toBeNull();
      expect(await editorial.getPublishedHelpArticle('Not A Slug')).toBeNull();
      const forEditing = await editorial.listHelpArticlesForEditing(ops);
      expect(forEditing.map((article) => article.slug)).toContain(hidden);
    });
  });

  it('repairs a stored document that needs repair instead of throwing', async () => {
    const slug = unique('help-corrupt');
    const row = await insertOne(
      client.db
        .insert(helpArticles)
        .values({
          slug,
          title: 'Corrupt',
          body: {
            type: 'doc',
            content: [{ type: 'script', content: [] }],
          } as never,
          status: 'published',
          publishedAt: new Date('2026-10-01T00:00:00Z'),
        })
        .returning(),
    );

    const article = await editorial.getPublishedHelpArticle(slug);

    expect(article?.id).toBe(row.id);
    expect(article?.body).toEqual({ type: 'doc', content: [] });
  });

  describe('legal documents', () => {
    it('reads the highest published version as the current one, never a draft', async () => {
      const key = 'waiver-current';
      const v1 = await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v1',
        body: doc('One'),
      });
      await saved(legal.publishLegalDocument(ops, v1.id));
      const v2 = await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v2',
        body: doc('Two'),
      });
      await saved(legal.publishLegalDocument(ops, v2.id));
      await legal.createLegalDraft(ops, {
        doc: key,
        title: 'v3 draft',
        body: doc('Three'),
      });

      const current = await legal.getCurrentLegalDocument(key);

      expect(current).toMatchObject({
        doc: key,
        version: 2,
        title: 'v2',
        body: doc('Two'),
      });
      expect(await legal.getPublishedLegalDocument(v1.id)).toMatchObject({
        version: 1,
      });
      const versions = await legal.listLegalVersions(ops, key);
      expect(versions.map((entry) => [entry.version, entry.status])).toEqual([
        [3, 'draft'],
        [2, 'published'],
        [1, 'published'],
      ]);
    });

    it.each([
      ['a document with nothing published', 'waiver-nothing'],
      ['a malformed key', 'Terms'],
      ['an empty key', ''],
    ])('returns null for %s', async (_name, key) => {
      await legal.createLegalDraft(ops, {
        doc: 'waiver-nothing',
        title: 'Draft only',
        body: doc(),
      });

      expect(await legal.getCurrentLegalDocument(key)).toBeNull();
    });

    it('returns null for a draft by id and for a malformed id', async () => {
      const draft = await legal.createLegalDraft(ops, {
        doc: 'waiver-by-id',
        title: 'Draft',
        body: doc(),
      });

      expect(await legal.getPublishedLegalDocument(draft.id)).toBeNull();
      expect(await legal.getPublishedLegalDocument('nope')).toBeNull();
      expect(await legal.listLegalVersions(ops, 'Terms')).toEqual([]);
    });
  });

  describe('settings', () => {
    it('shows a guest the banner and the switches and no rate, window, or length', async () => {
      await settingsApi.updateSettings(ops, {
        bannerText: 'Heads up',
        bookingsPaused: true,
      });

      const visible = await settingsApi.getGuestSettings();

      expect(visible).toEqual({
        bannerText: 'Heads up',
        bookingsPaused: true,
        giftsEnabled: true,
        checkoutMaintenance: false,
      });
      await settingsApi.updateSettings(ops, {
        bannerText: null,
        bookingsPaused: false,
      });
    });
  });
});

describe('who may use the staff functions', () => {
  const garbage = {} as never;
  const staffCalls = [
    [
      'listCollectionsForEditing',
      (c: typeof ops) => editorial.listCollectionsForEditing(c),
    ],
    [
      'listHomeModulesForEditing',
      (c: typeof ops) => editorial.listHomeModulesForEditing(c),
    ],
    [
      'listPageCopyForEditing',
      (c: typeof ops) => editorial.listPageCopyForEditing(c),
    ],
    [
      'listHelpArticlesForEditing',
      (c: typeof ops) => editorial.listHelpArticlesForEditing(c),
    ],
    ['saveCollection', (c: typeof ops) => editorial.saveCollection(c, garbage)],
    [
      'saveHomeModules',
      (c: typeof ops) => editorial.saveHomeModules(c, garbage),
    ],
    ['savePageCopy', (c: typeof ops) => editorial.savePageCopy(c, garbage)],
    [
      'saveHelpArticle',
      (c: typeof ops) => editorial.saveHelpArticle(c, garbage),
    ],
    [
      'listLegalVersions',
      (c: typeof ops) => legal.listLegalVersions(c, 'terms'),
    ],
    ['createLegalDraft', (c: typeof ops) => legal.createLegalDraft(c, garbage)],
    [
      'editLegalDraft',
      (c: typeof ops) => legal.editLegalDraft(c, uuid(1), garbage),
    ],
    [
      'publishLegalDocument',
      (c: typeof ops) => legal.publishLegalDocument(c, uuid(1)),
    ],
    [
      'updateSettings',
      (c: typeof ops) => settingsApi.updateSettings(c, garbage),
    ],
  ] as const;

  describe.each([
    ['a guest', guest],
    ['a host owner', hostOwner],
    ['nobody signed in', anonymousCaller],
  ])('%s', (_who, caller) => {
    it.each(staffCalls)('is refused by %s', async (_name, call) => {
      await expect(call(caller)).rejects.toThrow(ForbiddenError);
    });
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s read', async (_who, caller) => {
    await expect(
      editorial.listCollectionsForEditing(caller),
    ).resolves.toBeInstanceOf(Array);
    await expect(
      legal.listLegalVersions(caller, 'terms'),
    ).resolves.toBeInstanceOf(Array);
  });

  it('lets admin save', async () => {
    await expect(
      editorial.saveHelpArticle(admin, helpInput()),
    ).resolves.toMatchObject({ status: 'saved' });
  });
});

describe('saving a collection', () => {
  it('creates a draft with its entries in order and stamps nothing', async () => {
    const [a, b, c] = [
      await insertExperience(),
      await insertExperience(),
      await insertExperience(),
    ];

    const result = await saved(
      editorial.saveCollection(
        ops,
        collectionInput({
          items: [
            { experienceId: c.id, note: 'Third by id, first in the list' },
            { experienceId: a.id, note: null },
            { experienceId: b.id, note: null },
          ],
        }),
      ),
    );

    expect(result.value.status).toBe('draft');
    expect(result.value.publishedAt).toBeNull();
    const stored = await client.db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, result.value.id));
    expect(
      stored
        .toSorted((x, y) => x.position - y.position)
        .map((row) => [row.position, row.experienceId]),
    ).toEqual([
      [0, c.id],
      [1, a.id],
      [2, b.id],
    ]);
  });

  it('replaces the entries and keeps the first publication time while it stays published', async () => {
    const first = await insertExperience();
    const second = await insertExperience();
    const input = collectionInput({
      status: 'published',
      items: [{ experienceId: first.id, note: null }],
    });
    const created = await saved(editorial.saveCollection(ops, input));

    const edited = await saved(
      editorial.saveCollection(ops, {
        ...input,
        id: created.value.id,
        title: 'Renamed',
        items: [{ experienceId: second.id, note: 'New' }],
      }),
    );

    expect(edited.value.title).toBe('Renamed');
    expect(edited.value.items).toEqual([
      { experienceId: second.id, note: 'New' },
    ]);
    expect(edited.value.publishedAt).toEqual(created.value.publishedAt);
    const stored = await client.db
      .select()
      .from(collectionItems)
      .where(eq(collectionItems.collectionId, created.value.id));
    expect(stored.map((row) => row.experienceId)).toEqual([second.id]);
  });

  it('clears the publication time when a pick goes back to draft and stamps a new one when it is published again', async () => {
    const input = collectionInput({ status: 'published' });
    const created = await saved(editorial.saveCollection(ops, input));
    const withId = { ...input, id: created.value.id };

    const back = await saved(
      editorial.saveCollection(ops, { ...withId, status: 'draft' }),
    );
    const again = await saved(editorial.saveCollection(ops, withId));

    expect(back.value.publishedAt).toBeNull();
    expect(again.value.publishedAt).toBeInstanceOf(Date);
  });

  it('refuses a slug another collection holds, and takes its own back', async () => {
    const slug = unique('taken');
    const holder = await saved(
      editorial.saveCollection(ops, collectionInput({ slug })),
    );

    await expect(
      editorial.saveCollection(ops, collectionInput({ slug })),
    ).resolves.toEqual({ status: 'slug_taken' });
    await expect(
      editorial.saveCollection(ops, {
        ...collectionInput({ slug }),
        id: holder.value.id,
      }),
    ).resolves.toMatchObject({ status: 'saved' });
  });

  it('refuses an experience that does not exist and writes nothing', async () => {
    const slug = unique('ghost');

    await expect(
      editorial.saveCollection(
        ops,
        collectionInput({
          slug,
          items: [{ experienceId: uuid(404), note: null }],
        }),
      ),
    ).resolves.toEqual({ status: 'unknown_experience' });
    expect(
      await client.db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug)),
    ).toEqual([]);
  });

  it('treats an id that matches nothing as not found', async () => {
    await expect(
      editorial.saveCollection(ops, { ...collectionInput(), id: uuid(404) }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('treats the id of a collection of another kind as not found', async () => {
    const pick = await saved(editorial.saveCollection(ops, collectionInput()));

    await expect(
      editorial.saveCollection(ops, {
        ...collectionInput({ kind: 'gift_guide', slug: unique('as-guide') }),
        id: pick.value.id,
      }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('refuses input the schema refuses, without writing', async () => {
    const slug = unique('unsafe');
    const unsafe = {
      type: 'doc',
      content: [
        {
          type: 'paragraph',
          content: [
            {
              type: 'text',
              text: 'x',
              marks: [{ type: 'link', attrs: { href: 'javascript:alert(1)' } }],
            },
          ],
        },
      ],
    } as never;

    await expect(
      editorial.saveCollection(ops, collectionInput({ slug, intro: unsafe })),
    ).rejects.toThrow();
    await expect(
      editorial.saveCollection(ops, collectionInput({ slug, title: ' ' })),
    ).rejects.toThrow();
    expect(
      await client.db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug)),
    ).toEqual([]);
  });

  describe('invalidation', () => {
    it('invalidates a pick and the home page when it is published', async () => {
      const slug = unique('tag-publish');

      await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug, status: 'published' }),
        ),
      );

      expect(tagsUpdated()).toEqual(['home', `pick:${slug}`]);
    });

    it('invalidates nothing for a draft that stays a draft', async () => {
      const draft = await saved(
        editorial.saveCollection(ops, collectionInput()),
      );
      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug: draft.value.slug }),
          id: draft.value.id,
          title: 'Edited draft',
        }),
      );

      expect(updateTag).not.toHaveBeenCalled();
    });

    it('invalidates when a published pick goes back to draft', async () => {
      const slug = unique('tag-unpublish');
      const created = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug, status: 'published' }),
        ),
      );
      vi.mocked(updateTag).mockClear();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug }),
          id: created.value.id,
        }),
      );

      expect(tagsUpdated()).toEqual(['home', `pick:${slug}`]);
    });

    it('invalidates the old and the new address when a published pick is renamed', async () => {
      const oldSlug = unique('tag-old');
      const newSlug = unique('tag-new');
      const created = await saved(
        editorial.saveCollection(
          ops,
          collectionInput({ slug: oldSlug, status: 'published' }),
        ),
      );
      vi.mocked(updateTag).mockClear();

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({ slug: newSlug, status: 'published' }),
          id: created.value.id,
        }),
      );

      expect(tagsUpdated()).toEqual(
        ['home', `pick:${oldSlug}`, `pick:${newSlug}`].toSorted(),
      );
    });

    it('invalidates the gift guide tags for the gift guide', async () => {
      const guide = await editorial.listCollectionsForEditing(ops);
      const existing = guide.find((entry) => entry.kind === 'gift_guide');
      if (!existing) throw new Error('An earlier test saved the gift guide');

      await saved(
        editorial.saveCollection(ops, {
          ...collectionInput({
            kind: 'gift_guide',
            slug: existing.slug,
            status: 'published',
          }),
          id: existing.id,
        }),
      );

      expect(tagsUpdated()).toEqual(['gift-guide', 'home']);
    });

    it('invalidates nothing when the save is refused', async () => {
      await editorial.saveCollection(
        ops,
        collectionInput({
          status: 'published',
          items: [{ experienceId: uuid(404), note: null }],
        }),
      );

      expect(updateTag).not.toHaveBeenCalled();
    });
  });
});

describe('saving the home page', () => {
  const homeModule = (heading: string, collectionId: string | null = null) => ({
    kind: collectionId ? ('picks' as const) : ('this_week' as const),
    enabled: true,
    heading,
    body: null,
    collectionId,
  });

  it('replaces the whole list and numbers the modules from zero in the order given', async () => {
    await saved(
      editorial.saveHomeModules(ops, [
        homeModule('One'),
        homeModule('Two'),
        homeModule('Three'),
      ]),
    );

    const replaced = await saved(
      editorial.saveHomeModules(ops, [homeModule('B'), homeModule('A')]),
    );

    expect(
      replaced.value.map((entry) => [entry.position, entry.heading]),
    ).toEqual([
      [0, 'B'],
      [1, 'A'],
    ]);
    expect(await client.db.select().from(homeModules)).toHaveLength(2);
  });

  it('empties the home page when given nothing', async () => {
    await saved(editorial.saveHomeModules(ops, [homeModule('One')]));

    const result = await saved(editorial.saveHomeModules(ops, []));

    expect(result.value).toEqual([]);
  });

  it('refuses a collection that does not exist and keeps the list it had', async () => {
    await saved(editorial.saveHomeModules(ops, [homeModule('Keep')]));

    await expect(
      editorial.saveHomeModules(ops, [homeModule('Gone', uuid(404))]),
    ).resolves.toEqual({ status: 'unknown_collection' });

    expect(
      (await client.db.select().from(homeModules)).map((row) => row.heading),
    ).toEqual(['Keep']);
  });

  it('refuses more modules than the limit and a collection on a module that shows none', async () => {
    const tooMany = Array.from(
      { length: editorialLimits.homeModules + 1 },
      (_, n) => homeModule(`M${String(n)}`),
    );
    const pick = await saved(editorial.saveCollection(ops, collectionInput()));

    await expect(editorial.saveHomeModules(ops, tooMany)).rejects.toThrow();
    await expect(
      editorial.saveHomeModules(ops, [
        {
          ...homeModule('Bad'),
          kind: 'hero_search',
          collectionId: pick.value.id,
        },
      ]),
    ).rejects.toThrow();
  });

  describe('a module and the kind of collection it shows', () => {
    let pickId: string;
    let giftGuideId: string;

    beforeAll(async () => {
      pickId = (await saved(editorial.saveCollection(ops, collectionInput())))
        .value.id;
      const existing = (await editorial.listCollectionsForEditing(ops)).find(
        (entry) => entry.kind === 'gift_guide',
      );
      giftGuideId =
        existing?.id ??
        (
          await saved(
            editorial.saveCollection(
              ops,
              collectionInput({ kind: 'gift_guide', slug: 'gift-guide' }),
            ),
          )
        ).value.id;
    });

    it.each([
      ['a picks module on the gift guide', 'picks', () => giftGuideId],
      ['a gift_guide module on a Pick', 'gift_guide', () => pickId],
    ] as const)(
      'refuses %s and keeps the list it had',
      async (_name, kind, id) => {
        await saved(editorial.saveHomeModules(ops, [homeModule('Kept')]));

        await expect(
          editorial.saveHomeModules(ops, [
            { ...homeModule('Wrong'), kind, collectionId: id() },
          ]),
        ).resolves.toEqual({ status: 'collection_kind_mismatch' });

        expect(
          (await client.db.select().from(homeModules)).map(
            (row) => row.heading,
          ),
        ).toEqual(['Kept']);
      },
    );

    it('accepts a picks module on a Pick and a gift_guide module on the gift guide', async () => {
      const result = await saved(
        editorial.saveHomeModules(ops, [
          { ...homeModule('Picks'), kind: 'picks', collectionId: pickId },
          {
            ...homeModule('Gifts'),
            kind: 'gift_guide',
            collectionId: giftGuideId,
          },
        ]),
      );

      expect(result.value.map((entry) => entry.kind)).toEqual([
        'picks',
        'gift_guide',
      ]);
    });

    it('is also held by the table, and a shown collection cannot change kind', async () => {
      await client.db.delete(homeModules);

      await expect(
        client.db
          .insert(homeModules)
          .values({ position: 0, kind: 'picks', collectionId: giftGuideId }),
      ).rejects.toMatchObject({
        cause: { constraint: 'home_modules_collection_kind_fk' },
      });
      await client.db
        .insert(homeModules)
        .values({ position: 0, kind: 'picks', collectionId: pickId });
      await expect(
        client.db
          .update(collections)
          .set({ kind: 'gift_guide' })
          .where(eq(collections.id, pickId)),
      ).rejects.toThrow();
      await client.db.delete(homeModules);
    });
  });

  it('invalidates the home page', async () => {
    await saved(editorial.saveHomeModules(ops, [homeModule('Tagged')]));

    expect(tagsUpdated()).toEqual(['home']);
  });
});

describe('saving page copy', () => {
  const copy = (
    kind: 'category' | 'neighborhood',
    targetId: string,
    overrides: Partial<import('@/lib/editorial').PageCopyInput> = {},
  ): import('@/lib/editorial').PageCopyInput => ({
    kind,
    targetId,
    heading: null,
    metaDescription: null,
    status: 'draft',
    intro: null,
    body: null,
    ...overrides,
  });

  it('creates the copy of a category, then replaces it', async () => {
    const category = await insertCategory();

    const created = await saved(
      editorial.savePageCopy(
        ops,
        copy('category', category.id, { heading: 'First' }),
      ),
    );
    const replaced = await saved(
      editorial.savePageCopy(
        ops,
        copy('category', category.id, { heading: 'Second' }),
      ),
    );

    expect(created.value).toMatchObject({
      kind: 'category',
      slug: category.slug,
    });
    expect(replaced.value.id).toBe(created.value.id);
    expect(replaced.value.heading).toBe('Second');
    expect(
      await client.db
        .select()
        .from(pages)
        .where(eq(pages.categoryId, category.id)),
    ).toHaveLength(1);
  });

  it.each([
    ['category', 'a category', 'category:'],
    ['neighborhood', 'a neighborhood', 'neighborhood:'],
  ] as const)(
    'invalidates the tag of %s copy when it is published and nothing for a draft',
    async (kind, _name, prefix) => {
      const target =
        kind === 'category'
          ? await insertCategory()
          : await insertNeighborhood();

      await saved(editorial.savePageCopy(ops, copy(kind, target.id)));
      expect(updateTag).not.toHaveBeenCalled();
      await saved(
        editorial.savePageCopy(
          ops,
          copy(kind, target.id, { status: 'published' }),
        ),
      );

      expect(tagsUpdated()).toEqual([`${prefix}${target.slug}`]);
    },
  );

  it('refuses a category or neighborhood that does not exist', async () => {
    await expect(
      editorial.savePageCopy(ops, copy('category', uuid(404))),
    ).resolves.toEqual({ status: 'unknown_target' });
    const category = await insertCategory();
    await expect(
      editorial.savePageCopy(ops, copy('neighborhood', category.id)),
    ).resolves.toEqual({ status: 'unknown_target' });
  });
});

describe('saving a help article', () => {
  it('creates an article and replaces it by id, keeping the publication time', async () => {
    const created = await saved(
      editorial.saveHelpArticle(ops, helpInput({ status: 'published' })),
    );

    const edited = await saved(
      editorial.saveHelpArticle(ops, {
        ...helpInput({
          slug: created.value.slug,
          status: 'published',
          title: 'New title',
        }),
        id: created.value.id,
      }),
    );

    expect(edited.value.title).toBe('New title');
    expect(edited.value.publishedAt).toEqual(created.value.publishedAt);
  });

  it('refuses a slug another article holds and an id that matches nothing', async () => {
    const slug = unique('help-slug');
    await saved(editorial.saveHelpArticle(ops, helpInput({ slug })));

    await expect(
      editorial.saveHelpArticle(ops, helpInput({ slug })),
    ).resolves.toEqual({ status: 'slug_taken' });
    await expect(
      editorial.saveHelpArticle(ops, { ...helpInput(), id: uuid(404) }),
    ).resolves.toEqual({ status: 'not_found' });
  });

  it('invalidates the help tag when an article is published and when it is unpublished, not for a draft', async () => {
    const created = await saved(editorial.saveHelpArticle(ops, helpInput()));
    expect(updateTag).not.toHaveBeenCalled();
    const input = {
      ...helpInput({ slug: created.value.slug }),
      id: created.value.id,
    };

    await saved(
      editorial.saveHelpArticle(ops, { ...input, status: 'published' }),
    );
    expect(tagsUpdated()).toEqual(['help-articles']);
    await saved(editorial.saveHelpArticle(ops, input));

    expect(tagsUpdated()).toEqual(['help-articles', 'help-articles']);
  });

  it('stores a document at the size limit the schema allows', async () => {
    const overhead = JSON.stringify(doc('')).length;
    const body = doc('a'.repeat(editorialLimits.richTextBytes - overhead));

    const result = await saved(
      editorial.saveHelpArticle(ops, helpInput({ body })),
    );

    expect(result.value.body).toEqual(body);
  });

  it('refuses a document over the size limit', async () => {
    const overhead = JSON.stringify(doc('')).length;
    const body = doc('a'.repeat(editorialLimits.richTextBytes - overhead + 1));

    await expect(
      editorial.saveHelpArticle(ops, helpInput({ body })),
    ).rejects.toThrow();
  });
});

describe('legal drafts and publishing', () => {
  it('numbers each document from one and each draft one above the last', async () => {
    const key = 'waiver-numbering';
    const other = 'waiver-numbering-other';

    const first = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'A',
      body: doc(),
    });
    const second = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'B',
      body: doc(),
    });
    const otherFirst = await legal.createLegalDraft(ops, {
      doc: other,
      title: 'C',
      body: doc(),
    });

    expect([first.version, second.version, otherFirst.version]).toEqual([
      1, 2, 1,
    ]);
    expect(first.status).toBe('draft');
  });

  it('gives two drafts made at the same moment two different numbers', async () => {
    const key = 'waiver-race';

    const made = await Promise.all([
      legal.createLegalDraft(ops, { doc: key, title: 'A', body: doc() }),
      legal.createLegalDraft(ops, { doc: key, title: 'B', body: doc() }),
      legal.createLegalDraft(ops, { doc: key, title: 'C', body: doc() }),
    ]);

    expect(made.map((entry) => entry.version).toSorted()).toEqual([1, 2, 3]);
  });

  it('edits a draft and refuses to edit a published version', async () => {
    const draft = await legal.createLegalDraft(ops, {
      doc: 'waiver-edit',
      title: 'Old',
      body: doc('Old'),
    });

    const edited = await legal.editLegalDraft(ops, draft.id, {
      title: 'New',
      body: doc('New'),
    });
    await saved(legal.publishLegalDocument(ops, draft.id));
    const late = await legal.editLegalDraft(ops, draft.id, {
      title: 'Late',
      body: doc(),
    });

    expect(edited).toMatchObject({
      status: 'saved',
      value: { title: 'New', body: doc('New') },
    });
    expect(late).toEqual({ status: 'not_a_draft' });
    expect(
      await legal.editLegalDraft(ops, 'nope', { title: 'x', body: doc() }),
    ).toEqual({
      status: 'not_a_draft',
    });
  });

  it('publishes a draft, which stamps the time, makes it current, and invalidates its page', async () => {
    const draft = await legal.createLegalDraft(ops, {
      doc: 'terms',
      title: 'Terms v1',
      body: doc(),
    });
    expect(updateTag).not.toHaveBeenCalled();

    const published = await saved(legal.publishLegalDocument(ops, draft.id));

    expect(published.value.status).toBe('published');
    expect(published.value.publishedAt).toBeInstanceOf(Date);
    expect(tagsUpdated()).toEqual(['legal:terms']);
    expect((await legal.getCurrentLegalDocument('terms'))?.id).toBe(draft.id);
  });

  it('refuses to publish a version already published, a missing one, and a draft below a published version', async () => {
    const key = 'waiver-stale';
    const old = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'Old',
      body: doc(),
    });
    const newer = await legal.createLegalDraft(ops, {
      doc: key,
      title: 'Newer',
      body: doc(),
    });
    await saved(legal.publishLegalDocument(ops, newer.id));
    vi.mocked(updateTag).mockClear();

    await expect(legal.publishLegalDocument(ops, old.id)).resolves.toEqual({
      status: 'superseded',
    });
    await expect(legal.publishLegalDocument(ops, newer.id)).resolves.toEqual({
      status: 'not_a_draft',
    });
    await expect(legal.publishLegalDocument(ops, uuid(404))).resolves.toEqual({
      status: 'not_a_draft',
    });
    await expect(legal.publishLegalDocument(ops, 'nope')).resolves.toEqual({
      status: 'not_a_draft',
    });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('refuses a key and a body the schema refuses, without writing', async () => {
    await expect(
      legal.createLegalDraft(ops, { doc: 'Cookies', title: 'x', body: doc() }),
    ).rejects.toThrow();
    await expect(
      legal.createLegalDraft(ops, {
        doc: 'terms',
        title: 'x',
        body: { type: 'doc', content: [{ type: 'script' }] } as never,
      }),
    ).rejects.toThrow();
  });
});

describe('updating settings', () => {
  it('changes only the named settings and bumps the update time', async () => {
    const [before] = await client.db.select().from(settings);
    if (!before) throw new Error('The migration inserts the settings row');

    const after = await settingsApi.updateSettings(ops, {
      holdMinutes: 15,
      giftsEnabled: false,
      taxRatePpm: 80_000,
    });

    expect(after).toMatchObject({
      holdMinutes: 15,
      giftsEnabled: false,
      taxRatePpm: 80_000,
      paymentGraceMinutes: before.paymentGraceMinutes,
      giftValidityMonths: before.giftValidityMonths,
      bookingsPaused: before.bookingsPaused,
    });
    expect(after.updatedAt.getTime()).toBeGreaterThanOrEqual(
      before.updatedAt.getTime(),
    );
    await settingsApi.updateSettings(admin, {
      holdMinutes: 10,
      giftsEnabled: true,
      taxRatePpm: 88_750,
    });
  });

  it('turns a banner on and off', async () => {
    const on = await settingsApi.updateSettings(ops, {
      bannerText: 'Maintenance tonight',
    });
    const off = await settingsApi.updateSettings(ops, { bannerText: null });

    expect(on.bannerText).toBe('Maintenance tonight');
    expect(off.bannerText).toBeNull();
  });

  it('invalidates the settings tag', async () => {
    await settingsApi.updateSettings(ops, { checkoutMaintenance: true });
    await settingsApi.updateSettings(ops, { checkoutMaintenance: false });

    expect(tagsUpdated()).toEqual(['settings', 'settings']);
  });

  it.each([
    ['a hold length out of range', { holdMinutes: 61 }],
    ['nothing at all', {}],
    ['a setting that does not exist', { hostPayoutDay: 3 }],
  ])('refuses %s and invalidates nothing', async (_name, change) => {
    await expect(
      settingsApi.updateSettings(ops, change as never),
    ).rejects.toThrow();

    expect(updateTag).not.toHaveBeenCalled();
    expect((await client.db.select().from(settings))[0]?.holdMinutes).toBe(10);
  });
});

describe('text Postgres cannot store', () => {
  // The Zod contracts refuse U+0000 and lone surrogates; the unit table covers every field. Here
  // each write function is shown to refuse before the database, with a ZodError whose message
  // holds neither SQL nor the value, and to leave nothing behind.
  const bad = ['\u0000', '\ud800'] as const;
  const noSqlInMessage = (error: unknown) => {
    expect(error).toBeInstanceOf(ZodError);
    const { message } = error as ZodError;
    expect(message).not.toMatch(/insert into|update "|params:/i);
  };

  it.each(bad)(
    'refuses %j in every write and writes nothing',
    async (value) => {
      const slug = unique('unstorable');
      const attempts = [
        () =>
          editorial.saveCollection(
            ops,
            collectionInput({ slug, title: `Title ${value}` }),
          ),
        () =>
          editorial.saveHelpArticle(
            ops,
            helpInput({ slug, body: doc(`Body ${value}`) }),
          ),
        () =>
          legal.createLegalDraft(ops, {
            doc: 'waiver-unstorable',
            title: `Title ${value}`,
            body: doc(),
          }),
        () =>
          settingsApi.updateSettings(ops, { bannerText: `Banner ${value}` }),
        () =>
          editorial.saveHomeModules(ops, [
            {
              kind: 'this_week',
              enabled: true,
              heading: `Heading ${value}`,
              body: null,
              collectionId: null,
            },
          ]),
      ];

      for (const attempt of attempts) {
        await attempt().then(() => {
          throw new Error('The write was accepted');
        }, noSqlInMessage);
      }

      expect(
        await client.db
          .select()
          .from(collections)
          .where(eq(collections.slug, slug)),
      ).toEqual([]);
      expect(
        await client.db
          .select()
          .from(helpArticles)
          .where(eq(helpArticles.slug, slug)),
      ).toEqual([]);
      expect(
        await client.db
          .select()
          .from(legalDocuments)
          .where(eq(legalDocuments.doc, 'waiver-unstorable')),
      ).toEqual([]);
      expect(
        (await client.db.select().from(settings))[0]?.bannerText,
      ).toBeNull();
      expect(tagsUpdated()).toEqual([]);
    },
  );
});

describe('ids written in capitals', () => {
  it('find the experience a collection lists, instead of reporting it unknown', async () => {
    const experience = await insertExperience();

    const result = await editorial.saveCollection(
      ops,
      collectionInput({
        items: [{ experienceId: experience.id.toUpperCase(), note: null }],
      }),
    );

    expect(result).toMatchObject({
      status: 'saved',
      value: { items: [{ experienceId: experience.id }] },
    });
  });

  it('find the collection a home module shows, instead of reporting it unknown', async () => {
    const pick = await saved(editorial.saveCollection(ops, collectionInput()));

    const result = await editorial.saveHomeModules(ops, [
      {
        kind: 'picks',
        enabled: true,
        heading: 'Shown',
        body: null,
        collectionId: pick.value.id.toUpperCase(),
      },
    ]);

    expect(result).toMatchObject({
      status: 'saved',
      value: [{ collectionId: pick.value.id }],
    });
  });
});

describe('the publish lookup in publishLegalDocument', () => {
  const insertDrafts = (doc: string, count: number) =>
    client.db.execute(
      sql`INSERT INTO legal_documents (doc, version, title, body)
        SELECT ${doc}, g, 'T', '{"type":"doc","content":[]}'::jsonb
        FROM generate_series(1, ${count}::int) AS g`,
    );

  // One statement, in order, so each version publishes above the ones before it.
  const publishVersions = (doc: string, versions: readonly number[]) =>
    client.db.execute(
      sql`DO $$
        DECLARE v int;
        BEGIN
          FOREACH v IN ARRAY ${sql.raw(`ARRAY[${versions.join(',')}]`)} LOOP
            UPDATE legal_documents SET status = 'published'
              WHERE doc = ${sql.raw(`'${doc}'`)} AND version = v;
          END LOOP;
        END
        $$`,
    );

  const idOf = async (doc: string, version: number) => {
    const [row] = await client.db
      .select({ id: legalDocuments.id })
      .from(legalDocuments)
      .where(
        and(eq(legalDocuments.doc, doc), eq(legalDocuments.version, version)),
      );
    if (!row) throw new Error('missing version');
    return row.id;
  };

  it('publishes a lower draft while the higher version is only a draft', async () => {
    const lower = await legal.createLegalDraft(ops, {
      doc: 'waiver-draft-above',
      title: 'v1',
      body: doc(),
    });
    await legal.createLegalDraft(ops, {
      doc: 'waiver-draft-above',
      title: 'v2',
      body: doc(),
    });

    const result = await legal.publishLegalDocument(ops, lower.id);

    expect(result).toMatchObject({
      status: 'published',
      value: { version: 1 },
    });
  });

  it('sees a published version above the draft however many are published, and in any position', async () => {
    const key = 'waiver-cap-order';
    await insertDrafts(key, 203);
    const published = [...Array.from({ length: 200 }, (_, n) => n + 2), 203];
    await publishVersions(key, published);
    expect(published.length).toBeGreaterThan(editorialLimits.listed);

    // 1 has published versions above it; 202 has 200 below it and only 203 above, which a lookup
    // that took the lowest 200 would never see.
    for (const version of [1, 202]) {
      expect(
        await legal.publishLegalDocument(ops, await idOf(key, version)),
      ).toEqual({ status: 'superseded' });
    }
  });
});

describe('the home Picks read when many Picks are published', () => {
  const crowd = unique('crowd');

  afterAll(async () => {
    await client.db
      .delete(collections)
      .where(sql`${collections.slug} like ${`${crowd}-%`}`);
  });

  it('finds a named pick past the list limit, with the first entries and the full count, and no intro', async () => {
    const experienceIds = [];
    for (let n = 0; n < homeLimits.picksCandidates + 3; n += 1) {
      experienceIds.push((await insertExperience('live')).id);
    }
    const named = await saved(
      editorial.saveCollection(
        ops,
        collectionInput({
          slug: `${crowd}-named`,
          // Sorts last by title, so a read capped at the list limit would cut it off.
          title: 'zzzz named',
          status: 'published',
          intro: doc('A long intro'),
          items: experienceIds.map((experienceId) => ({
            experienceId,
            note: null,
          })),
        }),
      ),
    );
    await client.db.insert(collections).values(
      Array.from({ length: editorialLimits.listed + 1 }, (_, n) => ({
        kind: 'pick' as const,
        slug: `${crowd}-${String(n)}`,
        title: `Crowd ${String(n).padStart(3, '0')}`,
        status: 'published' as const,
        publishedAt: new Date(),
      })),
    );

    const [pick, ...others] = await editorial.listHomePicks([named.value.id]);

    expect(others).toEqual([]);
    expect(pick?.id).toBe(named.value.id);
    expect(pick?.itemCount).toBe(experienceIds.length);
    expect(pick?.experienceIds).toEqual(
      experienceIds.slice(0, homeLimits.picksCandidates),
    );
    expect(pick).not.toHaveProperty('intro');
    expect(pick).not.toHaveProperty('items');

    // The same shared read in its full shape keeps the intro and every entry.
    const full = await editorial.getPublishedPick(`${crowd}-named`);
    expect(full?.items).toHaveLength(experienceIds.length);
    expect(full?.intro).toEqual(doc('A long intro'));
  });
});
