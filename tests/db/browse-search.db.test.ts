import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
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
// - a word in the name or in the description matches, and a word in neither does not
// - every word asked for must be there, in any order, and the case of either side does not matter
// - english stemming: a plural or an -ing form finds the base word and the other way round
// - stopwords alone match nothing and are ignored beside a real word
// - websearch syntax: a quoted phrase must be adjacent and in order, `-word` leaves out what has it, `or` takes either
// - stray punctuation and tsquery operators typed by a guest are text, not syntax, and never raise
// - the search narrows with the other filters, and the page is still by name with the cursor over a searched list
// - an experience with no description is found by its name, and one that is not shown to guests is never found
// - the data layer refuses a search the parse would never build

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

async function found(
  where: Awaited<ReturnType<typeof scope>>,
  search: string,
  extra: Parameters<typeof filtersFor>[1] = {},
) {
  return names(await list(filtersFor(where, { ...extra, search })));
}

async function seeded() {
  const where = await scope();
  await insertExperience(where, {
    name: 'Sunset Kayaking',
    description: 'Paddle past the harbor at golden hour.',
  });
  await insertExperience(where, {
    name: 'Wine Tasting',
    description: 'Five pours of red and white, with cheese.',
  });
  await insertExperience(where, {
    name: 'Cheese and Wine Night',
    description: 'A table of cheese, and no beer.',
  });
  return where;
}

describe('the keyword search', () => {
  it('matches a word in the name or in the description, and nothing else', async () => {
    const where = await seeded();

    expect(await found(where, 'sunset')).toEqual(['Sunset Kayaking']);
    expect(await found(where, 'harbor')).toEqual(['Sunset Kayaking']);
    expect(await found(where, 'pizza')).toEqual([]);
  });

  it('wants every word, in any order, in any case', async () => {
    const where = await seeded();

    expect(await found(where, 'WINE cheese')).toEqual([
      'Cheese and Wine Night',
      'Wine Tasting',
    ]);
    expect(await found(where, 'wine harbor')).toEqual([]);
  });

  it.each([
    ['kayak', ['Sunset Kayaking']],
    ['kayaks', ['Sunset Kayaking']],
    ['pour', ['Wine Tasting']],
  ])('stems, so %j finds %j', async (word, expected) => {
    const where = await seeded();

    expect(await found(where, word)).toEqual(expected);
  });

  it.each([['the'], ['and of the'], ['a']])(
    'matches nothing for the stopwords %j alone',
    async (words) => {
      const where = await seeded();

      expect(await found(where, words)).toEqual([]);
    },
  );

  it('ignores a stopword beside a real word', async () => {
    const where = await seeded();

    expect(await found(where, 'the harbor')).toEqual(['Sunset Kayaking']);
  });

  it('takes a quoted phrase as adjacent words in order', async () => {
    const where = await seeded();

    expect(await found(where, '"wine tasting"')).toEqual(['Wine Tasting']);
    expect(await found(where, '"tasting wine"')).toEqual([]);
    expect(await found(where, '"cheese wine"')).toEqual([]);
  });

  it('leaves out what has a word with a minus', async () => {
    const where = await seeded();

    expect(await found(where, 'wine -night')).toEqual(['Wine Tasting']);
    expect(await found(where, 'cheese -beer')).toEqual(['Wine Tasting']);
  });

  it('takes either side of an or', async () => {
    const where = await seeded();

    expect(await found(where, 'harbor or tasting')).toEqual([
      'Sunset Kayaking',
      'Wine Tasting',
    ]);
  });

  it.each([
    ["wine'); drop table experiences; --"],
    ['wine & | ! ( ) :*'],
    ['"unclosed quote'],
    ['-'],
    ['\\'],
    ['<->'],
  ])('reads %j as text and does not raise', async (search) => {
    const where = await seeded();

    await expect(found(where, search)).resolves.toBeInstanceOf(Array);
  });

  it('finds an experience with no description by its name', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'Pottery Night', description: null });

    expect(await found(where, 'pottery')).toEqual(['Pottery Night']);
  });

  it('never finds an experience a guest cannot see', async () => {
    const where = await scope();
    await insertExperience(where, {
      name: 'Secret Draft Tour',
      status: 'draft',
    });

    expect(await found(where, 'secret')).toEqual([]);
  });

  it('leaves the list alone when there is no search', async () => {
    const where = await seeded();

    expect(names(await list(filtersFor(where)))).toHaveLength(3);
  });
});

describe('the keyword search with the other filters', () => {
  it('narrows with a price band and a setting', async () => {
    const where = await scope();
    await insertExperience(where, {
      name: 'Cheap Indoor Wine',
      description: 'wine',
      price: 2000,
    });
    await insertExperience(where, {
      name: 'Dear Indoor Wine',
      description: 'wine',
      price: 20000,
    });
    await insertExperience(where, {
      name: 'Cheap Outdoor Wine',
      description: 'wine',
      price: 2000,
      outdoor: true,
      weatherPolicy: 'rain_or_shine',
    });

    expect(await found(where, 'wine')).toHaveLength(3);
    expect(await found(where, 'wine', { price: 'under-50' })).toEqual([
      'Cheap Indoor Wine',
      'Cheap Outdoor Wine',
    ]);
    expect(
      await found(where, 'wine', { price: 'under-50', setting: 'indoor' }),
    ).toEqual(['Cheap Indoor Wine']);
    expect(await found(where, 'pizza', { price: 'under-50' })).toEqual([]);
  });

  it('keeps the name order and the cursor over a searched list', async () => {
    const where = await scope();
    for (const name of ['Wine A', 'Wine B', 'Wine C', 'Beer D']) {
      await insertExperience(where, { name });
    }
    const filters = filtersFor(where, { search: 'wine' });
    const first = await list(filters);
    const [firstItem] = first.items;

    expect(names(first)).toEqual(['Wine A', 'Wine B', 'Wine C']);
    expect(names(await list(filters, firstItem?.id ?? null))).toEqual([
      'Wine B',
      'Wine C',
    ]);
  });
});

describe('input the schema refuses', () => {
  it.each([[''], ['a'.repeat(101)]])(
    'refuses the search %j before it reaches the database',
    async (search) => {
      const where = await scope();

      await expect(
        browse.listBrowseExperiences(
          { filters: filtersFor(where, { search }), after: null },
          '2026-10-26T12:00:00.000Z',
        ),
      ).rejects.toBeInstanceOf(ZodError);
    },
  );
});
