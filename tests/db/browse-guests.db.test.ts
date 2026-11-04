import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { browsePageSize, browseWindowDays } from '@/lib/pages/browse';
import { guestCounts, noFilters } from '@/lib/filters';
import { isOpenSession, upcomingWindow } from '@/lib/sessionWindow';
import {} from '@/server/db/schema';
import {
  asOf,
  browseFixtures,
  browseReads,
  filtersFor,
  names,
  shiftDay,
  type Scope,
} from './browseFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the day the lib decides for a hand-entered session near midnight is the day the date filter matches, never the one before or after
// - the calendar lists each such day once, in order, for the same experiences, and honors the two filters
// - guests match an experience through a session with spaces for the whole party: a full session is out for a
//   party bigger than its spaces left and in for one that fits, on the chosen day or, with no date, anywhere in the window
// - guests ride with the other filters, and the calendar offers only days with room for the party
// - the lib's isOpenSession and the SQL agree on a party at every edge of spaces left
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

const { scope, insertExperience, insertSession } = browseFixtures(
  () => client.db,
);
const { list, daysFor } = browseReads(() => browse);

describe('the guests filter', () => {
  const start = '2026-11-07T14:00:00Z';
  const window = upcomingWindow(asOf, browseWindowDays);

  it.each([
    [1, true],
    [2, true],
    [3, true],
    [4, false],
    [6, false],
  ])('with 3 spaces left, a party of %i is %s', async (guests, shown) => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Three left' });
    await insertSession(exp.id, start, { allocation: 8, seatsSold: 5 });

    expect(names(await list(filtersFor(where, { guests })))).toEqual(
      shown ? ['Three left'] : [],
    );
  });

  it('leaves out an experience whose only session is full for the party, and keeps one with a session that fits', async () => {
    const where = await scope();
    const full = await insertExperience(where, { name: 'A full' });
    const room = await insertExperience(where, { name: 'B room' });
    await insertSession(full.id, start, { allocation: 6, seatsSold: 6 });
    await insertSession(room.id, start, { allocation: 8, seatsSold: 2 });

    expect(names(await list(filtersFor(where, { guests: 6 })))).toEqual([
      'B room',
    ]);
  });

  it('matches through any one session, so a full early session does not hide a later one that fits', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Two sessions' });
    await insertSession(exp.id, start, { allocation: 4, seatsSold: 4 });
    await insertSession(exp.id, '2026-11-14T14:00:00Z', { allocation: 8 });

    expect(names(await list(filtersFor(where, { guests: 4 })))).toEqual([
      'Two sessions',
    ]);
  });

  it('wants the room on the chosen day, not on another day', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Room on the 14th' });
    await insertSession(exp.id, start, { allocation: 8, seatsSold: 6 });
    await insertSession(exp.id, '2026-11-14T14:00:00Z', { allocation: 8 });

    const on = (date: string) =>
      list(filtersFor(where, { date, guests: 4 })).then(names);
    expect(await on('2026-11-07')).toEqual([]);
    expect(await on('2026-11-14')).toEqual(['Room on the 14th']);
  });

  it('wants one session with room that is also scheduled and inside the window', async () => {
    const where = await scope();
    const cancelled = await insertExperience(where, { name: 'Cancelled' });
    const late = await insertExperience(where, { name: 'Past the window' });
    await insertSession(cancelled.id, start, {
      status: 'cancelled',
      cancelReason: 'host',
    });
    await insertSession(late.id, '2027-06-01T14:00:00Z');

    expect((await list(filtersFor(where, { guests: 1 }))).items).toEqual([]);
  });

  it('lists an experience once when several sessions fit the party', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Many fit' });
    await insertSession(exp.id, start);
    await insertSession(exp.id, '2026-11-08T14:00:00Z');

    expect(names(await list(filtersFor(where, { guests: 2 })))).toEqual([
      'Many fit',
    ]);
  });

  it('offers only the days with room for the party, and the next page keeps the party', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Days' });
    await insertSession(exp.id, '2026-11-07T14:00:00Z', {
      allocation: 8,
      seatsSold: 6,
    });
    await insertSession(exp.id, '2026-11-08T14:00:00Z', { allocation: 8 });
    const base = { categories: [where.category.slug], neighborhoods: [] };

    expect(await daysFor({ ...base, guests: 2 })).toEqual([
      '2026-11-07',
      '2026-11-08',
    ]);
    expect(await daysFor({ ...base, guests: 3 })).toEqual(['2026-11-08']);
    expect(await daysFor(base)).toEqual(['2026-11-07', '2026-11-08']);
  });

  it('pages through a party search with no row twice or skipped', async () => {
    const where = await scope();
    const total = browsePageSize + 3;
    for (let index = 0; index < total; index += 1) {
      const exp = await insertExperience(where, {
        name: `P${String(index).padStart(2, '0')}`,
      });
      await insertSession(exp.id, start, { allocation: 8, seatsSold: 5 });
    }
    const filters = filtersFor(where, { guests: 3 });
    const first = await list(filters);
    const second = await list(filters, first.nextCursor);

    expect(first.items).toHaveLength(browsePageSize);
    expect([...names(first), ...names(second)]).toHaveLength(total);
    expect(new Set([...names(first), ...names(second)]).size).toBe(total);
  });

  // The SQL and the lib are two spellings of one rule; every edge of spaces left, for every party, must agree.
  it.each([
    [8, 0],
    [8, 2],
    [8, 5],
    [8, 7],
    [8, 8],
    [0, 0],
  ])(
    'agrees with isOpenSession for %i spaces and %i sold, for every party',
    async (allocation, seatsSold) => {
      const where = await scope();
      const exp = await insertExperience(where, { name: 'Edge' });
      await insertSession(exp.id, start, { allocation, seatsSold });

      for (const guests of guestCounts) {
        expect(
          (await list(filtersFor(where, { guests }))).items.length > 0,
        ).toBe(
          isOpenSession(
            { startsAt: new Date(start), allocation, seatsSold },
            window,
            guests,
          ),
        );
      }
    },
  );
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
    ).rejects.toThrow(ZodError);
    await expect(
      browse.listBrowseDayRows(
        { categories: [], neighborhoods: [], guests: null },
        'soon',
      ),
    ).rejects.toThrow(ZodError);
  });

  describe('queries sent for a cursor', () => {
    async function sentQueries(after: string, where: Scope) {
      const send = vi.spyOn(globalThis, 'fetch');
      try {
        await browse.listBrowseExperiences(
          { filters: filtersFor(where), after },
          asOf,
        );
        return send.mock.calls.map(
          ([, init]) =>
            JSON.parse(typeof init?.body === 'string' ? init.body : '{}') as {
              query: string;
            },
        );
      } finally {
        send.mockRestore();
      }
    }

    it('sends one query for a cursor nobody can see', async () => {
      const where = await scope();
      await insertExperience(where, { name: 'A live' });

      const sent = await sentQueries(
        '00000000-0000-4000-8000-0000000000aa',
        where,
      );

      expect(sent).toHaveLength(1);
    });

    it('reads the cursor row once, and the page query only compares against it', async () => {
      const where = await scope();
      const first = await insertExperience(where, { name: 'A first' });
      await insertExperience(where, { name: 'B second' });

      const sent = await sentQueries(first.id, where);

      const readsCursor = sent.filter(({ query }) =>
        query.includes('"experiences"."id" = $1'),
      );
      expect(readsCursor).toHaveLength(1);
      expect(sent.length).toBeGreaterThan(1);
    });
  });
});
