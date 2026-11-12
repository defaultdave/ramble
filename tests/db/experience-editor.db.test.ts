import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  newExperienceValues,
  type ExperienceContent,
  type ExperienceCreateInput,
} from '@/lib/experienceEditor';
import { tags } from '@/lib/cacheTags';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { experiences, priceOptions } from '@/server/db/schema';
import { catalogFixtures, unique, type Parents } from './catalogFixtures';
import { doc } from './editorialFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

const cache = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock('next/cache', () => ({
  updateTag: cache.updateTag,
  revalidateTag: vi.fn(),
}));

// Behaviours under test, against the real database, one per decision, branch or risk:
// Access:
// - every function refuses a guest, a host owner, an admin and nobody with ForbiddenError, and writes nothing
// Creating:
// - one transaction makes a draft experience for the host, its price options, and an audit row naming the ops user and the host by id
// - an adult price alone writes one option; both prices write two, the child taking a space as the form says
// - a host, category, neighborhood, tier or waiver that is not there refuses the whole create and writes nothing
// - a waiver must be a published waiver: a draft one, another kind of document and an unknown id are refused
// Updating:
// - a changed field saves with one audit row that names the group, carries the new money and tax, and holds no text
// - a changed price is written to the same option row; a price added where there was none is a new row
// - nothing differing writes nothing, audit row included; a missing or malformed id is not_found
// - a guide-only entry with no link, and a saved price taken away, are refused with the field and change nothing
// - a stale category is refused and nothing changes
// - a changed slug is retired in the slug history by the database
// - an experience guests can see invalidates its tags after the commit, for the old place and the new one; a draft, an unchanged save and a refused save invalidate nothing
// Reading:
// - the list pages by name with a cursor, each experience once, filtered by status, host and category together
// - one experience reads with its host's name and prices; an unknown id reads null
// - the choices list the hosts, the categories, the three tiers with the default marked, and only published waivers

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let editor: typeof import('@/server/db/experienceEditor');
let legal: typeof import('@/server/db/legal');
let fixtures: ReturnType<typeof catalogFixtures>;

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });

const refused: [string, Caller][] = [
  ['a guest', testCaller({ userId: randomUUID() })],
  [
    'a host owner',
    testCaller({
      userId: randomUUID(),
      roles: [Role.HostOwner],
      hostIds: [randomUUID()],
    }),
  ],
  ['an admin', testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
];

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  editor = await import('@/server/db/experienceEditor');
  legal = await import('@/server/db/legal');
  fixtures = catalogFixtures(() => client.db);
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  cache.updateTag.mockClear();
});

const count = async (table: string, where = sql`true`) =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${where}`,
    )
  ).rows[0]?.n ?? 0;

async function auditRows(subjectId: string) {
  const { rows } = await client.db.execute<{
    action: string;
    actor_id: string | null;
    subject_id: string;
    details: Record<string, unknown>;
  }>(
    sql`SELECT action, actor_id, subject_id, details FROM audit_log WHERE subject_id = ${subjectId} AND action LIKE 'experience.%' ORDER BY id`,
  );
  return rows;
}

async function snapshot() {
  return {
    experiences: await count('experiences'),
    options: await count('price_options'),
    audit: await count('audit_log'),
  };
}

function contentFor(
  parents: Parents,
  overrides: Partial<ExperienceContent> = {},
): ExperienceContent {
  const n = unique('exp');
  return {
    ...newExperienceValues(parents),
    name: `Experience ${n}`,
    slug: n,
    ...overrides,
  };
}

function createInput(
  parents: Parents,
  overrides: Partial<ExperienceCreateInput> = {},
): ExperienceCreateInput {
  return { ...contentFor(parents), hostId: parents.hostId, ...overrides };
}

async function made(
  parents: Parents,
  overrides: Partial<ExperienceCreateInput> = {},
) {
  const result = await editor.createExperience(
    ops,
    createInput(parents, overrides),
  );
  if (result.status !== 'created') throw new Error('expected an experience');
  return result.experienceId;
}

/** A saved experience's content, to change a field of and save again. */
async function savedContent(experienceId: string): Promise<ExperienceContent> {
  const view = await editor.readExperienceForOps(ops, experienceId);
  if (!view) throw new Error('expected the experience');
  return view.content;
}

async function publishedWaiver(slug: string) {
  const draft = await legal.createLegalDraft(ops, {
    doc: `waiver-${slug}`,
    title: `Waiver ${slug}`,
    body: doc('I accept the risk.'),
  });
  const published = await legal.publishLegalDocument(ops, draft.id);
  if (published.status !== 'published') throw new Error('not published');
  return published.value;
}

describe('access', () => {
  const missing = randomUUID();
  it.each(refused)(
    'refuses %s everywhere and writes nothing',
    async (_who, caller) => {
      const parents = await fixtures.parents();
      const before = await snapshot();
      const calls = [
        () =>
          editor.readExperiencesForOps(
            caller,
            { status: null, hostId: null, categoryId: null },
            null,
          ),
        () => editor.readExperienceChoices(caller),
        () => editor.readExperienceForOps(caller, missing),
        () => editor.createExperience(caller, createInput(parents)),
        () => editor.updateExperience(caller, missing, contentFor(parents)),
      ];

      for (const call of calls) {
        await expect(call()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await snapshot()).toEqual(before);
    },
  );
});

describe('creating', () => {
  it('makes a draft with its options and one audit row naming the user and the host', async () => {
    const parents = await fixtures.parents();

    const result = await editor.createExperience(
      ops,
      createInput(parents, {
        name: 'Wheel night',
        slug: 'wheel-night',
        adultPriceMinor: 8500,
        childPriceMinor: 4000,
        childUsesSpace: false,
        description: 'Throw a bowl.',
      }),
    );

    if (result.status !== 'created') throw new Error('expected created');
    const [row] = await client.db
      .select()
      .from(experiences)
      .where(eq(experiences.id, result.experienceId));
    expect(row).toMatchObject({
      status: 'draft',
      hostId: parents.hostId,
      name: 'Wheel night',
      slug: 'wheel-night',
      description: 'Throw a bowl.',
    });
    const options = await client.db
      .select()
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, result.experienceId))
      .orderBy(priceOptions.kind);
    expect(options).toMatchObject([
      { kind: 'adult', priceMinor: 8500, usesSpace: true },
      { kind: 'child', priceMinor: 4000, usesSpace: false },
    ]);
    expect(await auditRows(result.experienceId)).toEqual([
      {
        action: 'experience.created',
        actor_id: opsUser,
        subject_id: result.experienceId,
        details: { host_id: parents.hostId },
      },
    ]);
  });

  it('writes one option for an adult price alone and none for no prices', async () => {
    const parents = await fixtures.parents();

    const priced = await made(parents, { adultPriceMinor: 5000 });
    const free = await made(parents);

    expect(await count('price_options', sql`experience_id = ${priced}`)).toBe(
      1,
    );
    expect(await count('price_options', sql`experience_id = ${free}`)).toBe(0);
  });

  it.each<[string, (parents: Parents) => Partial<ExperienceCreateInput>]>([
    ['host', () => ({ hostId: randomUUID() })],
    ['category', () => ({ categoryId: randomUUID() })],
    ['neighborhood', () => ({ neighborhoodId: randomUUID() })],
    ['tier', () => ({ cancellationTierId: randomUUID() })],
    [
      'waiver',
      () => ({ waiverRequired: true, waiverDocumentId: randomUUID() }),
    ],
  ])(
    'refuses a %s that is not there and writes nothing',
    async (_what, overrides) => {
      const parents = await fixtures.parents();
      const before = await snapshot();

      const result = await editor.createExperience(
        ops,
        createInput(parents, { adultPriceMinor: 5000, ...overrides(parents) }),
      );

      expect(result).toEqual({ status: 'reference_missing' });
      expect(await snapshot()).toEqual(before);
    },
  );

  it('accepts a published waiver and refuses a draft one and another kind of document', async () => {
    const parents = await fixtures.parents();
    const published = await publishedWaiver(unique('clay'));
    const draft = await legal.createLegalDraft(ops, {
      doc: `waiver-${unique('draft')}`,
      title: 'Still a draft',
      body: doc('Not yet.'),
    });
    const terms = await publishedTerms();
    const create = (waiverDocumentId: string) =>
      editor.createExperience(
        ops,
        createInput(parents, { waiverRequired: true, waiverDocumentId }),
      );

    expect((await create(published.id)).status).toBe('created');
    expect(await create(draft.id)).toEqual({ status: 'reference_missing' });
    expect(await create(terms)).toEqual({ status: 'reference_missing' });
  });
});

async function publishedTerms(): Promise<string> {
  const draft = await legal.createLegalDraft(ops, {
    doc: 'terms',
    title: 'Marketplace terms',
    body: doc('Terms.'),
  });
  const published = await legal.publishLegalDocument(ops, draft.id);
  if (published.status !== 'published') throw new Error('not published');
  return published.value.id;
}

describe('updating', () => {
  it('saves a changed field with one audit row that names the group and holds no text', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents);
    const content = await savedContent(id);

    const result = await editor.updateExperience(ops, id, {
      ...content,
      name: 'A new name',
      description: 'A new description',
      taxTreatment: 'taxable',
    });

    expect(result).toEqual({ status: 'updated' });
    const view = await editor.readExperienceForOps(ops, id);
    expect(view?.content).toMatchObject({
      name: 'A new name',
      description: 'A new description',
      taxTreatment: 'taxable',
    });
    const [, updated] = await auditRows(id);
    expect(updated).toMatchObject({
      action: 'experience.updated',
      actor_id: opsUser,
      details: {
        changed_text: true,
        changed_tax: true,
        tax_treatment: 'taxable',
      },
    });
    expect(JSON.stringify(updated?.details)).not.toContain('A new');
  });

  it('writes a changed price to the same option row, and a price added to a new row', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents, { adultPriceMinor: 5000 });
    const [adultBefore] = await client.db
      .select()
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, id));
    const content = await savedContent(id);

    await editor.updateExperience(ops, id, {
      ...content,
      adultPriceMinor: 6000,
      childPriceMinor: 3000,
      childUsesSpace: false,
    });

    const options = await client.db
      .select()
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, id))
      .orderBy(priceOptions.kind);
    expect(options).toMatchObject([
      { id: adultBefore?.id, kind: 'adult', priceMinor: 6000 },
      { kind: 'child', priceMinor: 3000, usesSpace: false },
    ]);
    const [, updated] = await auditRows(id);
    expect(updated?.details).toEqual({
      changed_prices: true,
      adult_price_minor: 6000,
      child_price_minor: 3000,
    });
  });

  it('writes nothing, audit row included, when nothing differs', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents, { adultPriceMinor: 5000 });
    const content = await savedContent(id);
    const before = await snapshot();

    const result = await editor.updateExperience(ops, id, content);

    expect(result).toEqual({ status: 'unchanged' });
    expect(await snapshot()).toEqual(before);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it.each([
    ['a missing id', randomUUID()],
    ['a malformed id', 'nope'],
  ])('is not_found for %s', async (_label, id) => {
    const parents = await fixtures.parents();

    const result = await editor.updateExperience(ops, id, contentFor(parents));

    expect(result).toEqual({ status: 'not_found' });
  });

  it('refuses a guide-only entry with no link and changes nothing', async () => {
    const parents = await fixtures.parents();
    const guide = await fixtures.insertExperience(parents, {
      status: 'guide_only',
      linkOutUrl: 'https://example.com/guide',
    });
    const content = await savedContent(guide.id);

    const result = await editor.updateExperience(ops, guide.id, {
      ...content,
      name: 'Renamed',
      linkOutUrl: null,
    });

    expect(result).toEqual({ status: 'invalid', fields: ['linkOutUrl'] });
    const [row] = await client.db
      .select()
      .from(experiences)
      .where(eq(experiences.id, guide.id));
    expect(row).toMatchObject({
      name: guide.name,
      linkOutUrl: 'https://example.com/guide',
    });
  });

  it('refuses a saved price taken away, naming each, and changes nothing', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents, {
      adultPriceMinor: 5000,
      childPriceMinor: 2500,
    });
    const content = await savedContent(id);
    const before = await snapshot();

    const result = await editor.updateExperience(ops, id, {
      ...content,
      name: 'Renamed',
      adultPriceMinor: null,
      childPriceMinor: null,
    });

    expect(result).toEqual({
      status: 'invalid',
      fields: ['adultPrice', 'childPrice'],
    });
    expect(await snapshot()).toEqual(before);
  });

  it('refuses a stale category and changes nothing', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents);
    const content = await savedContent(id);
    const before = await snapshot();

    const result = await editor.updateExperience(ops, id, {
      ...content,
      name: 'Renamed',
      categoryId: randomUUID(),
    });

    expect(result).toEqual({ status: 'reference_missing' });
    expect(await snapshot()).toEqual(before);
  });

  it('has the database retire a changed slug', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents, { slug: 'old-address' });
    const content = await savedContent(id);

    await editor.updateExperience(ops, id, { ...content, slug: 'new-address' });

    expect(
      await count(
        'slug_history',
        sql`entity_id = ${id} AND slug = 'old-address' AND entity_kind = 'experience'`,
      ),
    ).toBe(1);
  });

  it('serializes two saves of one experience, so both land and neither is lost', async () => {
    const parents = await fixtures.parents();
    const id = await made(parents);
    const content = await savedContent(id);

    const results = await Promise.all([
      editor.updateExperience(ops, id, { ...content, name: 'First' }),
      editor.updateExperience(ops, id, { ...content, name: 'Second' }),
    ]);

    expect(results.map((r) => r.status)).toEqual(['updated', 'updated']);
    expect(await auditRows(id)).toHaveLength(3);
  });
});

describe('cache invalidation', () => {
  it('invalidates a live experience for its place, and for the new place when it moves', async () => {
    const parents = await fixtures.parents();
    const live = await fixtures.insertExperience(parents, { status: 'live' });
    const [oldCategory, oldHood] = await Promise.all([
      client.db.query.categories.findFirst({
        where: (t, { eq: is }) => is(t.id, parents.categoryId),
      }),
      client.db.query.neighborhoods.findFirst({
        where: (t, { eq: is }) => is(t.id, parents.neighborhoodId),
      }),
    ]);
    const other = await fixtures.parents(parents.hostId);
    const [newCategory, newHood] = await Promise.all([
      client.db.query.categories.findFirst({
        where: (t, { eq: is }) => is(t.id, other.categoryId),
      }),
      client.db.query.neighborhoods.findFirst({
        where: (t, { eq: is }) => is(t.id, other.neighborhoodId),
      }),
    ]);
    const content = await savedContent(live.id);

    await editor.updateExperience(ops, live.id, {
      ...content,
      name: 'Moved',
      categoryId: other.categoryId,
      neighborhoodId: other.neighborhoodId,
    });

    const invalidated = cache.updateTag.mock.calls.map(
      ([tag]) => tag as string,
    );
    expect(invalidated).toEqual(
      expect.arrayContaining([
        tags.experience(live.id),
        tags.catalog,
        tags.category(oldCategory?.slug ?? ''),
        tags.neighborhood(oldHood?.slug ?? ''),
        tags.category(newCategory?.slug ?? ''),
        tags.neighborhood(newHood?.slug ?? ''),
      ]),
    );
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'invalidates nothing for a %s experience',
    async (status) => {
      const parents = await fixtures.parents();
      const hidden = await fixtures.insertExperience(parents, { status });
      const content = await savedContent(hidden.id);

      await editor.updateExperience(ops, hidden.id, {
        ...content,
        name: 'Edited',
      });

      expect(cache.updateTag).not.toHaveBeenCalled();
    },
  );

  it('invalidates nothing for a save that was refused', async () => {
    const parents = await fixtures.parents();
    const live = await fixtures.insertExperience(parents, { status: 'live' });
    const content = await savedContent(live.id);

    await editor.updateExperience(ops, live.id, {
      ...content,
      categoryId: randomUUID(),
    });

    expect(cache.updateTag).not.toHaveBeenCalled();
  });
});

describe('reading', () => {
  it('pages by name with a cursor, each experience once, and filters by status, host and category together', async () => {
    const parents = await fixtures.parents();
    const names = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'].map(
      (name) => `${unique('page')} ${name}`,
    );
    for (const name of names) {
      await fixtures.insertExperience(parents, { name, status: 'live' });
    }
    await fixtures.insertExperience(parents, {
      name: `${unique('page')} Draft`,
      status: 'draft',
    });
    const only = {
      status: 'live',
      hostId: parents.hostId,
      categoryId: parents.categoryId,
    } as const;

    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const page = await editor.readExperiencesForOps(ops, only, cursor);
      seen.push(...page.rows.map((row) => row.name));
      cursor = page.nextCursor;
      pages += 1;
    } while (cursor !== null && pages < 10);

    expect(seen).toEqual([...names].sort());
    expect(seen).toHaveLength(5);
    const drafts = await editor.readExperiencesForOps(
      ops,
      { ...only, status: 'draft' },
      null,
    );
    expect(drafts.rows.map((row) => row.status)).toEqual(['draft']);
    const elsewhere = await editor.readExperiencesForOps(
      ops,
      { ...only, hostId: (await fixtures.insertHost()).id },
      null,
    );
    expect(elsewhere.rows).toEqual([]);
  });

  it('shows the host and category names on a row', async () => {
    const host = await fixtures.insertHost({ name: unique('Named host') });
    const parents = await fixtures.parents(host.id);
    const experience = await fixtures.insertExperience(parents);

    const page = await editor.readExperiencesForOps(
      ops,
      { status: null, hostId: host.id, categoryId: null },
      null,
    );

    expect(page.rows).toMatchObject([
      { id: experience.id, hostName: host.name, status: 'draft' },
    ]);
  });

  it('reads one experience with its host name and prices, and null for an unknown id', async () => {
    const host = await fixtures.insertHost({ name: unique('Reading host') });
    const parents = await fixtures.parents(host.id);
    const id = await made(parents, { adultPriceMinor: 7000 });

    const view = await editor.readExperienceForOps(ops, id);

    expect(view).toMatchObject({
      id,
      hostId: host.id,
      hostName: host.name,
      status: 'draft',
      content: { adultPriceMinor: 7000, childPriceMinor: null },
    });
    expect(await editor.readExperienceForOps(ops, randomUUID())).toBeNull();
    expect(await editor.readExperienceForOps(ops, 'nope')).toBeNull();
  });

  it('lists the choices: names in order, the tiers shortest notice first, and only published waivers', async () => {
    const parents = await fixtures.parents();
    const published = await publishedWaiver(unique('listed'));
    await legal.createLegalDraft(ops, {
      doc: `waiver-${unique('unlisted')}`,
      title: 'A draft waiver',
      body: doc('Draft.'),
    });

    const choices = await editor.readExperienceChoices(ops);

    expect(choices.hosts.map((host) => host.value)).toContain(parents.hostId);
    expect(choices.categories.map((c) => c.value)).toContain(
      parents.categoryId,
    );
    expect(choices.cancellationTiers).toHaveLength(3);
    expect(choices.defaultCancellationTierId).toBe(parents.cancellationTierId);
    expect(choices.waivers.map((waiver) => waiver.value)).toContain(
      published.id,
    );
    expect(
      choices.waivers.every((w) => !w.label.includes('A draft waiver')),
    ).toBe(true);
  });
});
