import { updateTag } from 'next/cache';
import { eq, sql } from 'drizzle-orm';
import pg from 'pg';
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
  categories,
  collections,
  helpArticles,
  homeModules,
  legalDocuments,
  pages,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk. Each race holds a lock in one
// transaction, starts the challenger on a second connection, shows it waits, then lets the holder
// commit and checks the challenger answers from what the holder committed:
// - the publish trigger takes its per-document lock: a lower version cannot publish while a higher one is mid-publish
// - publishLegalDocument loses that race with `superseded`, and a second publish of the same draft with `not_a_draft`
// - editing a legal draft that a publish committed after the read is `not_a_draft`, and the row keeps its title
// - the publish lookup of published versions is bounded by the listed limit
// - a second collection with the same slug is `slug_taken`, a second gift guide is `gift_guide_exists`
// - a second help article with the same slug is `slug_taken`
// - a first save of page copy that races another replaces it, and two replacements of the home page both save

// This file has its own schema, so no gift guide exists yet.

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editorial: typeof import('@/server/db/editorial');
let legal: typeof import('@/server/db/legal');
let locks: typeof import('@/server/db/locks');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editorial = await import('@/server/db/editorial');
  legal = await import('@/server/db/legal');
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

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

function doc(text = 'Hello') {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }],
  } as never;
}

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

const aFewMoments = () => new Promise((resolve) => setTimeout(resolve, 300));

/**
 * Runs `holder` in a transaction that stays open, starts `challenger` on another connection,
 * checks the challenger is still waiting, then commits the holder and returns what the challenger
 * answered. A challenger that does not wait was not serialized by the lock.
 */
async function raceAgainstOpenTransaction<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
): Promise<T> {
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  let held!: () => void;
  const holding = new Promise<void>((resolve) => {
    held = resolve;
  });
  const holderDone = client.db.transaction(async (tx) => {
    await holder(tx);
    held();
    await gate;
  });
  await holding;

  let settled = false;
  const answer = challenger().finally(() => {
    settled = true;
  });
  answer.catch(() => undefined);
  await aFewMoments();
  const waited = !settled;
  release();
  await holderDone;
  expect(waited, 'the challenger waited for the holder').toBe(true);
  return answer;
}

const draftOf = (docKey: string, title = 'Draft') =>
  legal.createLegalDraft(ops, { doc: docKey, title, body: doc() });

const published = {
  status: 'published' as const,
  publishedAt: new Date('2026-10-01T00:00:00Z'),
};

describe('publishing a legal version', () => {
  it('waits in the trigger for the per-document lock, then is refused under the higher version', async () => {
    const low = await draftOf('waiver-race-trigger');
    const high = await draftOf('waiver-race-trigger');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(legalDocuments)
          .set(published)
          .where(eq(legalDocuments.id, high.id));
      },
      () =>
        client.db
          .update(legalDocuments)
          .set(published)
          .where(eq(legalDocuments.id, low.id))
          .then(
            () => 'published',
            (error: unknown) =>
              (error as { cause?: { message?: string } }).cause?.message ?? '',
          ),
    );

    expect(outcome).toContain('newer version');
    const [stored] = await client.db
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.id, low.id));
    expect(stored?.status).toBe('draft');
  });

  it('answers superseded to the lower version that lost the race', async () => {
    const low = await draftOf('waiver-race-function');
    const high = await draftOf('waiver-race-function');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(legalDocuments)
          .set(published)
          .where(eq(legalDocuments.id, high.id));
      },
      () => legal.publishLegalDocument(ops, low.id),
    );

    expect(outcome).toEqual({ status: 'superseded' });
    expect(updateTag).not.toHaveBeenCalled();
  });

  it('answers not_a_draft to a second publish of the same draft', async () => {
    const draft = await draftOf('waiver-race-twice');

    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(legalDocuments)
          .set(published)
          .where(eq(legalDocuments.id, draft.id));
      },
      () => legal.publishLegalDocument(ops, draft.id),
    );

    expect(outcome).toEqual({ status: 'not_a_draft' });
  });

  it('stamps the publication time after the lock wait, so a higher version never carries an earlier time', async () => {
    const low = await draftOf('waiver-race-clock');
    const high = await draftOf('waiver-race-clock');
    let started!: () => void;
    const hasStarted = new Promise<void>((resolve) => {
      started = resolve;
    });
    let go!: () => void;
    const mayPublish = new Promise<void>((resolve) => {
      go = resolve;
    });
    // This transaction begins first, fixing its start time, then waits behind the other one.
    const higher = client.db.transaction(async (tx) => {
      await tx.execute(sql`SELECT now()`);
      started();
      await mayPublish;
      await tx
        .update(legalDocuments)
        .set({ status: 'published' })
        .where(eq(legalDocuments.id, high.id));
    });
    await hasStarted;

    await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(legalDocuments)
          .set({ status: 'published' })
          .where(eq(legalDocuments.id, low.id));
      },
      () => {
        go();
        return higher;
      },
    );

    const times = await client.db
      .select({
        version: legalDocuments.version,
        publishedAt: legalDocuments.publishedAt,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, 'waiver-race-clock'))
      .orderBy(legalDocuments.version);
    expect(times.map((row) => row.version)).toEqual([1, 2]);
    const [first, second] = times.map((row) => row.publishedAt?.getTime() ?? 0);
    expect(first).toBeGreaterThan(0);
    expect(second).toBeGreaterThanOrEqual(first ?? 0);
  });

  it('gives the versions that publish among eight concurrent publishes times in version order', async () => {
    const drafts = [];
    for (let n = 0; n < 8; n += 1) {
      drafts.push(await draftOf('waiver-race-eight'));
    }

    const results = await Promise.all(
      drafts.map((draft) => legal.publishLegalDocument(ops, draft.id)),
    );

    const rows = await client.db
      .select({
        version: legalDocuments.version,
        status: legalDocuments.status,
        publishedAt: legalDocuments.publishedAt,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, 'waiver-race-eight'))
      .orderBy(legalDocuments.version);
    const times = rows.flatMap((row) =>
      row.status === 'published' && row.publishedAt
        ? [row.publishedAt.getTime()]
        : [],
    );
    expect(results.filter((r) => r.status === 'published').length).toBe(
      times.length,
    );
    expect(times.length).toBeGreaterThan(0);
    expect(times).toEqual(times.toSorted((a, b) => a - b));
    expect(
      results.every((r) => ['published', 'superseded'].includes(r.status)),
    ).toBe(true);
  });

  it('numbers drafts made at the same moment one above the other', async () => {
    const made = await Promise.all([
      draftOf('waiver-race-numbers', 'A'),
      draftOf('waiver-race-numbers', 'B'),
      draftOf('waiver-race-numbers', 'C'),
    ]);

    expect(made.map((entry) => entry.version).toSorted()).toEqual([1, 2, 3]);
  });
});

describe('editing a legal draft', () => {
  it('answers not_a_draft when a publish commits between the read and the update', async () => {
    const draft = await draftOf('waiver-race-edit');

    // The holder has the row locked with an uncommitted publish, so the editor's first read still
    // sees a draft and its update waits on the row lock. Removing the status predicate from the
    // update would let the edit through (or hit the trigger on a published row).
    const outcome = await raceAgainstOpenTransaction(
      async (tx) => {
        await tx
          .update(legalDocuments)
          .set({ status: 'published' })
          .where(eq(legalDocuments.id, draft.id));
      },
      () =>
        legal.editLegalDraft(ops, draft.id, {
          title: 'Edited too late',
          body: doc('Too late'),
        }),
    );

    expect(outcome).toEqual({ status: 'not_a_draft' });
    const [stored] = await client.db
      .select()
      .from(legalDocuments)
      .where(eq(legalDocuments.id, draft.id));
    expect(stored?.status).toBe('published');
    expect(stored?.title).toBe('Draft');
  });
});

describe('the lookup a legal publish makes of published versions', () => {
  it('asks for at most the listed limit of rows', async () => {
    const draft = await draftOf('waiver-publish-cap');
    const query = vi.spyOn(pg.Client.prototype, 'query');

    try {
      await legal.publishLegalDocument(ops, draft.id);
      const lookups = query.mock.calls.flatMap((call) => {
        const [config, values] = call as unknown as [
          { text?: string },
          unknown[] | undefined,
        ];
        return config.text?.includes('order by') &&
          config.text.includes('limit')
          ? [values ?? []]
          : [];
      });
      expect(lookups).toHaveLength(1);
      expect(
        lookups.some((values) => values.includes(editorialLimits.listed)),
      ).toBe(true);
    } finally {
      query.mockRestore();
    }
  });
});

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

describe('the publication time of a legal version', () => {
  const databaseNow = async () => {
    const result = await client.db.execute(sql`SELECT clock_timestamp() AS t`);
    return new Date((result.rows[0] as { t: Date }).t).getTime();
  };

  it.each([
    ['in the past', new Date('2001-01-01T00:00:00Z')],
    ['in the future', new Date('2999-01-01T00:00:00Z')],
    ['null', null],
  ])(
    'is the moment of publishing, whatever a raw update supplies: %s',
    async (_name, supplied) => {
      const draft = await draftOf(unique('waiver-stamp'));
      const before = await databaseNow();

      await client.db
        .update(legalDocuments)
        .set({ status: 'published', publishedAt: supplied })
        .where(eq(legalDocuments.id, draft.id));

      const after = await databaseNow();
      const [row] = await client.db
        .select({ publishedAt: legalDocuments.publishedAt })
        .from(legalDocuments)
        .where(eq(legalDocuments.id, draft.id));
      const stamped = row?.publishedAt?.getTime() ?? 0;
      expect(stamped).toBeGreaterThanOrEqual(before);
      expect(stamped).toBeLessThanOrEqual(after);
    },
  );

  it('is taken after a wait on a row lock, not when the statement began', async () => {
    const key = unique('waiver-row-lock');
    const low = await draftOf(key);
    const high = await draftOf(key);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let held!: () => void;
    const holding = new Promise<void>((resolve) => {
      held = resolve;
    });
    // An editor holds the row lock of the higher draft, so its publish statement starts first and
    // waits on that lock before the trigger runs.
    const editor = client.db.transaction(async (tx) => {
      await tx
        .update(legalDocuments)
        .set({ title: 'edited' })
        .where(eq(legalDocuments.id, high.id));
      held();
      await gate;
    });
    await holding;
    // A query builder runs only when awaited, so this starts the statement now.
    const highPublish = (async () => {
      await client.db
        .update(legalDocuments)
        .set({ status: 'published' })
        .where(eq(legalDocuments.id, high.id));
    })();
    await aFewMoments();
    await client.db
      .update(legalDocuments)
      .set({ status: 'published' })
      .where(eq(legalDocuments.id, low.id));
    release();
    await editor;
    await highPublish;

    const rows = await client.db
      .select({
        version: legalDocuments.version,
        publishedAt: legalDocuments.publishedAt,
      })
      .from(legalDocuments)
      .where(eq(legalDocuments.doc, key))
      .orderBy(legalDocuments.version);
    expect(rows.map((row) => row.version)).toEqual([1, 2]);
    const [first, second] = rows.map((row) => row.publishedAt?.getTime() ?? 0);
    expect(second).toBeGreaterThan(first ?? Number.MAX_SAFE_INTEGER);
  });
});
