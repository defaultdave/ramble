import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { priceBands, type PriceBand } from '@/lib/filters';
import { priceOptions } from '@/server/db/schema';
import {
  browseFixtures,
  browseReads,
  filtersFor,
  names,
} from './browseFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - a price band holds its lower bound and not its upper bound, at each edge of each band
// - the cheapest option that takes a space decides the band: a cheaper option that takes no space and a dearer one beside it do not move an experience
// - an experience with no price option that takes a space (guide only) is in no band
// - kids takes all ages and a minimum age or range that starts at the ceiling or under, and leaves out an older start and 21 and over
// - 21 and over takes only that rule
// - indoor and outdoor split on the outdoor flag
// - the three filters narrow each other

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

const { scope, insertExperience } = browseFixtures(() => client.db);
const { list } = browseReads(() => browse);

const bands = Object.keys(priceBands) as PriceBand[];
const outdoors = { outdoor: true, weatherPolicy: 'rain_or_shine' } as const;

describe('the price filter', () => {
  it.each([
    [0, 'under-50'],
    [4999, 'under-50'],
    [5000, '50-to-100'],
    [9999, '50-to-100'],
    [10000, '100-plus'],
    [250000, '100-plus'],
  ] as const)('puts a price of %i in the %s band only', async (price, band) => {
    const where = await scope();
    await insertExperience(where, { name: 'Edge', price });

    for (const other of bands) {
      expect(names(await list(filtersFor(where, { price: other })))).toEqual(
        other === band ? ['Edge'] : [],
      );
    }
  });

  it('ignores a cheaper option that takes no space', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Mixed', price: 8000 });
    await client.db.insert(priceOptions).values({
      experienceId: exp.id,
      kind: 'child',
      priceMinor: 100,
      usesSpace: false,
    });

    expect(
      names(await list(filtersFor(where, { price: '50-to-100' }))),
    ).toEqual(['Mixed']);
    expect(names(await list(filtersFor(where, { price: 'under-50' })))).toEqual(
      [],
    );
  });

  it('reads the cheapest option, not a dearer one beside it', async () => {
    const where = await scope();
    const exp = await insertExperience(where, {
      name: 'Two prices',
      price: 3000,
    });
    await client.db
      .insert(priceOptions)
      .values({ experienceId: exp.id, kind: 'child', priceMinor: 12000 });

    expect(names(await list(filtersFor(where, { price: 'under-50' })))).toEqual(
      ['Two prices'],
    );
    expect(names(await list(filtersFor(where, { price: '100-plus' })))).toEqual(
      [],
    );
  });

  it('puts a guide-only experience in no band', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'Guide', status: 'guide_only' });

    for (const band of bands) {
      expect(names(await list(filtersFor(where, { price: band })))).toEqual([]);
    }
    expect(names(await list(filtersFor(where)))).toEqual(['Guide']);
  });
});

describe('the age filter', () => {
  async function seedAges() {
    const where = await scope();
    await insertExperience(where, { name: 'A all ages', ageRule: 'all_ages' });
    await insertExperience(where, {
      name: 'B min 12',
      ageRule: 'minimum_age',
      minAge: 12,
    });
    await insertExperience(where, {
      name: 'C min 13',
      ageRule: 'minimum_age',
      minAge: 13,
    });
    await insertExperience(where, {
      name: 'D range 8 to 11',
      ageRule: 'age_range',
      minAge: 8,
      maxAge: 11,
    });
    await insertExperience(where, {
      name: 'E range 16 to 30',
      ageRule: 'age_range',
      minAge: 16,
      maxAge: 30,
    });
    await insertExperience(where, {
      name: 'F 21 plus',
      ageRule: 'twenty_one_plus',
    });
    return where;
  }

  it('offers kids what a child of the ceiling age or under can join', async () => {
    const where = await seedAges();

    expect(names(await list(filtersFor(where, { age: 'kids' })))).toEqual([
      'A all ages',
      'B min 12',
      'D range 8 to 11',
    ]);
  });

  it('offers 21 and over only the 21 and over rule', async () => {
    const where = await seedAges();

    expect(
      names(await list(filtersFor(where, { age: 'twenty-one-plus' }))),
    ).toEqual(['F 21 plus']);
  });

  it('lists every experience with no age chosen', async () => {
    const where = await seedAges();

    expect(names(await list(filtersFor(where)))).toHaveLength(6);
  });
});

describe('the indoor or outdoor filter', () => {
  it('splits the list on the outdoor flag', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'In' });
    await insertExperience(where, { name: 'Out', ...outdoors });

    expect(names(await list(filtersFor(where, { setting: 'indoor' })))).toEqual(
      ['In'],
    );
    expect(
      names(await list(filtersFor(where, { setting: 'outdoor' }))),
    ).toEqual(['Out']);
    expect(names(await list(filtersFor(where)))).toEqual(['In', 'Out']);
  });
});

describe('the filters together', () => {
  it('keeps only what matches all of them', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'Match', price: 3000, ...outdoors });
    await insertExperience(where, {
      name: 'Too dear',
      price: 9000,
      ...outdoors,
    });
    await insertExperience(where, { name: 'Indoors', price: 3000 });
    await insertExperience(where, {
      name: 'Adults',
      price: 3000,
      ageRule: 'twenty_one_plus',
      ...outdoors,
    });

    expect(
      names(
        await list(
          filtersFor(where, {
            price: 'under-50',
            setting: 'outdoor',
            age: 'kids',
          }),
        ),
      ),
    ).toEqual(['Match']);
  });
});
