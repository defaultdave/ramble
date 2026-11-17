import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { updateTag } from 'next/cache';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { HostInput } from '@/lib/hostSetup';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  cancellationTiers,
  categories,
  experiences,
  hosts,
  neighborhoods,
} from '@/server/db/schema';
import { createFreshDatabase, type FreshDatabase } from './harness';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test (`updateHost`, the cache it clears after the commit):
// - a new name, slug, about text, or time zone invalidates the host page and each experience of the host
// - a notice address alone, no change, a taken slug, and a missing host invalidate nothing

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let setup: typeof import('@/server/db/hostSetup');

const ops = testCaller({ userId: randomUUID(), roles: [Role.Ops] });

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  setup = await import('@/server/db/hostSetup');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  vi.mocked(updateTag).mockClear();
});

const tagsInvalidated = () =>
  vi
    .mocked(updateTag)
    .mock.calls.map(([tag]) => tag)
    .sort();

async function hostWithExperience() {
  const suffix = randomUUID().slice(0, 8);
  const [host] = await client.db
    .insert(hosts)
    .values({
      slug: `host-${suffix}`,
      name: 'Cache Host',
      timeZone: 'America/New_York',
    })
    .returning();
  const [category] = await client.db
    .insert(categories)
    .values({ slug: `cat-${suffix}`, name: 'Category' })
    .returning();
  const [neighborhood] = await client.db
    .insert(neighborhoods)
    .values({ slug: `hood-${suffix}`, name: 'Neighborhood' })
    .returning();
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!host || !category || !neighborhood || !tier) throw new Error('no rows');
  const [experience] = await client.db
    .insert(experiences)
    .values({
      hostId: host.id,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
      slug: `exp-${suffix}`,
      name: 'Experience',
    })
    .returning();
  if (!experience) throw new Error('no experience');
  return { host, experienceId: experience.id };
}

const unchanged = (host: {
  name: string;
  slug: string;
  timeZone: string;
}): HostInput => ({
  name: host.name,
  slug: host.slug,
  description: null,
  timeZone: host.timeZone,
  notificationEmail: null,
});

describe('updateHost and the cache', () => {
  it.each([
    ['name', { name: 'Renamed' }],
    ['slug', { slug: 'renamed-slug' }],
    ['description', { description: 'About us' }],
    ['time zone', { timeZone: 'America/Chicago' }],
  ])(
    'invalidates the host page and its experiences for a new %s',
    async (_field, change) => {
      const { host, experienceId } = await hostWithExperience();

      expect(
        await setup.updateHost(ops, host.id, { ...unchanged(host), ...change }),
      ).toEqual({ status: 'updated' });

      expect(tagsInvalidated()).toEqual(
        ['catalog', `experience:${experienceId}`].sort(),
      );
    },
  );

  it('invalidates nothing for a notice address alone, for no change, for a taken slug, and for a missing host', async () => {
    const { host } = await hostWithExperience();
    const { host: other } = await hostWithExperience();

    await setup.updateHost(ops, host.id, {
      ...unchanged(host),
      notificationEmail: 'only@example.com',
    });
    expect(
      await setup.updateHost(ops, host.id, {
        ...unchanged(host),
        notificationEmail: 'only@example.com',
      }),
    ).toEqual({ status: 'unchanged' });
    expect(
      await setup.updateHost(ops, host.id, {
        ...unchanged(host),
        slug: other.slug,
      }),
    ).toEqual({ status: 'slug_taken' });
    await setup.updateHost(ops, randomUUID(), unchanged(host));

    expect(updateTag).not.toHaveBeenCalled();
  });
});
