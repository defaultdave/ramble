import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browsePageSize } from '@/lib/pages/browse';
import {
  asOf,
  browseFixtures,
  browseReads,
  filtersFor,
} from './browseFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the count is every match across all pages, not the size of one page
// - the count and the list agree for each kind of filter, so the count has no conditions of its own: category and neighborhood, price, age, setting, search, a day, a party
// - an experience a guest cannot see is not counted
// - no match counts as zero, not as a missing row
// - the data layer refuses filters the parse would never build

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let browse: typeof import('@/server/db/browse');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  browse = await import('@/server/db/browse');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const { scope, insertExperience, insertSession } = browseFixtures(
  () => client.db,
);
const { list } = browseReads(() => browse);

const count = (filters: Parameters<typeof list>[0]) =>
  browse.countBrowseExperiences(filters, asOf);

async function seeded() {
  const where = await scope();
  const kayak = await insertExperience(where, {
    name: 'Sunset Kayaking',
    description: 'Paddle past the harbor.',
    outdoor: true,
    weatherPolicy: 'rain_or_shine',
    price: 3000,
  });
  await insertExperience(where, {
    name: 'Wine Tasting',
    description: 'Five pours of red.',
    ageRule: 'twenty_one_plus',
    price: 12000,
  });
  await insertExperience(where, { name: 'Pottery', price: 6000 });
  await insertSession(kayak.id, '2026-11-07T14:00:00Z', { allocation: 4 });
  return where;
}

describe('countBrowseExperiences', () => {
  it('counts every match across the pages, not one page', async () => {
    const where = await scope();
    for (let n = 0; n < browsePageSize + 2; n += 1) {
      await insertExperience(where, {
        name: `Class ${String(n).padStart(2, '0')}`,
      });
    }

    expect(await count(filtersFor(where))).toBe(browsePageSize + 2);
    expect((await list(filtersFor(where))).items).toHaveLength(browsePageSize);
  });

  it.each([
    ['a category and a neighborhood', () => ({})],
    ['a price band', () => ({ price: '50-to-100' as const })],
    ['kids welcome', () => ({ age: 'kids' as const })],
    ['21 and over', () => ({ age: 'twenty-one-plus' as const })],
    ['outdoor', () => ({ setting: 'outdoor' as const })],
    ['a search', () => ({ search: 'harbor' })],
    ['a day', () => ({ date: '2026-11-07' })],
    ['a day with nothing on it', () => ({ date: '2026-11-08' })],
    ['a party the session has room for', () => ({ guests: 4 })],
    ['a party it has no room for', () => ({ guests: 5 })],
    [
      'filters that match nothing together',
      () => ({ search: 'harbor', age: 'twenty-one-plus' as const }),
    ],
  ])('agrees with the list for %s', async (_, extra) => {
    const where = await seeded();
    const filters = filtersFor(where, extra());

    expect(await count(filters)).toBe((await list(filters)).items.length);
  });

  it('does not count what a guest cannot see', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'Shown' });
    await insertExperience(where, { name: 'Draft', status: 'draft' });

    expect(await count(filtersFor(where))).toBe(1);
  });

  it('is zero when nothing matches', async () => {
    const where = await scope();

    expect(await count(filtersFor(where, { search: 'nothing here' }))).toBe(0);
  });

  it('refuses filters the parse would never build', async () => {
    const where = await scope();

    await expect(
      count(filtersFor(where, { search: 'x'.repeat(101) })),
    ).rejects.toThrow();
  });
});
