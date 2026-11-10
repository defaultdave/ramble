import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { catalogFixtures, unique } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - a host is found by its slug, with the fields a guest page shows and none of the private ones
// - an unknown slug, and a string that is no slug, find no host
// - only live experiences of the host are listed: draft, in review, paused, and guide-only ones are not
// - another host's live experiences are not listed
// - the experiences come by name and then id, each with the cancellation tier of its own row
// - a host with no live experience is found with an empty list

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let hostsRead: typeof import('@/server/db/hosts');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  hostsRead = await import('@/server/db/hosts');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const catalog = catalogFixtures(() => client.db);
const live = { status: 'live' } as const;

describe('getHostListing', () => {
  it('finds a host by slug, with what a guest page shows and not the private fields', async () => {
    const slug = unique('listing-host');
    const row = await catalog.insertHost({
      slug,
      name: 'Hudson Paddle Club',
      description: 'Six guides.',
      notificationEmail: 'bookings@paddle.example',
    });

    const listing = await hostsRead.getHostListing(slug);

    expect(listing?.host).toEqual({
      id: row.id,
      slug,
      name: 'Hudson Paddle Club',
      description: 'Six guides.',
    });
    expect(listing?.live).toEqual([]);
  });

  it.each(['no-such-host', 'Not_A_Slug', '', '-x'])(
    'finds no host for the slug %j',
    async (slug) => {
      expect(await hostsRead.getHostListing(slug)).toBeNull();
    },
  );

  it('lists the live experiences of the host and no other status', async () => {
    const host = await catalog.insertHost();
    const parents = await catalog.parents(host.id);
    await catalog.insertExperience(parents, { name: 'A live', ...live });
    for (const status of [
      'draft',
      'in_review',
      'paused',
      'guide_only',
    ] as const) {
      await catalog.insertExperience(parents, {
        name: `B ${status}`,
        status,
        ...(status === 'guide_only'
          ? { linkOutUrl: 'https://guide.example/' }
          : {}),
      });
    }

    const listing = await hostsRead.getHostListing(host.slug);

    expect(listing?.live).toHaveLength(1);
  });

  it("does not list another host's live experiences", async () => {
    const host = await catalog.insertHost();
    const other = await catalog.insertHost();
    const mine = await catalog.insertExperience(
      await catalog.parents(host.id),
      live,
    );
    await catalog.insertExperience(await catalog.parents(other.id), live);

    const listing = await hostsRead.getHostListing(host.slug);

    expect(listing?.live.map(({ id }) => id)).toEqual([mine.id]);
  });

  it('lists by name and then id, each with its own cancellation tier', async () => {
    const host = await catalog.insertHost();
    const parents = await catalog.parents(host.id);
    const [tier] = await client.db.query.cancellationTiers.findMany({
      where: (tiers, { ne }) => ne(tiers.id, parents.cancellationTierId),
      limit: 1,
    });
    if (!tier) throw new Error('the migration inserts more than one tier');
    const b = await catalog.insertExperience(parents, {
      name: 'B second',
      ...live,
    });
    const a = await catalog.insertExperience(
      { ...parents, cancellationTierId: tier.id },
      { name: 'A first', ...live },
    );

    const listing = await hostsRead.getHostListing(host.slug);

    expect(listing?.live.map(({ id }) => id)).toEqual([a.id, b.id]);
    expect(listing?.live[0]?.cancellationTier).toMatchObject({
      id: tier.id,
      fullRefundHoursBefore: tier.fullRefundHoursBefore,
    });
    expect(listing?.live[1]?.cancellationTier.id).toBe(
      parents.cancellationTierId,
    );
  });

  it('lists nothing for a host with no live experience, and the host is still found', async () => {
    const host = await catalog.insertHost();
    await catalog.insertExperience(await catalog.parents(host.id), {
      status: 'paused',
    });

    const listing = await hostsRead.getHostListing(host.slug);

    expect(listing?.host.id).toBe(host.id);
    expect(listing?.live).toEqual([]);
  });
});
