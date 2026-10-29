import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  browseDays,
  browsePageSize,
  maxHandEnteredDayRows,
  maxStoredDayRows,
  toBrowsePage,
  type BrowsePage,
} from '@/lib/browse';
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
// - a guide-only row with no link out cannot be stored, by insert or by update, so no browse card lacks its link
// - a live experience that loses its last price leaves the read, so no browse card lacks a price
// - results come by name and then id, and the page is cut at the hard size with a cursor
// - the next page starts after the cursor and no row is shown twice or skipped, including two rows with one name
// - a row added before the cursor, or hidden after it, between two pages moves nothing already shown
// - a cursor for a hidden or unknown experience finds no row and reads no page; a visible one returns its row
// - category and neighborhood filters match any value of their list and both must hold; an unknown slug matches nothing
// - the date filter matches a scheduled session that starts that day in the host's own calendar, from the
//   stored date or, for a session entered by hand, from its time zone
// - a cancelled session, a session already started, and a session past the window never match
// - the calendar read returns raw stored values only (stored dates, and start and zone of hand-entered sessions) and decides no day
// - each calendar list has a hard cap
// - the day the lib decides for a hand-entered session near midnight is the day the date filter matches, never the one before or after
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
  const read = await browse.listBrowseExperiences({ filters, after }, asOf);
  const page = toBrowsePage(after, read);
  if (!page.ok) throw new Error('expected a page');
  return page;
}

const names = (page: Extract<BrowsePage, { ok: true }>) =>
  page.items.map(({ name }) => name);

async function daysFor(
  filters: Pick<BrowseFilters, 'categories' | 'neighborhoods'>,
) {
  return browseDays(await browse.listBrowseDayRows(filters, asOf));
}

async function insertTemplate(experienceId: string) {
  const [template] = await client.db
    .insert(sessionTemplates)
    .values({
      experienceId,
      weekday: 6,
      startTime: '10:00:00',
      durationMinutes: 120,
      allocation: 8,
      source: 'ramble',
    })
    .returning();
  if (!template) throw new Error('insert returned no template');
  return template;
}

function shiftDay(date: string, days: number): string {
  const shifted = new Date(`${date}T00:00:00Z`);
  shifted.setUTCDate(shifted.getUTCDate() + days);
  return shifted.toISOString().slice(0, 10);
}

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

  it('leaves out a live experience whose only price option takes no space', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A priced' });
    const accompanyingOnly = await insertExperience(where, {
      name: 'B accompanying only',
      price: null,
    });
    await client.db.insert(priceOptions).values({
      experienceId: accompanyingOnly.id,
      kind: 'adult',
      priceMinor: 0,
      usesSpace: false,
    });

    expect(names(await list(filtersFor(where)))).toEqual(['A priced']);
  });

  it('keeps a kids class whose free accompanying adult sits beside a paid child, and says which option takes a space', async () => {
    const where = await scope();
    const kidsClass = await insertExperience(where, {
      name: 'A kids class',
      price: null,
    });
    await client.db.insert(priceOptions).values([
      {
        experienceId: kidsClass.id,
        kind: 'adult',
        priceMinor: 0,
        usesSpace: false,
      },
      { experienceId: kidsClass.id, kind: 'child', priceMinor: 4500 },
    ]);

    const [item] = (await list(filtersFor(where))).items;

    expect(item?.priceOptions).toEqual([
      { priceMinor: 0, usesSpace: false },
      { priceMinor: 4500, usesSpace: true },
    ]);
  });

  it('leaves out a live experience once its last price is removed', async () => {
    const where = await scope();
    const kept = await insertExperience(where, { name: 'A kept' });
    const dropped = await insertExperience(where, { name: 'B dropped' });
    expect(names(await list(filtersFor(where)))).toEqual([
      'A kept',
      'B dropped',
    ]);

    await client.db
      .delete(priceOptions)
      .where(eq(priceOptions.experienceId, dropped.id));

    const page = await list(filtersFor(where));
    expect(page.items.map(({ id }) => id)).toEqual([kept.id]);
  });

  it.each([
    [
      'an insert',
      (where: Scope) =>
        client.db.insert(experiences).values({
          hostId: where.hostId,
          categoryId: where.category.id,
          neighborhoodId: where.neighborhood.id,
          cancellationTierId: where.cancellationTierId,
          slug: unique('experience'),
          name: unique('Experience'),
          status: 'guide_only',
        }),
    ],
    [
      'moving a live experience to guide-only',
      async (where: Scope) => {
        const row = await insertExperience(where);
        await client.db
          .update(experiences)
          .set({ status: 'guide_only' })
          .where(eq(experiences.id, row.id));
      },
    ],
    [
      'removing the link of a guide entry',
      async (where: Scope) => {
        const row = await insertExperience(where, { status: 'guide_only' });
        await client.db
          .update(experiences)
          .set({ linkOutUrl: null })
          .where(eq(experiences.id, row.id));
      },
    ],
  ])('refuses a guide-only row with no link by %s', async (_name, attempt) => {
    await expect(attempt(await scope())).rejects.toMatchObject({
      cause: { constraint: 'experiences_guide_only_has_link' },
    });
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
      priceOptions: [
        { priceMinor: 3500, usesSpace: true },
        { priceMinor: 7000, usesSpace: true },
      ],
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

  it('finds no row for a cursor that names an experience that is not there', async () => {
    const read = await browse.listBrowseExperiences(
      {
        filters: noFilters,
        after: '00000000-0000-4000-8000-0000000000aa',
      },
      asOf,
    );
    expect(read).toEqual({ cursor: null, items: [], nextCursor: null });
  });

  it('finds no row for a cursor that names a hidden experience, and reads no page', async () => {
    const where = await scope();
    await insertExperience(where, { name: 'A live' });
    const paused = await insertExperience(where, { status: 'paused' });

    const read = await browse.listBrowseExperiences(
      { filters: filtersFor(where), after: paused.id },
      asOf,
    );

    expect(read).toEqual({ cursor: null, items: [], nextCursor: null });
  });

  it('returns the row a visible cursor names', async () => {
    const where = await scope();
    const live = await insertExperience(where, { name: 'A live' });

    const read = await browse.listBrowseExperiences(
      { filters: filtersFor(where), after: live.id },
      asOf,
    );

    expect(read.cursor).toEqual({ id: live.id, name: 'A live' });
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
    const template = await insertTemplate(exp.id);
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

    const days = await daysFor({
      categories: [where.category.slug],
      neighborhoods: [],
    });

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
      await daysFor({
        categories: [where.category.slug],
        neighborhoods: [other.slug],
      }),
    ).toEqual(['2026-11-09']);
  });
});

describe('the calendar read', () => {
  it('returns stored values only: the stored date of a generated session, the start and zone of a hand-entered one', async () => {
    const where = await scope();
    const exp = await insertExperience(where);
    const template = await insertTemplate(exp.id);
    // The stored date is the generator's record and is returned as it is, whatever the start says.
    await insertSession(exp.id, '2026-11-07T15:00:00Z', {
      templateId: template.id,
      localDate: '2026-11-09',
    });
    await insertSession(exp.id, '2026-11-07T16:00:00Z', {
      timeZone: 'Asia/Tokyo',
    });
    await insertSession(exp.id, '2026-11-07T16:00:00Z', {
      timeZone: 'Asia/Tokyo',
    });

    const rows = await browse.listBrowseDayRows(
      { categories: [where.category.slug], neighborhoods: [] },
      asOf,
    );

    expect(rows).toEqual({
      storedDates: ['2026-11-09'],
      handEntered: [
        { startsAt: new Date('2026-11-07T16:00:00Z'), timeZone: 'Asia/Tokyo' },
      ],
    });
  });

  it('reads no cancelled, started, or out-of-window session, and no hidden experience, in either list', async () => {
    const where = await scope();
    const exp = await insertExperience(where);
    const hidden = await insertExperience(where, { status: 'paused' });
    const template = await insertTemplate(exp.id);
    await insertSession(exp.id, '2026-11-07T15:00:00Z', {
      templateId: template.id,
      localDate: '2026-11-07',
      status: 'cancelled',
      cancelReason: 'host',
    });
    await insertSession(exp.id, '2026-10-26T11:00:00Z');
    await insertSession(exp.id, '2027-06-06T15:00:00Z');
    await insertSession(hidden.id, '2026-11-08T15:00:00Z');

    expect(
      await browse.listBrowseDayRows(
        { categories: [where.category.slug], neighborhoods: [] },
        asOf,
      ),
    ).toEqual({ storedDates: [], handEntered: [] });
  });

  it('cuts the stored dates at the cap, earliest first', async () => {
    const where = await scope();
    const exp = await insertExperience(where);
    const template = await insertTemplate(exp.id);
    const total = maxStoredDayRows + 3;
    await client.db.insert(sessions).values(
      Array.from({ length: total }, (_, n) => {
        const start = new Date(Date.UTC(2026, 10, 1, 15, n));
        return {
          experienceId: exp.id,
          templateId: template.id,
          // The database does not tie the stored date to the start, so more dates than a window holds can be stored.
          localDate: shiftDay('2026-11-01', n),
          startsAt: start,
          endsAt: new Date(start.getTime() + 2 * 3_600_000),
          timeZone: 'America/New_York',
          allocation: 8,
          source: 'ramble' as const,
        };
      }),
    );

    const { storedDates } = await browse.listBrowseDayRows(
      { categories: [where.category.slug], neighborhoods: [] },
      asOf,
    );

    expect(storedDates).toHaveLength(maxStoredDayRows);
    expect(storedDates[0]).toBe('2026-11-01');
    expect(storedDates.at(-1)).toBe(
      shiftDay('2026-11-01', maxStoredDayRows - 1),
    );
  });

  it('cuts the hand-entered sessions at the cap, earliest first', async () => {
    const where = await scope();
    const exp = await insertExperience(where);
    const total = maxHandEnteredDayRows + 3;
    await client.db.insert(sessions).values(
      Array.from({ length: total }, (_, n) => {
        const start = new Date(Date.UTC(2026, 10, 1, 0, n));
        return {
          experienceId: exp.id,
          startsAt: start,
          endsAt: new Date(start.getTime() + 3_600_000),
          timeZone: 'America/New_York',
          allocation: 8,
          source: 'ramble' as const,
        };
      }),
    );

    const { handEntered } = await browse.listBrowseDayRows(
      { categories: [where.category.slug], neighborhoods: [] },
      asOf,
    );

    expect(handEntered).toHaveLength(maxHandEnteredDayRows);
    expect(handEntered[0]?.startsAt).toEqual(new Date(Date.UTC(2026, 10, 1)));
  });
});

describe('the day the calendar shows and the day the date filter matches', () => {
  // Each zone has the minute before local midnight and the minute after, so one side of every pair is the day before.
  it.each([
    ['Asia/Tokyo', '2026-11-07T14:59:00Z', '2026-11-07'],
    ['Asia/Tokyo', '2026-11-07T15:00:00Z', '2026-11-08'],
    ['Pacific/Kiritimati', '2026-11-07T09:59:00Z', '2026-11-07'],
    ['Pacific/Kiritimati', '2026-11-07T10:00:00Z', '2026-11-08'],
    ['America/Los_Angeles', '2026-11-08T07:59:00Z', '2026-11-07'],
    ['America/Los_Angeles', '2026-11-08T08:00:00Z', '2026-11-08'],
    // The New York clock goes back on 1 November: midnight before is 04:00 UTC, midnight after is 05:00 UTC.
    ['America/New_York', '2026-11-01T03:59:00Z', '2026-10-31'],
    ['America/New_York', '2026-11-01T04:00:00Z', '2026-11-01'],
    ['America/New_York', '2026-11-02T04:59:00Z', '2026-11-01'],
    ['America/New_York', '2026-11-02T05:00:00Z', '2026-11-02'],
  ])(
    'a hand-entered session in %s at %s is on %s in both',
    async (zone, startsAt, day) => {
      const where = await scope(zone);
      const exp = await insertExperience(where);
      await insertSession(exp.id, startsAt, { timeZone: zone });
      const calendar = await daysFor({
        categories: [where.category.slug],
        neighborhoods: [],
      });

      expect(calendar).toEqual([day]);
      expect(names(await list(filtersFor(where, { date: day })))).toEqual([
        exp.name,
      ]);
      for (const other of [shiftDay(day, -1), shiftDay(day, 1)]) {
        expect((await list(filtersFor(where, { date: other }))).items).toEqual(
          [],
        );
      }
    },
  );
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
      browse.listBrowseDayRows({ categories: [], neighborhoods: [] }, 'soon'),
    ).rejects.toThrow(RangeError);
  });
});
