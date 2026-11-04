import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { editorialLimits } from '@/lib/editorial';
import {
  collectionItems,
  collections,
  experiences,
  helpArticles,
  homeModules,
  pages,
} from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { unique } from './catalogFixtures';
import { doc, editorialFixtures, insertOne } from './editorialFixtures';
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

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { insertCategory, insertNeighborhood, insertExperience } =
  editorialFixtures(() => client.db);

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
