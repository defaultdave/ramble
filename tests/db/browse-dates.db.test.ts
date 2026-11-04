import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  browseWindowDays,
  maxHandEnteredDayRows,
  maxStoredDayRows,
} from '@/lib/pages/browse';
import { msPerDay } from '@/lib/time';
import { sessions } from '@/server/db/schema';
import {
  asOf,
  browseFixtures,
  browseReads,
  filtersFor,
  names,
  shiftDay,
} from './browseFixtures';
import { catalogFixtures } from './catalogFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the date filter matches a scheduled session that starts that day in the host's own calendar, from the
//   stored date or, for a session entered by hand, from its time zone
// - a session starting exactly at asOf is offered and matches; one starting exactly at the window's end does neither
// - a cancelled session, a session already started, and a session past the window never match
// - the calendar read returns raw stored values only (stored dates, and start and zone of hand-entered sessions) and decides no day
// - each calendar list has a hard cap

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

const { insertNeighborhood } = catalogFixtures(() => client.db);
const { scope, insertExperience, insertSession, insertTemplate } =
  browseFixtures(() => client.db);
const { list, daysFor } = browseReads(() => browse);

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
      { categories: [where.category.slug], neighborhoods: [], guests: null },
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
        { categories: [where.category.slug], neighborhoods: [], guests: null },
        asOf,
      ),
    ).toEqual({ storedDates: [], handEntered: [] });
  });

  it('refuses a read with more stored dates than the cap rather than cutting it', async () => {
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

    await expect(
      browse.listBrowseDayRows(
        { categories: [where.category.slug], neighborhoods: [], guests: null },
        asOf,
      ),
    ).rejects.toThrow();
  });

  it('refuses a read with more hand-entered sessions than the cap rather than cutting it', async () => {
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

    await expect(
      browse.listBrowseDayRows(
        { categories: [where.category.slug], neighborhoods: [], guests: null },
        asOf,
      ),
    ).rejects.toThrow();
  });
});

describe('the window edges', () => {
  const opening = asOf;
  const closing = new Date(
    new Date(asOf).getTime() + browseWindowDays * msPerDay,
  ).toISOString();

  it('offers and matches a session starting exactly when the window opens', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'At the opening' });
    await insertSession(exp.id, opening);

    expect(
      await daysFor({ categories: [where.category.slug], neighborhoods: [] }),
    ).toEqual([opening.slice(0, 10)]);
    expect(
      names(await list(filtersFor(where, { date: opening.slice(0, 10) }))),
    ).toEqual(['At the opening']);
  });

  it('neither offers nor matches a session starting exactly when the window ends', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'At the closing' });
    await insertSession(exp.id, closing);

    expect(
      await daysFor({ categories: [where.category.slug], neighborhoods: [] }),
    ).toEqual([]);
    expect(
      (await list(filtersFor(where, { date: closing.slice(0, 10) }))).items,
    ).toEqual([]);
  });
});

describe('days with no space left', () => {
  it('neither offers nor matches a day whose only sessions are sold out, and does both for a day with one space left', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Sold out day' });
    await insertSession(exp.id, '2026-11-07T14:00:00Z', {
      allocation: 4,
      seatsSold: 4,
    });
    await insertSession(exp.id, '2026-11-07T19:00:00Z', {
      allocation: 0,
      seatsSold: 0,
    });
    await insertSession(exp.id, '2026-11-08T14:00:00Z', {
      allocation: 4,
      seatsSold: 3,
    });
    const filters = { categories: [where.category.slug], neighborhoods: [] };

    expect(await daysFor(filters)).toEqual(['2026-11-08']);
    expect(
      (await list(filtersFor(where, { date: '2026-11-07' }))).items,
    ).toEqual([]);
    expect(
      names(await list(filtersFor(where, { date: '2026-11-08' }))),
    ).toEqual(['Sold out day']);
  });

  it('offers a day through its session with space even when another session that day is sold out', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Mixed day' });
    await insertSession(exp.id, '2026-11-07T14:00:00Z', {
      allocation: 4,
      seatsSold: 4,
    });
    await insertSession(exp.id, '2026-11-07T19:00:00Z', {
      allocation: 4,
      seatsSold: 0,
    });

    expect(
      await daysFor({ categories: [where.category.slug], neighborhoods: [] }),
    ).toEqual(['2026-11-07']);
    expect(
      names(await list(filtersFor(where, { date: '2026-11-07' }))),
    ).toEqual(['Mixed day']);
  });

  it('still lists an experience with no space left when no date is chosen', async () => {
    const where = await scope();
    const exp = await insertExperience(where, { name: 'Full but listed' });
    await insertSession(exp.id, '2026-11-07T14:00:00Z', {
      allocation: 4,
      seatsSold: 4,
    });

    expect(names(await list(filtersFor(where)))).toEqual(['Full but listed']);
  });
});
