import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  experienceLimits,
  newExperienceValues,
  type ExperienceContent,
  type ExperienceCreateInput,
} from '@/lib/experienceEditor';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { categories, experiences, neighborhoods } from '@/server/db/schema';
import { catalogFixtures, unique, type Parents } from './catalogFixtures';
import {
  createFreshDatabase,
  raceAgainstOpenTransaction as race,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, one per decision, branch or risk:
// - a retired category or neighborhood cannot be newly named: a create and a change to another one are refused with reference_missing and write nothing
// - an experience that already names a retired term keeps it through a save of anything else
// - the editor's choices leave out a retired term, except the one the experience being edited names
// - a save that reads a term waits for a retire in flight and is refused when it commits; without the shared lock it would read the term as in use and name it
// - the database refuses a link-out or affiliate address over the length the guide form allows
// - a retire waits for the last-term check of another retire and is refused when it commits; without the locked re-check both would retire and none would be left

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editor: typeof import('@/server/db/experienceEditor');
let taxonomy: typeof import('@/server/db/taxonomy');
let locks: typeof import('@/server/db/locks');
let fixtures: ReturnType<typeof catalogFixtures>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editor = await import('@/server/db/experienceEditor');
  taxonomy = await import('@/server/db/taxonomy');
  locks = await import('@/server/db/locks');
  fixtures = catalogFixtures(() => client.db);
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const ops = testCaller({
  userId: '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10',
  roles: [Role.Ops],
});

type Tx = Parameters<Parameters<typeof client.db.transaction>[0]>[0];

function raceAgainst<T>(
  holder: (tx: Tx) => Promise<void>,
  challenger: () => Promise<T>,
) {
  return race<Tx, T>((body) => client.db.transaction(body), holder, challenger);
}

const retireNow = (
  tx: Tx,
  table: typeof categories | typeof neighborhoods,
  id: string,
) =>
  tx
    .update(table)
    .set({ retiredAt: sql`clock_timestamp()` })
    .where(eq(table.id, id));

async function parentsWithSpare(): Promise<
  Parents & { spareCategoryId: string; spareNeighborhoodId: string }
> {
  const host = await fixtures.insertHost();
  return {
    hostId: host.id,
    categoryId: (await fixtures.insertCategory()).id,
    neighborhoodId: (await fixtures.insertNeighborhood()).id,
    cancellationTierId: await fixtures.defaultTierId(),
    spareCategoryId: (await fixtures.insertCategory()).id,
    spareNeighborhoodId: (await fixtures.insertNeighborhood()).id,
  };
}

function createInput(
  parents: Parents,
  overrides: Partial<ExperienceCreateInput> = {},
): ExperienceCreateInput {
  const n = unique('exp');
  return {
    ...newExperienceValues(parents),
    name: `Experience ${n}`,
    slug: n,
    hostId: parents.hostId,
    ...overrides,
  };
}

async function made(parents: Parents): Promise<string> {
  const created = await editor.createExperience(ops, createInput(parents));
  if (created.status !== 'created') throw new Error('expected an experience');
  return created.experienceId;
}

async function contentOf(id: string): Promise<ExperienceContent> {
  const view = await editor.readExperienceForOps(ops, id);
  if (!view) throw new Error('expected the experience');
  return view.content;
}

const experienceCount = async () =>
  (await client.db.select({ id: experiences.id }).from(experiences)).length;

describe('a retired term', () => {
  it.each([
    ['category', 'categoryId', 'spareCategoryId'],
    ['neighborhood', 'neighborhoodId', 'spareNeighborhoodId'],
  ] as const)(
    'cannot be named by a new experience: a %s is refused and nothing is written',
    async (kind, field, spare) => {
      const parents = await parentsWithSpare();
      await taxonomy.clickTaxonomyTerm(ops, {
        kind,
        action: 'retire',
        id: parents[spare],
      });
      const before = await experienceCount();

      const result = await editor.createExperience(
        ops,
        createInput(parents, { [field]: parents[spare] }),
      );

      expect(result).toEqual({ status: 'reference_missing' });
      expect(await experienceCount()).toBe(before);
    },
  );

  it('keeps its experience through a save of something else, and refuses a change to another retired one', async () => {
    const parents = await parentsWithSpare();
    const id = await made(parents);
    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'category',
      action: 'retire',
      id: parents.categoryId,
    });

    const content = await contentOf(id);
    const renamed = await editor.updateExperience(ops, id, {
      ...content,
      description: 'Still here',
    });
    expect(renamed).toEqual({ status: 'updated' });

    const other = await fixtures.insertCategory();
    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'category',
      action: 'retire',
      id: other.id,
    });
    expect(
      await editor.updateExperience(ops, id, {
        ...content,
        description: 'Moved',
        categoryId: other.id,
      }),
    ).toEqual({ status: 'reference_missing' });
    expect((await contentOf(id)).categoryId).toBe(parents.categoryId);
  });

  it('is offered to the experience that names it and to nobody else', async () => {
    const parents = await parentsWithSpare();
    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'neighborhood',
      action: 'retire',
      id: parents.neighborhoodId,
    });
    const ids = (choices: { neighborhoods: { value: string }[] }) =>
      choices.neighborhoods.map((option) => option.value);

    expect(ids(await editor.readExperienceChoices(ops))).not.toContain(
      parents.neighborhoodId,
    );
    expect(
      ids(
        await editor.readExperienceChoices(ops, {
          neighborhoodId: parents.neighborhoodId,
        }),
      ),
    ).toContain(parents.neighborhoodId);
  });
});

describe('a guide link', () => {
  it.each(['link_out_url', 'affiliate_url'])(
    'is refused by the database over the length the form allows: %s',
    async (column) => {
      const id = await made(await parentsWithSpare());
      const longUrl = `https://host.example.com/${'a'.repeat(experienceLimits.url)}`;

      await expect(
        client.db.execute(
          sql`UPDATE experiences SET ${sql.raw(column)} = ${longUrl} WHERE id = ${id}`,
        ),
      ).rejects.toThrow();
    },
  );
});

describe('races with a retire', () => {
  it('refuses a save that reads a term while a retire of it is in flight, once it commits', async () => {
    const parents = await parentsWithSpare();

    const result = await raceAgainst(
      async (tx) => {
        await locks.lockFor(tx, 'taxonomy:category');
        await retireNow(tx, categories, parents.spareCategoryId);
      },
      () =>
        editor.createExperience(
          ops,
          createInput(parents, { categoryId: parents.spareCategoryId }),
        ),
    );

    expect(result).toEqual({ status: 'reference_missing' });
  });

  it('refuses a retire of the last term in use when another retire commits first', async () => {
    const only = await client.db
      .insert(neighborhoods)
      .values([
        { slug: unique('race-a'), name: unique('Race A'), position: 0 },
        { slug: unique('race-b'), name: unique('Race B'), position: 1 },
      ])
      .returning();
    const [a, b] = only;
    // The other neighborhoods of this file are retired, so these two are the only ones in use.
    await client.db
      .update(neighborhoods)
      .set({ retiredAt: sql`clock_timestamp()` })
      .where(
        sql`${neighborhoods.id} NOT IN (${sql.join(
          only.map((row) => sql`${row.id}`),
          sql`, `,
        )})`,
      );

    const result = await raceAgainst(
      async (tx) => {
        await locks.lockFor(tx, 'taxonomy:neighborhood');
        await retireNow(tx, neighborhoods, b?.id ?? '');
      },
      () =>
        taxonomy.clickTaxonomyTerm(ops, {
          kind: 'neighborhood',
          action: 'retire',
          id: a?.id ?? '',
        }),
    );

    expect(result).toEqual({ status: 'refused', reason: 'last_active' });
    const stillInUse = await client.db
      .select({ id: neighborhoods.id })
      .from(neighborhoods)
      .where(sql`${neighborhoods.retiredAt} IS NULL`);
    expect(stillInUse.map((row) => row.id)).toEqual([a?.id]);
  });
});
