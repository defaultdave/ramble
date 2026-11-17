import { randomUUID } from 'node:crypto';
import { updateTag } from 'next/cache';
import { asc, eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { catalogLimits } from '@/lib/catalog';
import { taxonomyLimits, type TaxonomyKind } from '@/lib/taxonomy';
import { ForbiddenError, Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { auditLog, categories, neighborhoods } from '@/server/db/schema';
import { unique } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, against the real database, one per decision, branch or risk:
// - every function refuses a guest, a host owner and nobody with ForbiddenError, and writes nothing; ops and admin are let through
// - adding puts the term last, writes one audit row with ids only, and clears the taxonomy tag after the commit
// - an address or name another term has, and a full list, are refused and write no row, no audit row and clear no tag
// - renaming changes the name only and keeps the address; the same name writes and clears nothing
// - moving writes the places that changed, the guest read follows them, and a list that began with ties ends with none
// - retiring stamps the time and can be undone; the last term that is not retired cannot be retired
// - a button for a term that is gone or already in that state is stale and writes nothing
// - the database refuses a position or name or address or time the rules would refuse
// - the editor read returns retired terms in the list order

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let taxonomy: typeof import('@/server/db/taxonomy');
let catalog: typeof import('@/server/db/catalog');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  taxonomy = await import('@/server/db/taxonomy');
  catalog = await import('@/server/db/catalog');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

/** The audit log is append-only and shared by the file, so each test reads only the rows after its start. */
let auditMark = 0;

beforeEach(async () => {
  vi.mocked(updateTag).mockClear();
  await client.db.delete(categories);
  await client.db.delete(neighborhoods);
  auditMark = (await client.db.select({ id: auditLog.id }).from(auditLog))
    .length;
});

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const admin = testCaller({ userId: randomUUID(), roles: [Role.Admin] });
const tagsUpdated = () => vi.mocked(updateTag).mock.calls.map(([tag]) => tag);

const tableOf = (kind: TaxonomyKind) =>
  kind === 'category' ? categories : neighborhoods;

async function seed(kind: TaxonomyKind, names: string[]) {
  const table = tableOf(kind);
  const rows = await client.db
    .insert(table)
    .values(
      names.map((name, position) => ({
        slug: unique(name.toLowerCase()),
        name,
        position,
      })),
    )
    .returning();
  return rows;
}

async function namesInOrder(kind: TaxonomyKind) {
  return (await taxonomy.listTaxonomyForEditing(ops, kind)).map((t) => t.name);
}

async function auditRows() {
  const rows = await client.db
    .select()
    .from(auditLog)
    .orderBy(asc(auditLog.id));
  return rows.slice(auditMark);
}

describe('access', () => {
  const refused = [
    ['a guest', testCaller({ userId: randomUUID() })],
    [
      'a host owner',
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostOwner],
        hostIds: [randomUUID()],
      }),
    ],
    ['nobody', { userId: null, roles: [], hostIds: [] }],
  ] as const;

  it.each(refused)(
    'refuses %s everywhere and writes nothing',
    async (_who, caller) => {
      const [row] = await seed('category', ['One', 'Two']);
      const before = await auditRows();
      const calls = [
        () => taxonomy.listTaxonomyForEditing(caller, 'category'),
        () =>
          taxonomy.addTaxonomyTerm(caller, {
            kind: 'category',
            name: 'New',
            slug: 'new',
          }),
        () =>
          taxonomy.renameTaxonomyTerm(caller, {
            kind: 'category',
            id: row?.id ?? '',
            name: 'Renamed',
          }),
        () =>
          taxonomy.clickTaxonomyTerm(caller, {
            kind: 'category',
            action: 'retire',
            id: row?.id ?? '',
          }),
      ];
      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await namesInOrder('category')).toEqual(['One', 'Two']);
      expect(await auditRows()).toHaveLength(before.length);
      expect(tagsUpdated()).toEqual([]);
    },
  );

  it('lets admin through', async () => {
    await expect(
      taxonomy.addTaxonomyTerm(admin, {
        kind: 'neighborhood',
        name: 'Dumbo',
        slug: 'dumbo',
      }),
    ).resolves.toEqual({ status: 'saved', done: 'added' });
  });
});

describe('adding', () => {
  it.each(['category', 'neighborhood'] as const)(
    'puts a %s last, writes an audit row with ids only, and clears the taxonomy tag',
    async (kind) => {
      await seed(kind, ['First', 'Second']);

      const result = await taxonomy.addTaxonomyTerm(ops, {
        kind,
        name: 'Secret name here',
        slug: 'third',
      });

      expect(result).toEqual({ status: 'saved', done: 'added' });
      expect(await namesInOrder(kind)).toEqual([
        'First',
        'Second',
        'Secret name here',
      ]);
      const [row] = await auditRows();
      expect(row).toMatchObject({
        actorKind: 'user',
        actorId: opsUser,
        action: `${kind}.added`,
        subjectKind: kind,
      });
      expect(JSON.stringify(row)).not.toContain('Secret');
      expect(tagsUpdated()).toEqual(['taxonomy']);
    },
  );

  it.each([
    [
      'an address another term has',
      { name: 'Fresh', slug: 'one' },
      'slug_taken',
    ],
    ['a name another term has', { name: 'one', slug: 'fresh' }, 'name_taken'],
  ])('refuses %s and writes nothing', async (_label, input, reason) => {
    await client.db
      .insert(categories)
      .values({ slug: 'one', name: 'One', position: 0 });

    const result = await taxonomy.addTaxonomyTerm(ops, {
      kind: 'category',
      ...input,
    });

    expect(result).toEqual({ status: 'refused', reason });
    expect(await namesInOrder('category')).toEqual(['One']);
    expect(await auditRows()).toEqual([]);
    expect(tagsUpdated()).toEqual([]);
  });

  it('refuses a term when the list is full', async () => {
    await client.db.insert(neighborhoods).values(
      Array.from({ length: catalogLimits.neighborhoods }, (_, n) => ({
        slug: `full-${String(n)}`,
        name: `Full ${String(n)}`,
        position: n,
      })),
    );

    expect(
      await taxonomy.addTaxonomyTerm(ops, {
        kind: 'neighborhood',
        name: 'One more',
        slug: 'one-more',
      }),
    ).toEqual({ status: 'refused', reason: 'list_full' });
  });

  it('refuses input the schema refuses, before the database', async () => {
    await expect(
      taxonomy.addTaxonomyTerm(ops, {
        kind: 'category',
        name: ' ',
        slug: 'ok',
      }),
    ).rejects.toThrow();
  });
});

describe('renaming', () => {
  it('changes the name and keeps the address, with an audit row and the tag', async () => {
    const [first] = await seed('category', ['Pottery']);

    const result = await taxonomy.renameTaxonomyTerm(ops, {
      kind: 'category',
      id: first?.id ?? '',
      name: 'Ceramics',
    });

    expect(result).toEqual({ status: 'saved', done: 'renamed' });
    const [row] = await taxonomy.listTaxonomyForEditing(ops, 'category');
    expect(row).toMatchObject({ name: 'Ceramics', slug: first?.slug });
    expect((await auditRows())[0]).toMatchObject({
      action: 'category.renamed',
      subjectId: first?.id,
    });
    expect(tagsUpdated()).toEqual(['taxonomy']);
  });

  it('writes and clears nothing when the name is the same', async () => {
    const [first] = await seed('category', ['Pottery']);

    expect(
      await taxonomy.renameTaxonomyTerm(ops, {
        kind: 'category',
        id: first?.id ?? '',
        name: 'Pottery',
      }),
    ).toEqual({ status: 'unchanged' });
    expect(await auditRows()).toEqual([]);
    expect(tagsUpdated()).toEqual([]);
  });

  it('refuses another term’s name and a term that is gone', async () => {
    const [a] = await seed('neighborhood', ['Dumbo', 'Tribeca']);

    expect(
      await taxonomy.renameTaxonomyTerm(ops, {
        kind: 'neighborhood',
        id: a?.id ?? '',
        name: 'TRIBECA',
      }),
    ).toEqual({ status: 'refused', reason: 'name_taken' });
    expect(
      await taxonomy.renameTaxonomyTerm(ops, {
        kind: 'neighborhood',
        id: randomUUID(),
        name: 'Anything',
      }),
    ).toEqual({ status: 'refused', reason: 'stale' });
  });
});

describe('moving', () => {
  it('writes the new places and the guest read follows', async () => {
    const [a, b, c] = await seed('category', ['A', 'B', 'C']);

    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'category',
      action: 'down',
      id: a?.id ?? '',
    });
    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'category',
      action: 'up',
      id: c?.id ?? '',
    });

    expect(await namesInOrder('category')).toEqual(['B', 'C', 'A']);
    expect((await catalog.listCategories()).map((t) => t.name)).toEqual([
      'B',
      'C',
      'A',
    ]);
    expect(b).toBeDefined();
    expect(
      (await auditRows()).map((row) => [row.action, row.subjectId]),
    ).toEqual([
      ['category.moved', a?.id],
      ['category.moved', c?.id],
    ]);
  });

  it('numbers every term when the list began with ties, ordered by name', async () => {
    const rows = await client.db
      .insert(neighborhoods)
      .values([
        { slug: 'tie-a', name: 'A', position: 0 },
        { slug: 'tie-b', name: 'B', position: 0 },
        { slug: 'tie-c', name: 'C', position: 0 },
      ])
      .returning();
    const a = rows.find((row) => row.name === 'A');

    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'neighborhood',
      action: 'down',
      id: a?.id ?? '',
    });

    const positions = await client.db
      .select({ name: neighborhoods.name, position: neighborhoods.position })
      .from(neighborhoods)
      .orderBy(asc(neighborhoods.position));
    expect(positions).toEqual([
      { name: 'B', position: 0 },
      { name: 'A', position: 1 },
      { name: 'C', position: 2 },
    ]);
  });

  it.each([
    ['up from the top', 'up', 0],
    ['down from the bottom', 'down', 1],
  ] as const)(
    'is stale for %s and writes nothing',
    async (_label, action, at) => {
      const rows = await seed('category', ['A', 'B']);

      expect(
        await taxonomy.clickTaxonomyTerm(ops, {
          kind: 'category',
          action,
          id: rows[at]?.id ?? '',
        }),
      ).toEqual({ status: 'refused', reason: 'stale' });
      expect(await auditRows()).toEqual([]);
      expect(tagsUpdated()).toEqual([]);
    },
  );
});

describe('retiring', () => {
  it('stamps the time and can be undone', async () => {
    const [a] = await seed('category', ['A', 'B']);
    const click = (action: 'retire' | 'restore') =>
      taxonomy.clickTaxonomyTerm(ops, {
        kind: 'category',
        action,
        id: a?.id ?? '',
      });

    expect(await click('retire')).toEqual({ status: 'saved', done: 'retired' });
    const [retired] = await taxonomy.listTaxonomyForEditing(ops, 'category');
    expect(retired?.retiredAt).toBeInstanceOf(Date);
    expect(tagsUpdated()).toEqual(['taxonomy']);

    expect(await click('restore')).toEqual({
      status: 'saved',
      done: 'restored',
    });
    const [back] = await taxonomy.listTaxonomyForEditing(ops, 'category');
    expect(back?.retiredAt).toBeNull();
    expect((await auditRows()).map((row) => row.action)).toEqual([
      'category.retired',
      'category.restored',
    ]);
  });

  it('refuses to retire the last term that is not retired, whatever sits beside it', async () => {
    const [a, b] = await seed('neighborhood', ['A', 'B']);
    await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'neighborhood',
      action: 'retire',
      id: a?.id ?? '',
    });
    vi.mocked(updateTag).mockClear();

    const result = await taxonomy.clickTaxonomyTerm(ops, {
      kind: 'neighborhood',
      action: 'retire',
      id: b?.id ?? '',
    });

    expect(result).toEqual({ status: 'refused', reason: 'last_active' });
    expect(
      (await taxonomy.listTaxonomyForEditing(ops, 'neighborhood')).filter(
        (term) => term.retiredAt === null,
      ),
    ).toHaveLength(1);
    expect(tagsUpdated()).toEqual([]);
  });

  it.each([
    ['retire of a retired term', 'retire'],
    ['restore of a term in use', 'restore'],
  ] as const)('is stale for a %s', async (_label, action) => {
    const [a, b] = await seed('category', ['A', 'B']);
    const target = action === 'retire' ? b : a;
    if (action === 'retire') {
      await taxonomy.clickTaxonomyTerm(ops, {
        kind: 'category',
        action: 'retire',
        id: b?.id ?? '',
      });
    }

    expect(
      await taxonomy.clickTaxonomyTerm(ops, {
        kind: 'category',
        action,
        id: target?.id ?? '',
      }),
    ).toEqual({ status: 'refused', reason: 'stale' });
  });
});

describe('what the database refuses', () => {
  const base = { slug: 'ok', name: 'Ok' };
  it.each([
    ['a position at the cap', { position: catalogLimits.categories }],
    ['a negative position', { position: -1 }],
    ['a name over the limit', { name: 'n'.repeat(taxonomyLimits.name + 1) }],
    ['a blank name', { name: '   ' }],
    [
      'an address over the limit',
      { slug: 'a'.repeat(taxonomyLimits.slug + 1) },
    ],
    [
      'a retirement time past year 9999',
      { retiredAt: new Date('+020000-01-01T00:00:00Z') },
    ],
  ])('refuses a category with %s', async (_label, overrides) => {
    await expect(
      client.db.insert(categories).values({ ...base, ...overrides }),
    ).rejects.toThrow();
  });

  it('refuses a neighborhood position at its cap', async () => {
    await expect(
      client.db.insert(neighborhoods).values({
        ...base,
        position: catalogLimits.neighborhoods,
      }),
    ).rejects.toThrow();
  });

  it('accepts the largest position and a name at the limit', async () => {
    await client.db.insert(categories).values({
      slug: 'edge',
      name: 'n'.repeat(taxonomyLimits.name),
      position: catalogLimits.categories - 1,
    });
    expect(
      await client.db
        .select({ n: sql<number>`count(*)::int` })
        .from(categories)
        .where(eq(categories.slug, 'edge')),
    ).toEqual([{ n: 1 }]);
  });
});
