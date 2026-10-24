import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  categories,
  experiences,
  hosts,
  neighborhoods,
  priceOptions,
  cancellationTiers,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the migration inserts three cancellation tiers and exactly one is the default
// - a guest list holds live and guide-only rows and hides draft, in_review and paused
// - a guest list carries the ids a cache tag needs, children in one result, and no host-only field
// - a guest lookup hides the three hidden statuses, and a malformed or unknown ID is null
// - categories and neighborhoods list by name and look up by slug; a malformed slug is null
// - a renamed slug resolves to its entity, an unknown or malformed one is null, and a slug
//   that is live again is no longer retired
// - an owner lists their own experiences in every status and not another host's
// - the owner of another host, the anonymous caller, a guest and ops are each refused by both restricted reads
// - a host lookup of a missing or malformed ID is null; a malformed host ID lists nothing
// - each CHECK refuses its row, a foreign key restricts delete, and a price option kind is unique

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let catalog: typeof import('@/server/db/catalog');
let policies: typeof import('@/server/db/policies');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  catalog = await import('@/server/db/catalog');
  policies = await import('@/server/db/policies');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

async function defaultTierId() {
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!tier) throw new Error('The migration inserts a default tier');
  return tier.id;
}

async function insertHost(name = unique('Host')) {
  const [row] = await client.db
    .insert(hosts)
    .values({
      slug: unique('host'),
      name,
      timeZone: 'America/New_York',
    })
    .returning();
  if (!row) throw new Error('insert returned no host');
  return row;
}

async function insertCategory(name = unique('Category')) {
  const [row] = await client.db
    .insert(categories)
    .values({ slug: unique('category'), name })
    .returning();
  if (!row) throw new Error('insert returned no category');
  return row;
}

async function insertNeighborhood(name = unique('Neighborhood')) {
  const [row] = await client.db
    .insert(neighborhoods)
    .values({ slug: unique('neighborhood'), name })
    .returning();
  if (!row) throw new Error('insert returned no neighborhood');
  return row;
}

type Parents = {
  hostId: string;
  categoryId: string;
  neighborhoodId: string;
  cancellationTierId: string;
};

async function parents(hostId?: string): Promise<Parents> {
  return {
    hostId: hostId ?? (await insertHost()).id,
    categoryId: (await insertCategory()).id,
    neighborhoodId: (await insertNeighborhood()).id,
    cancellationTierId: await defaultTierId(),
  };
}

async function insertExperience(
  parentIds: Parents,
  overrides: Partial<typeof experiences.$inferInsert> = {},
) {
  const [row] = await client.db
    .insert(experiences)
    .values({
      ...parentIds,
      slug: unique('experience'),
      name: unique('Experience'),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no experience');
  return row;
}

function ownerOf(hostId: string): Caller {
  return testCaller({ roles: [Role.HostOwner], hostIds: [hostId] });
}

describe('cancellation tiers', () => {
  it('are inserted by the migration, shortest notice first, with one default', async () => {
    const tiers = await policies.listCancellationTiers();

    expect(tiers.map((tier) => tier.fullRefundHoursBefore)).toEqual([
      24, 48, 168,
    ]);
    expect(tiers.filter((tier) => tier.isDefault)).toEqual([
      expect.objectContaining({ key: 'flexible', fullRefundHoursBefore: 24 }),
    ]);
  });
});

describe('guest reads', () => {
  const hiddenStatuses = ['draft', 'in_review', 'paused'] as const;
  let liveId: string;
  let guideId: string;
  let hiddenIds: Record<(typeof hiddenStatuses)[number], string>;
  let ids: Parents;

  beforeAll(async () => {
    ids = await parents();
    const live = await insertExperience(ids, {
      name: 'AAA live',
      status: 'live',
      taxTreatment: 'taxable',
      waiverRequired: true,
    });
    liveId = live.id;
    await client.db.insert(priceOptions).values([
      { experienceId: live.id, kind: 'child', priceMinor: 2000 },
      { experienceId: live.id, kind: 'adult', priceMinor: 4500 },
    ]);
    guideId = (
      await insertExperience(ids, {
        name: 'AAB guide',
        status: 'guide_only',
        linkOutUrl: 'https://example.com/class',
      })
    ).id;
    const hide = async (status: (typeof hiddenStatuses)[number]) =>
      (await insertExperience(ids, { name: `AAC ${status}`, status })).id;
    hiddenIds = {
      draft: await hide('draft'),
      in_review: await hide('in_review'),
      paused: await hide('paused'),
    };
  });

  it('lists live and guide-only experiences and hides the rest', async () => {
    const listed = await catalog.listGuestExperiences();

    const names = listed.map((experience) => experience.name);
    expect(names).toContain('AAA live');
    expect(names).toContain('AAB guide');
    expect(names.some((name) => name.startsWith('AAC'))).toBe(false);
  });

  it('carries the ids a cache tag needs, its children, and no host-only field', async () => {
    const listed = await catalog.listGuestExperiences();
    const live = listed.find((experience) => experience.id === liveId);

    expect(live).toMatchObject({
      hostId: ids.hostId,
      categoryId: ids.categoryId,
      neighborhoodId: ids.neighborhoodId,
      host: { id: ids.hostId },
      cancellationTier: { key: 'flexible' },
      waiverRequired: true,
    });
    expect(live?.priceOptions.map((option) => option.kind)).toEqual([
      'adult',
      'child',
    ]);
    expect(live?.priceOptions.map((option) => option.priceMinor)).toEqual([
      4500, 2000,
    ]);
    expect(live).not.toHaveProperty('taxTreatment');
    expect(live?.host).not.toHaveProperty('timeZone');
  });

  it.each([
    ['a live experience', () => liveId],
    ['a guide-only entry', () => guideId],
  ])('looks up %s', async (_name, getId) => {
    const found = await catalog.getGuestExperience(getId());

    expect(found?.id).toBe(getId());
  });

  it.each(hiddenStatuses)(
    'returns null for a %s experience',
    async (status) => {
      expect(await catalog.getGuestExperience(hiddenIds[status])).toBeNull();
    },
  );

  it.each([
    ['a malformed ID', 'not-a-uuid'],
    ['an empty ID', ''],
    ['an unknown ID', '00000000-0000-4000-8000-000000000000'],
  ])('returns null for %s', async (_name, id) => {
    expect(await catalog.getGuestExperience(id)).toBeNull();
  });
});

describe('categories and neighborhoods', () => {
  it('list by name and look up by slug', async () => {
    const zeta = await insertCategory('ZZ Zeta');
    const alpha = await insertCategory('ZZ Alpha');
    const hill = await insertNeighborhood('ZZ Hill');

    const names = (await catalog.listCategories())
      .map((category) => category.name)
      .filter((name) => name.startsWith('ZZ'));

    expect(names).toEqual(['ZZ Alpha', 'ZZ Zeta']);
    expect(await catalog.getCategoryBySlug(alpha.slug)).toEqual(alpha);
    expect(await catalog.getCategoryBySlug(zeta.slug)).toEqual(zeta);
    expect(await catalog.getNeighborhoodBySlug(hill.slug)).toEqual(hill);
    expect(
      (await catalog.listNeighborhoods()).map(({ name }) => name),
    ).toContain('ZZ Hill');
  });

  it.each(['no-such-slug', 'Not A Slug', ''])(
    'return null for the slug %j',
    async (slug) => {
      expect(await catalog.getCategoryBySlug(slug)).toBeNull();
      expect(await catalog.getNeighborhoodBySlug(slug)).toBeNull();
    },
  );
});

describe('slug history', () => {
  it('resolves a retired slug to its entity', async () => {
    const category = await insertCategory();
    const renamed = unique('renamed');
    await client.db
      .update(categories)
      .set({ slug: renamed })
      .where(eq(categories.id, category.id));

    const retired = await catalog.findRetiredSlug('category', category.slug);

    expect(retired).toMatchObject({
      entityKind: 'category',
      entityId: category.id,
      slug: category.slug,
    });
    expect(await catalog.findRetiredSlug('category', renamed)).toBeNull();
  });

  it('records a renamed experience under its own kind', async () => {
    const experience = await insertExperience(await parents());
    await client.db
      .update(experiences)
      .set({ slug: unique('new-name') })
      .where(eq(experiences.id, experience.id));

    expect(
      await catalog.findRetiredSlug('experience', experience.slug),
    ).toMatchObject({ entityId: experience.id });
    expect(await catalog.findRetiredSlug('host', experience.slug)).toBeNull();
  });

  it('stops treating a slug as retired once it is live again', async () => {
    const category = await insertCategory();
    await client.db
      .update(categories)
      .set({ slug: unique('away') })
      .where(eq(categories.id, category.id));
    await client.db
      .update(categories)
      .set({ slug: category.slug })
      .where(eq(categories.id, category.id));

    expect(await catalog.findRetiredSlug('category', category.slug)).toBeNull();
  });

  it.each([
    ['an unknown slug', 'category', 'never-used'],
    ['a malformed slug', 'category', 'Never Used'],
  ] as const)('returns null for %s', async (_name, kind, slug) => {
    expect(await catalog.findRetiredSlug(kind, slug)).toBeNull();
  });
});

describe('host reads', () => {
  let ownerHostId: string;
  let otherHostId: string;
  let draftId: string;

  beforeAll(async () => {
    ownerHostId = (await insertHost()).id;
    otherHostId = (await insertHost()).id;
    const ids = await parents(ownerHostId);
    draftId = (
      await insertExperience(ids, {
        name: 'BBA draft',
        status: 'draft',
        taxTreatment: 'taxable',
      })
    ).id;
    await insertExperience(ids, { name: 'BBB paused', status: 'paused' });
    await insertExperience(await parents(otherHostId), { name: 'BBC other' });
  });

  it("lists the owner's experiences in every status and no other host's", async () => {
    const listed = await catalog.listHostExperiences(
      ownerOf(ownerHostId),
      ownerHostId,
    );

    expect(listed.map((experience) => experience.name)).toEqual([
      'BBA draft',
      'BBB paused',
    ]);
    expect(listed[0]).toMatchObject({
      status: 'draft',
      taxTreatment: 'taxable',
      cancellationTier: { key: 'flexible' },
    });
  });

  it('returns one of the owner’s experiences whatever its status', async () => {
    const found = await catalog.getHostExperience(
      ownerOf(ownerHostId),
      draftId,
    );

    expect(found).toMatchObject({ id: draftId, status: 'draft' });
  });

  it.each([
    ['the owner of another host', () => ownerOf(otherHostId)],
    ['the anonymous caller', () => anonymousCaller],
    ['a guest', () => testCaller()],
    ['ops', () => testCaller({ roles: [Role.Ops] })],
    [
      'host staff',
      () => testCaller({ roles: [Role.HostStaff], hostIds: [ownerHostId] }),
    ],
  ])('refuses %s on both reads', async (_name, getCaller) => {
    await expect(
      catalog.listHostExperiences(getCaller(), ownerHostId),
    ).rejects.toThrow(ForbiddenError);
    await expect(
      catalog.getHostExperience(getCaller(), draftId),
    ).rejects.toThrow(ForbiddenError);
  });

  it.each([
    ['a malformed ID', 'not-a-uuid'],
    ['an unknown ID', '00000000-0000-4000-8000-000000000000'],
  ])('returns null for %s', async (_name, id) => {
    expect(
      await catalog.getHostExperience(ownerOf(ownerHostId), id),
    ).toBeNull();
  });

  it('lists nothing for a malformed host ID', async () => {
    expect(
      await catalog.listHostExperiences(ownerOf(ownerHostId), 'not-a-uuid'),
    ).toEqual([]);
  });
});

describe('constraints', () => {
  it.each([
    [
      'a negative price',
      'price_options_price_not_negative',
      async (ids: Parents) =>
        client.db.insert(priceOptions).values({
          experienceId: (await insertExperience(ids)).id,
          kind: 'adult',
          priceMinor: -1,
        }),
    ],
    [
      'a second price option of the same kind',
      'price_options_experience_kind_unique',
      async (ids: Parents) => {
        const experience = await insertExperience(ids);
        await client.db.insert(priceOptions).values({
          experienceId: experience.id,
          kind: 'adult',
          priceMinor: 1,
        });
        return client.db.insert(priceOptions).values({
          experienceId: experience.id,
          kind: 'adult',
          priceMinor: 2,
        });
      },
    ],
    [
      'an age range with the minimum above the maximum',
      'experiences_age_rule_limits',
      (ids: Parents) =>
        insertExperience(ids, { ageRule: 'age_range', minAge: 12, maxAge: 8 }),
    ],
    [
      'a minimum-age rule with no minimum',
      'experiences_age_rule_limits',
      (ids: Parents) => insertExperience(ids, { ageRule: 'minimum_age' }),
    ],
    [
      'an all-ages rule with a limit',
      'experiences_age_rule_limits',
      (ids: Parents) =>
        insertExperience(ids, { ageRule: 'all_ages', minAge: 5 }),
    ],
    [
      'an outdoor row with no weather policy',
      'experiences_outdoor_has_weather_policy',
      (ids: Parents) => insertExperience(ids, { outdoor: true }),
    ],
    [
      'a decide-before-start policy with no deadline',
      'experiences_weather_decision_hours',
      (ids: Parents) =>
        insertExperience(ids, {
          outdoor: true,
          weatherPolicy: 'decided_before_start',
        }),
    ],
    [
      'a guide-only row with no link',
      'experiences_guide_only_has_link',
      (ids: Parents) => insertExperience(ids, { status: 'guide_only' }),
    ],
    [
      'a link that is not http',
      'experiences_urls_are_http',
      (ids: Parents) =>
        insertExperience(ids, { affiliateUrl: 'javascript:alert(1)' }),
    ],
    [
      'a slug in capitals',
      'experiences_slug_kebab',
      (ids: Parents) => insertExperience(ids, { slug: 'Pottery Night' }),
    ],
    [
      'a second default cancellation tier',
      'cancellation_tiers_one_default',
      () =>
        client.db.insert(cancellationTiers).values({
          key: unique('extra'),
          name: 'Extra',
          fullRefundHoursBefore: 12,
          isDefault: true,
        }),
    ],
  ])('refuse %s', async (_name, constraint, attempt) => {
    await expect(attempt(await parents())).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  it.each([
    [
      'host',
      (ids: Parents) => client.db.delete(hosts).where(eq(hosts.id, ids.hostId)),
    ],
    [
      'category',
      (ids: Parents) =>
        client.db.delete(categories).where(eq(categories.id, ids.categoryId)),
    ],
    [
      'neighborhood',
      (ids: Parents) =>
        client.db
          .delete(neighborhoods)
          .where(eq(neighborhoods.id, ids.neighborhoodId)),
    ],
    [
      'cancellation tier',
      (ids: Parents) =>
        client.db
          .delete(cancellationTiers)
          .where(eq(cancellationTiers.id, ids.cancellationTierId)),
    ],
  ])('keep a %s that an experience uses', async (_name, attempt) => {
    const ids = await parents();
    await insertExperience(ids);

    await expect(attempt(ids)).rejects.toMatchObject({
      cause: { code: '23503' },
    });
  });
});
