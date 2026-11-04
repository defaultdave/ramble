import { updateTag } from 'next/cache';
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
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  categories,
  collections,
  helpArticles,
  homeModules,
  pages,
} from '@/server/db/schema';
import { unique } from './catalogFixtures';
import { doc } from './editorialFixtures';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  serveNeonHttp,
  type FreshDatabase,
  type RaceHooks,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk. Each race holds a lock in one
// transaction, starts the challenger on a second connection, shows it waits, then lets the holder
// commit and checks the challenger answers from what the holder committed:
// - a second collection with the same slug is `slug_taken`, a second gift guide is `gift_guide_exists`
// - a second help article with the same slug is `slug_taken`
// - a first save of page copy that races another replaces it, and two replacements of the home page both save

// This file has its own schema, so no gift guide exists yet.

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let locks: typeof import('@/server/db/locks');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  locks = await import('@/server/db/locks');
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

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

function raceAgainstOpenTransaction<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
  hooks: RaceHooks<Tx> = {},
): Promise<T> {
  return race<Tx, T>(
    (body) => client.db.transaction(body),
    holder,
    challenger,
    hooks,
  );
}

describe('saving a collection', () => {
  const input = (overrides: Record<string, unknown>) =>
    ({
      kind: 'pick',
      slug: unique('race-pick'),
      title: 'A pick',
      summary: null,
      intro: null,
      status: 'draft',
      items: [],
      ...overrides,
    }) as never;

  it('answers slug_taken to the writer that lost a race for a slug', async () => {
    const slug = unique('race-slug');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await locks.lockFor(tx, `editorial:collection-slug:${slug}`);
        await tx
          .insert(collections)
          .values({ kind: 'pick', slug, title: 'Won' });
      },
      () => editorial.saveCollection(ops, input({ slug })),
    );

    expect(outcome).toEqual({ status: 'slug_taken' });
    expect(
      await client.db
        .select()
        .from(collections)
        .where(eq(collections.slug, slug)),
    ).toHaveLength(1);
  });

  it('answers gift_guide_exists to the writer that lost a race for the gift guide', async () => {
    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await locks.lockFor(tx, 'editorial:gift-guide');
        await tx.insert(collections).values({
          kind: 'gift_guide',
          slug: unique('race-guide'),
          title: 'Won',
        });
      },
      () =>
        editorial.saveCollection(
          ops,
          input({ kind: 'gift_guide', slug: unique('race-guide-lost') }),
        ),
    );

    expect(outcome).toEqual({ status: 'gift_guide_exists' });
  });

  it('lets two writers of different slugs run side by side', async () => {
    const results = await Promise.all([
      editorial.saveCollection(ops, input({})),
      editorial.saveCollection(ops, input({})),
    ]);

    expect(results.map((result) => result.status)).toEqual(['saved', 'saved']);
  });
});

describe('saving a help article', () => {
  it('answers slug_taken to the writer that lost a race for a slug', async () => {
    const slug = unique('race-help');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await locks.lockFor(tx, `editorial:help-slug:${slug}`);
        await tx
          .insert(helpArticles)
          .values({ slug, title: 'Won', body: doc() });
      },
      () =>
        editorial.saveHelpArticle(ops, {
          slug,
          title: 'Lost',
          summary: null,
          position: 0,
          status: 'draft',
          body: doc(),
        }),
    );

    expect(outcome).toEqual({ status: 'slug_taken' });
  });
});

describe('saving page copy', () => {
  it('replaces the copy a racing first save created', async () => {
    const [category] = await client.db
      .insert(categories)
      .values({ slug: unique('race-category'), name: 'Race' })
      .returning();
    if (!category) throw new Error('insert returned no category');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await locks.lockFor(tx, `editorial:page-copy:category:${category.id}`);
        await tx
          .insert(pages)
          .values({ categoryId: category.id, heading: 'First' });
      },
      () =>
        editorial.savePageCopy(ops, {
          kind: 'category',
          targetId: category.id,
          heading: 'Second',
          metaDescription: null,
          status: 'draft',
          intro: null,
          body: null,
        }),
    );

    expect(outcome).toMatchObject({
      status: 'saved',
      value: { heading: 'Second' },
    });
    const rows = await client.db
      .select()
      .from(pages)
      .where(eq(pages.categoryId, category.id));
    expect(rows.map((row) => row.heading)).toEqual(['Second']);
  });
});

describe('saving the home page', () => {
  it('replaces the list a racing replacement wrote', async () => {
    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await locks.lockFor(tx, 'editorial:home-modules');
        await tx.delete(homeModules);
        await tx
          .insert(homeModules)
          .values({ position: 0, kind: 'this_week', heading: 'First' });
      },
      () =>
        editorial.saveHomeModules(ops, [
          {
            kind: 'reassurance',
            enabled: true,
            heading: 'Second',
            body: null,
            collectionId: null,
          },
        ]),
    );

    expect(outcome).toMatchObject({ status: 'saved' });
    expect(
      (await client.db.select().from(homeModules)).map((row) => row.heading),
    ).toEqual(['Second']);
  });
});
