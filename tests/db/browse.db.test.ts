import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { browsePageSize, type BrowsePage } from '@/lib/browse';
import { noFilters, type BrowseFilters } from '@/lib/filters';
import {
  cancellationTiers,
  categories,
  experiences,
  hosts,
  neighborhoods,
  priceOptions,
  sessionTemplates,
  sessions,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - a guest sees live and guide-only experiences, never draft, in review or paused ones
// - a live experience with no price is left out, and a guide-only entry with none is kept
// - results come by name and then id, and the page is cut at the hard size with a cursor
// - the next page starts after the cursor and no row is shown twice or skipped, including two rows with one name
// - a row added before the cursor, or hidden after it, between two pages moves nothing already shown
// - a cursor for a hidden or unknown experience is reported, not read as the end of the list
// - category and neighborhood filters match any value of their list and both must hold; an unknown slug matches nothing
// - the date filter matches a scheduled session that starts that day in the host's own calendar, from the
//   stored date or, for a session entered by hand, from its time zone
// - a cancelled session, a session already started, and a session past the window never match
// - the calendar lists each such day once, in order, for the same experiences, and honors the two filters
// - a filter the schema refuses (too many values, a bad slug, a bad time) is refused before any query

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

const asOf = '2026-10-26T12:00:00.000Z';

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

async function insertHost(timeZone = 'America/New_York') {
  const [row] = await client.db
    .insert(hosts)
    .values({ slug: unique('host'), name: unique('Host'), timeZone })
    .returning();
  if (!row) throw new Error('insert returned no host');
  return row;
}

async function insertCategory() {
  const [row] = await client.db
    .insert(categories)
    .values({ slug: unique('category'), name: unique('Category') })
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

async function defaultTierId() {
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!tier) throw new Error('The migration inserts a default tier');
  return tier.id;
}

type Scope = {
  hostId: string;
  category: { id: string; slug: string };
  neighborhood: { id: string; slug: string; name: string };
  cancellationTierId: string;
};

/** A category and neighborhood of their own, so a test reads only the rows it made. */
async function scope(timeZone?: string): Promise<Scope> {
  return {
    hostId: (await insertHost(timeZone)).id,
    category: await insertCategory(),
    neighborhood: await insertNeighborhood(),
    cancellationTierId: await defaultTierId(),
  };
}

async function insertExperience(
  where: Scope,
  overrides: Partial<typeof experiences.$inferInsert> & {
    price?: number | null;
  } = {},
) {
  const { price = 5000, ...rest } = overrides;
  const status = rest.status ?? 'live';
  const [row] = await client.db
    .insert(experiences)
    .values({
      hostId: where.hostId,
      categoryId: where.category.id,
      neighborhoodId: where.neighborhood.id,
      cancellationTierId: where.cancellationTierId,
      slug: unique('experience'),
      name: unique('Experience'),
      status,
      ...(status === 'guide_only'
        ? { linkOutUrl: 'https://example.com/class' }
        : {}),
      ...rest,
    })
    .returning();
  if (!row) throw new Error('insert returned no experience');
  if (price !== null && status !== 'guide_only') {
    await client.db
      .insert(priceOptions)
      .values({ experienceId: row.id, kind: 'adult', priceMinor: price });
  }
  return row;
}

type SessionInsert = typeof sessions.$inferInsert;

async function insertSession(
  experienceId: string,
  startsAt: string,
  overrides: Partial<SessionInsert> = {},
) {
  const start = new Date(startsAt);
  const [row] = await client.db
    .insert(sessions)
    .values({
      experienceId,
      startsAt: start,
      endsAt: new Date(start.getTime() + 2 * 3_600_000),
      timeZone: 'America/New_York',
      allocation: 8,
      source: 'ramble',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no session');
  return row;
}

const filtersFor = (where: Scope, extra: Partial<BrowseFilters> = {}) => ({
  ...noFilters,
  categories: [where.category.slug],
  ...extra,
});

async function list(
  filters: BrowseFilters,
  after: string | null = null,
): Promise<Extract<BrowsePage, { ok: true }>> {
  const page = await browse.listBrowseExperiences({ filters, after }, asOf);
  if (!page.ok) throw new Error('expected a page');
  return page;
}

const names = (page: Extract<BrowsePage, { ok: true }>) =>
  page.items.map(({ name }) => name);

describe('what a guest sees', () => {
  it('lists live and guide-only experiences and hides every other status', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A live' });
    await insertExperience(where, { name: 'B guide', status: 'guide_only' });
    await insertExperience(where, { name: 'C draft', status: 'draft' });
    await insertExperience(where, { name: 'D review', status: 'in_review' });
    await insertExperience(where, { name: 'E paused', status: 'paused' });

    expect(names(await list(filtersFor(where)))).toEqual(['A live', 'B guide']);
  });

  it('leaves out a live experience with no price and keeps a guide entry with none', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A priced' });
    await insertExperience(where, { name: 'B unpriced', price: null });
    await insertExperience(where, { name: 'C guide', status: 'guide_only' });

    expect(names(await list(filtersFor(where)))).toEqual([
      'A priced',
      'C guide',
    ]);
  });

  it('carries what a card shows and nothing a guest may not see', async () => {
    const where = await scope();
    const adult = await insertExperience(where, {
      name: 'A card',
      durationMinutes: 150,
      price: 7000,
    });
    await client.db
      .insert(priceOptions)
      .values({ experienceId: adult.id, kind: 'child', priceMinor: 3500 });

    const [item] = (await list(filtersFor(where))).items;

    expect(item).toEqual({
      id: adult.id,
      slug: adult.slug,
      name: 'A card',
      status: 'live',
      neighborhoodName: where.neighborhood.name,
      durationMinutes: 150,
      linkOutUrl: null,
      priceOptions: [{ priceMinor: 3500 }, { priceMinor: 7000 }],
    });
  });
});

describe('paging', () => {
  it('cuts a page at the hard size and starts the next one after its last row', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize + 1; n += 1) {
      await insertExperience(where, {
        name: `Row ${String(n).padStart(2, '0')}`,
      });
    }

    const first = await list(filtersFor(where));
    expect(first.items).toHaveLength(browsePageSize);
    expect(first.nextCursor).toBe(first.items[browsePageSize - 1]?.id);

    const second = await list(filtersFor(where), first.nextCursor);
    expect(names(second)).toEqual([
      `Row ${String(browsePageSize + 1).padStart(2, '0')}`,
    ]);
    expect(second.nextCursor).toBeNull();
  });

  it('has no next page when the rows fill a page exactly', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize; n += 1) {
      await insertExperience(where);
    }

    expect((await list(filtersFor(where))).nextCursor).toBeNull();
  });

  it('shows no row twice and skips none across a page boundary, with rows that share a name', async () => {
    const where = await scope();
    const total = browsePageSize * 2 + 3;
    const made = [];
    for (let n = 0; n < total; n += 1) {
      // Every row has the same name, so the id alone decides the order.
      made.push(await insertExperience(where, { name: 'Same name' }));
    }

    const seen: string[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 5; guard += 1) {
      const page: Extract<BrowsePage, { ok: true }> = await list(
        filtersFor(where),
        after,
      );
      seen.push(...page.items.map(({ id }) => id));
      after = page.nextCursor;
      if (after === null) break;
    }

    expect(seen).toEqual(made.map(({ id }) => id).sort());
  });

  it('moves nothing already shown when a row is added before the cursor or hidden after it', async () => {
    const where = await scope();
    for (let n = 1; n <= browsePageSize + 4; n += 1) {
      await insertExperience(where, {
        name: `Row ${String(n).padStart(2, '0')}`,
      });
    }
    const first = await list(filtersFor(where));
    const afterRows = (await list(filtersFor(where), first.nextCursor)).items;
    const hidden = afterRows[0];
    if (!hidden) throw new Error('expected a row after the cursor');

    await insertExperience(where, { name: 'Row 00 added later' });
    await client.db
      .update(experiences)
      .set({ status: 'paused' })
      .where(eq(experiences.id, hidden.id));

    const second = await list(filtersFor(where), first.nextCursor);
    expect(second.items.map(({ id }) => id)).toEqual(
      afterRows.slice(1).map(({ id }) => id),
    );
  });

  it.each([
    ['an experience that is not there', '00000000-0000-4000-8000-0000000000aa'],
  ])('reports %s as a cursor that was not found', async (_name, after) => {
    const page = await browse.listBrowseExperiences(
      { filters: noFilters, after },
      asOf,
    );
    expect(page).toEqual({ ok: false, reason: 'cursor_not_found' });
  });

  it('reports a cursor for a hidden experience as not found', async () => {
    const where = await scope();
    const paused = await insertExperience(where, { status: 'paused' });

    const page = await browse.listBrowseExperiences(
      { filters: filtersFor(where), after: paused.id },
      asOf,
    );

    expect(page).toEqual({ ok: false, reason: 'cursor_not_found' });
  });
});

describe('category and neighborhood filters', () => {
  it('matches any value of a list', async () => {
    const one = await scope();
    const two = await scope();
    await insertExperience(one, { name: 'In one' });
    await insertExperience(two, { name: 'In two' });

    const page = await list({
      ...noFilters,
      categories: [one.category.slug, two.category.slug],
    });

    expect(names(page)).toEqual(['In one', 'In two']);
  });

  it('needs both the category and the neighborhood to match', async () => {
    const one = await scope();
    const other = await scope();
    await insertExperience(one, { name: 'Both' });
    await insertExperience(
      { ...one, neighborhood: other.neighborhood },
      { name: 'Wrong neighborhood' },
    );

    const page = await list({
      ...noFilters,
      categories: [one.category.slug],
      neighborhoods: [one.neighborhood.slug],
    });

    expect(names(page)).toEqual(['Both']);
  });

  it('matches nothing for a slug that does not exist', async () => {
    const where = await scope();
    await insertExperience(where);

    expect(
      (await list({ ...noFilters, categories: ['no-such-category'] })).items,
    ).toEqual([]);
  });
});

describe('the date filter', () => {
  it('matches a session that starts on that day in the host calendar', async () => {
    const where = await scope();
    const on = await insertExperience(where, { name: 'On the day' });
    const off = await insertExperience(where, { name: 'Another day' });
    await insertSession(on.id, '2026-11-07T15:00:00Z');
    await insertSession(off.id, '2026-11-08T15:00:00Z');

    const page = await list(filtersFor(where, { date: '2026-11-07' }));

    expect(names(page)).toEqual(['On the day']);
  });

  it('reads a session entered by hand in its own time zone', async () => {
    const where = await scope('Asia/Tokyo');
    const exp = await insertExperience(where, { name: 'Tokyo night' });
    // 16:00 UTC on 7 November is 01:00 on the 8th in Tokyo, and 11:00 on the 7th in New York.
    await insertSession(exp.id, '2026-11-07T16:00:00Z', {
      timeZone: 'Asia/Tokyo',
    });

    expect(
      names(await list(filtersFor(where, { date: '2026-11-08' }))),
    ).toEqual(['Tokyo night']);
    expect(await list(filtersFor(where, { date: '2026-11-07' }))).toMatchObject(
      { items: [] },
    );
  });

  it('reads the stored date of a generated session', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Generated' });
    const [template] = await client.db
      .insert(sessionTemplates)
      .values({
        experienceId: exp.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 120,
        allocation: 8,
        source: 'ramble',
      })
      .returning();
    if (!template) throw new Error('insert returned no template');
    await insertSession(exp.id, '2026-11-07T15:00:00Z', {
      templateId: template.id,
      localDate: '2026-11-07',
    });

    expect(
      names(await list(filtersFor(where, { date: '2026-11-07' }))),
    ).toEqual(['Generated']);
  });

  it.each([
    [
      'a cancelled session',
      '2026-11-07T15:00:00Z',
      { status: 'cancelled', cancelReason: 'host' } as const,
    ],
    ['a session that has already started', '2026-10-26T11:00:00Z', {}],
    ['a session past the window', '2027-06-06T15:00:00Z', {}],
  ])('never matches %s', async (_name, startsAt, overrides) => {
    const where = await scope();
    const exp = await insertExperience(where);
    await insertSession(exp.id, startsAt, overrides);
    const date = startsAt.slice(0, 10);

    expect(await list(filtersFor(where, { date }))).toMatchObject({
      items: [],
    });
  });

  it('lists an experience once when it has several sessions that day', async () => {
    const where = await scope();
    const exp = await insertExperience(where);
    await insertSession(exp.id, '2026-11-07T14:00:00Z');
    await insertSession(exp.id, '2026-11-07T19:00:00Z');

    expect(
      (await list(filtersFor(where, { date: '2026-11-07' }))).items,
    ).toHaveLength(1);
  });
});

describe('the calendar days', () => {
  it('lists each day with a session once, in order, for the experiences the filters leave', async () => {
    const where = await scope();
    const other = await scope();
    const exp = await insertExperience(where);
    const hidden = await insertExperience(where, { status: 'paused' });
    const elsewhere = await insertExperience(other);
    await insertSession(exp.id, '2026-11-08T15:00:00Z');
    await insertSession(exp.id, '2026-11-07T14:00:00Z');
    await insertSession(exp.id, '2026-11-07T19:00:00Z');
    await insertSession(hidden.id, '2026-11-20T15:00:00Z');
    await insertSession(elsewhere.id, '2026-11-25T15:00:00Z');
    await insertSession(exp.id, '2026-11-12T15:00:00Z', {
      status: 'cancelled',
      cancelReason: 'weather',
    });
    await insertSession(exp.id, '2026-10-26T11:00:00Z');
    await insertSession(exp.id, '2027-06-06T15:00:00Z');

    const days = await browse.listBrowseDates(
      { categories: [where.category.slug], neighborhoods: [] },
      asOf,
    );

    expect(days).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('narrows by neighborhood', async () => {
    const where = await scope();
    const other = await insertNeighborhood();
    const here = await insertExperience(where);
    const there = await insertExperience({ ...where, neighborhood: other });
    await insertSession(here.id, '2026-11-07T15:00:00Z');
    await insertSession(there.id, '2026-11-09T15:00:00Z');

    expect(
      await browse.listBrowseDates(
        {
          categories: [where.category.slug],
          neighborhoods: [other.slug],
        },
        asOf,
      ),
    ).toEqual(['2026-11-09']);
  });
});

describe('input the schema refuses', () => {
  it.each([
    [
      'more values than a list may hold',
      {
        ...noFilters,
        categories: Array.from({ length: 9 }, (_, i) => `c${String(i)}`),
      },
    ],
    ['a slug that is not a slug', { ...noFilters, categories: ['Not A Slug'] }],
    ['a date that is not a day', { ...noFilters, date: '2026-02-30' }],
  ])('refuses %s before querying', async (_name, filters) => {
    await expect(
      browse.listBrowseExperiences({ filters, after: null }, asOf),
    ).rejects.toThrow();
  });

  it('refuses a cursor that is not an id', async () => {
    await expect(
      browse.listBrowseExperiences(
        { filters: noFilters, after: "x'; --" },
        asOf,
      ),
    ).rejects.toThrow();
  });

  it('refuses a time it cannot read', async () => {
    await expect(
      browse.listBrowseExperiences({ filters: noFilters, after: null }, 'soon'),
    ).rejects.toThrow(RangeError);
    await expect(
      browse.listBrowseDates({ categories: [], neighborhoods: [] }, 'soon'),
    ).rejects.toThrow(RangeError);
  });
});
