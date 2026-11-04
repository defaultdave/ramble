import { updateTag } from 'next/cache';
import { ZodError } from 'zod';
import { eq } from 'drizzle-orm';
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
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  collections,
  helpArticles,
  homeModules,
  legalDocuments,
  pages,
  settings,
} from '@/server/db/schema';
import { id as uuid } from '../support/ids';
import { unique } from './catalogFixtures';
import {
  collectionInput,
  doc,
  editorialFixtures,
  helpInput,
  saved,
} from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - saving the home page replaces the whole list in order and refuses an unknown collection
// - saving page copy creates or replaces it and refuses an unknown category or neighborhood
// - saving a help article creates or replaces it and refuses a taken slug and an unknown id
// - a document at the Zod size limit is stored
// - text Postgres cannot store is refused before the database and leaves nothing behind

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

const { insertCategory, insertNeighborhood } = editorialFixtures(
  () => client.db,
);

const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

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

    await expect(editorial.saveHomeModules(ops, tooMany)).rejects.toThrow(
      ZodError,
    );
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
    ).rejects.toThrow(ZodError);
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
