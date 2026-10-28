import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { httpUrlPattern } from '@/lib/catalog';
import { testCaller } from '@/server/auth/test-caller';
import {
  categories,
  experiences,
  hosts,
  neighborhoods,
  priceOptions,
  cancellationTiers,
  slugHistory,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the migration inserts three cancellation tiers and exactly one is the default
// - a guest lookup carries the ids a cache tag needs, children in one result, and no host-only field
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

async function insertHost(overrides: Partial<typeof hosts.$inferInsert> = {}) {
  const [row] = await client.db
    .insert(hosts)
    .values({
      slug: unique('host'),
      name: unique('Host'),
      timeZone: 'America/New_York',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no host');
  return row;
}

async function insertCategory(
  overrides: Partial<typeof categories.$inferInsert> = {},
) {
  const [row] = await client.db
    .insert(categories)
    .values({
      slug: unique('category'),
      name: unique('Category'),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no category');
  return row;
}

async function insertNeighborhood(
  overrides: Partial<typeof neighborhoods.$inferInsert> = {},
) {
  const [row] = await client.db
    .insert(neighborhoods)
    .values({
      slug: unique('neighborhood'),
      name: unique('Neighborhood'),
      ...overrides,
    })
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

  it('carries the ids a cache tag needs, its children, and no host-only field', async () => {
    const live = await catalog.getGuestExperience(liveId);

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
    const zeta = await insertCategory({ name: 'ZZ Zeta' });
    const alpha = await insertCategory({ name: 'ZZ Alpha' });
    const hill = await insertNeighborhood({ name: 'ZZ Hill' });

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
  // Category and neighborhood slugs are unique while live; experience and host slugs repeat.
  const uniqueKinds = [
    {
      kind: 'category',
      insert: async (slug: string) => (await insertCategory({ slug })).id,
      rename: (id: string, slug: string) =>
        client.db.update(categories).set({ slug }).where(eq(categories.id, id)),
    },
    {
      kind: 'neighborhood',
      insert: async (slug: string) => (await insertNeighborhood({ slug })).id,
      rename: (id: string, slug: string) =>
        client.db
          .update(neighborhoods)
          .set({ slug })
          .where(eq(neighborhoods.id, id)),
    },
  ] as const;

  const repeatingKinds = [
    {
      kind: 'experience',
      insert: async (slug: string) =>
        (await insertExperience(await parents(), { slug })).id,
      rename: (id: string, slug: string) =>
        client.db
          .update(experiences)
          .set({ slug })
          .where(eq(experiences.id, id)),
    },
    {
      kind: 'host',
      insert: async (slug: string) => (await insertHost({ slug })).id,
      rename: (id: string, slug: string) =>
        client.db.update(hosts).set({ slug }).where(eq(hosts.id, id)),
    },
  ] as const;

  describe.each(uniqueKinds)('$kind', ({ kind, insert, rename }) => {
    it('resolves a retired slug to its entity', async () => {
      const old = unique('old');
      const renamed = unique('renamed');
      const id = await insert(old);
      await rename(id, renamed);

      expect(await catalog.findRetiredSlug(kind, old)).toMatchObject({
        entityKind: kind,
        entityId: id,
        slug: old,
      });
      expect(await catalog.findRetiredSlug(kind, renamed)).toBeNull();
    });

    it('is not retired again once its own entity takes the slug back', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('away'));
      await rename(id, old);

      expect(await catalog.findRetiredSlug(kind, old)).toBeNull();
    });

    it('drops a retired slug when another entity is inserted with it', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('away'));
      await insert(old);

      expect(await catalog.findRetiredSlug(kind, old)).toBeNull();
    });

    it('drops a retired slug when another entity is renamed to it', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('away'));
      await rename(await insert(unique('other')), old);

      expect(await catalog.findRetiredSlug(kind, old)).toBeNull();
    });

    it('does not record a slug that never changed', async () => {
      const slug = unique('steady');
      await insert(slug);

      expect(await catalog.findRetiredSlug(kind, slug)).toBeNull();
    });
  });

  describe.each(repeatingKinds)('$kind', ({ kind, insert, rename }) => {
    it('resolves a retired slug to its entity', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('renamed'));

      expect(await catalog.findRetiredSlug(kind, old)).toMatchObject({
        entityKind: kind,
        entityId: id,
        slug: old,
      });
    });

    it('keeps each entity’s own history when two retire the same slug', async () => {
      const shared = unique('shared');
      const first = await insert(shared);
      const second = await insert(shared);
      await rename(first, unique('first-new'));
      await rename(second, unique('second-new'));

      const rows = await client.db
        .select()
        .from(slugHistory)
        .where(eq(slugHistory.slug, shared));

      expect(rows.map((row) => row.entityId).sort()).toEqual(
        [first, second].sort(),
      );
      expect(rows.every((row) => row.entityKind === kind)).toBe(true);
      expect(await catalog.findRetiredSlug(kind, shared)).toMatchObject({
        entityId: second,
      });
    });

    it('leaves another entity’s history alone when a new entity is inserted with the slug', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('away'));
      await insert(old);

      expect(await catalog.findRetiredSlug(kind, old)).toMatchObject({
        entityId: id,
      });
    });

    it('leaves another entity’s history alone when one is renamed to the slug', async () => {
      const old = unique('old');
      const id = await insert(old);
      await rename(id, unique('away'));
      await rename(await insert(unique('other')), old);

      expect(await catalog.findRetiredSlug(kind, old)).toMatchObject({
        entityId: id,
      });
    });

    it('drops a retired slug only when the same entity takes it back', async () => {
      const shared = unique('shared');
      const first = await insert(shared);
      const second = await insert(shared);
      await rename(first, unique('first-new'));
      await rename(second, unique('second-new'));
      await rename(first, shared);

      expect(await catalog.findRetiredSlug(kind, shared)).toMatchObject({
        entityId: second,
      });
    });
  });

  it('keeps the kinds apart', async () => {
    const old = unique('old');
    const id = await insertHost({ slug: old }).then((host) => host.id);
    await client.db
      .update(hosts)
      .set({ slug: unique('away') })
      .where(eq(hosts.id, id));

    expect(await catalog.findRetiredSlug('host', old)).not.toBeNull();
    expect(await catalog.findRetiredSlug('experience', old)).toBeNull();
    expect(await catalog.findRetiredSlug('category', old)).toBeNull();
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
      'experiences_affiliate_url_http',
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
    [
      'a weather deadline on a rain-or-shine policy',
      'experiences_weather_decision_hours',
      (ids: Parents) =>
        insertExperience(ids, {
          outdoor: true,
          weatherPolicy: 'rain_or_shine',
          weatherDecisionHours: 3,
        }),
    ],
    [
      'a weather deadline with no policy',
      'experiences_weather_decision_hours',
      (ids: Parents) => insertExperience(ids, { weatherDecisionHours: 3 }),
    ],
    [
      'a weather deadline of zero hours',
      'experiences_weather_decision_hours',
      (ids: Parents) =>
        insertExperience(ids, {
          outdoor: true,
          weatherPolicy: 'decided_before_start',
          weatherDecisionHours: 0,
        }),
    ],
    [
      'a zero-minute duration',
      'experiences_duration_positive',
      (ids: Parents) => insertExperience(ids, { durationMinutes: 0 }),
    ],
    [
      'a negative minimum age',
      'experiences_age_rule_limits',
      (ids: Parents) =>
        insertExperience(ids, { ageRule: 'minimum_age', minAge: -1 }),
    ],
    [
      'a blank host name',
      'hosts_name_not_blank',
      () => insertHost({ name: '  ' }),
    ],
    [
      'a blank host time zone',
      'hosts_time_zone_not_blank',
      () => insertHost({ timeZone: '' }),
    ],
    [
      'a blank category name',
      'categories_name_not_blank',
      () => insertCategory({ name: '' }),
    ],
    [
      'a blank neighborhood name',
      'neighborhoods_name_not_blank',
      () => insertNeighborhood({ name: ' \t' }),
    ],
    [
      'a blank experience name',
      'experiences_name_not_blank',
      (ids: Parents) => insertExperience(ids, { name: ' ' }),
    ],
    [
      'a blank cancellation tier name',
      'cancellation_tiers_name_not_blank',
      () =>
        client.db.insert(cancellationTiers).values({
          key: unique('blank'),
          name: ' ',
          fullRefundHoursBefore: 1,
        }),
    ],
    [
      'a blank cancellation tier key',
      'cancellation_tiers_key_not_blank',
      () =>
        client.db
          .insert(cancellationTiers)
          .values({ key: '', name: 'Blank', fullRefundHoursBefore: 1 }),
    ],
    [
      'a link-out with no host',
      'experiences_link_out_url_http',
      (ids: Parents) => insertExperience(ids, { linkOutUrl: 'http://' }),
    ],
    [
      'an affiliate link with no host',
      'experiences_affiliate_url_http',
      (ids: Parents) => insertExperience(ids, { affiliateUrl: 'https://' }),
    ],
  ])('refuse %s', async (_name, constraint, attempt) => {
    await expect(attempt(await parents())).rejects.toMatchObject({
      cause: { constraint },
    });
  });

  // The read schemas and the CHECKs share httpUrlPattern, and this pins that the database applies it
  // the way JavaScript does. A stored link must also be one `new URL()` can parse.
  const urlPattern = new RegExp(httpUrlPattern);
  it.each([
    'https://example.com',
    'HTTP://EXAMPLE.COM/Path?q=1#frag',
    'HtTp://Example.com',
    'http://localhost:3000/a',
    'https://shop.example.co.uk:65535/x',
    'http://a-b.example.com',
    'http://xn-a.com',
    'http://',
    'https://',
    'https:///path',
    'http://:80',
    'http://@/',
    'http://user@example.com',
    'http://a b.com',
    'http://999.1.1.1',
    'http://1.2.3.4.5',
    'http://example.com:99999',
    'http://[::1]/x',
    'http://-.-',
    'https://example.com/a b',
    'https://example.com/é',
    'https://example.com/\u00a0',
    'https://example.com\n',
    ' https://example.com',
    'http://xn--a.com',
    'http://a.xn--zz',
    'http://XN--a.com',
    'http://a.Xn--b.com',
    'https://xn--nxasmq6b.com',
    'ftp://example.com',
    'javascript:alert(1)',
    '//example.com',
    'example.com',
  ])(
    'stores the URL %j exactly when the shared pattern accepts it',
    async (url) => {
      const asLinkOut = await insertExperience(await parents(), {
        linkOutUrl: url,
      }).then(
        () => true,
        () => false,
      );
      const asAffiliate = await insertExperience(await parents(), {
        affiliateUrl: url,
      }).then(
        () => true,
        () => false,
      );

      expect([asLinkOut, asAffiliate]).toEqual([
        urlPattern.test(url),
        urlPattern.test(url),
      ]);
      if (asLinkOut) expect(() => new URL(url)).not.toThrow();
    },
  );

  // Zod reads these columns as a JavaScript Date, which cannot hold these instants.
  it.each([
    'infinity',
    '-infinity',
    '0044-03-15 00:00:00+00 BC',
    '0001-01-01 BC',
    '0099-12-31 23:59:59+00',
    '0999-12-31 23:59:59+00',
    '10000-01-01 00:00:00+00',
    '275761-01-01 00:00:00+00',
  ])('refuse a timestamp of %s', async (instant) => {
    const ids = await parents();
    const insertions = [
      [
        'hosts_created_at_in_range',
        () =>
          client.db.execute(
            sql`INSERT INTO hosts (slug, name, time_zone, created_at) VALUES (${unique('range-host')}, 'Host', 'UTC', ${instant}::timestamptz)`,
          ),
      ],
      [
        'experiences_created_at_in_range',
        () =>
          client.db.execute(
            sql`INSERT INTO experiences (host_id, category_id, neighborhood_id, cancellation_tier_id, slug, name, created_at) VALUES (${ids.hostId}, ${ids.categoryId}, ${ids.neighborhoodId}, ${ids.cancellationTierId}, ${unique('range-exp')}, 'Experience', ${instant}::timestamptz)`,
          ),
      ],
      [
        'slug_history_retired_at_in_range',
        () =>
          client.db.execute(
            sql`INSERT INTO slug_history (entity_kind, entity_id, slug, retired_at) VALUES ('category', ${ids.categoryId}, ${unique('range-slug')}, ${instant}::timestamptz)`,
          ),
      ],
    ] as const;
    for (const [constraint, attempt] of insertions) {
      await expect(attempt()).rejects.toMatchObject({
        cause: { constraint },
      });
    }
  });

  it.each([
    ['1000-01-01 00:00:00+00', '1000-01-01T00:00:00.000Z'],
    ['9999-12-31 23:59:59.999+00', '9999-12-31T23:59:59.999Z'],
  ])(
    'keeps the bound %s readable through findRetiredSlug',
    async (instant, iso) => {
      const ids = await parents();
      const slug = unique('bound-slug');
      await client.db.execute(
        sql`INSERT INTO slug_history (entity_kind, entity_id, slug, retired_at) VALUES ('category', ${ids.categoryId}, ${slug}, ${instant}::timestamptz)`,
      );

      const retired = await catalog.findRetiredSlug('category', slug);

      expect(retired?.retiredAt.toISOString()).toBe(iso);
    },
  );

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
