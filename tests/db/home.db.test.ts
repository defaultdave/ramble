import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { homeLimits } from '@/lib/pages/home';
import { upcomingWindow } from '@/lib/sessionWindow';
import { hasSpaceLeft } from '@/lib/spaces';
import {
  experiences,
  photos,
  priceOptions,
  sessions,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { catalogFixtures, unique } from './catalogFixtures';

// Behaviours under test, one per decision, branch or risk:
// - the experience read returns live and guide-only experiences with the card's fields, and never a draft, one in review, or a paused one
// - the experience read returns only the IDs asked for, and nothing for an empty list
// - the experience read carries the neighborhood name and every price option, and nothing the card does not show
// - with covers asked for, each experience carries its lowest-position photo, or a null image when it has none and still lists
// - without covers asked for, the rows carry no image
// - an unbounded list of IDs, or an ID that is not a uuid, is refused before the database is asked
// - the session read returns scheduled sessions that start after the window opens and up to its end, soonest first
//   (the opening instant is inside, the closing instant outside)
// - the session read leaves out cancelled and completed sessions and those of an experience a guest cannot see
// - the session read returns one row per experience, its soonest open session, and leaves out sold-out sessions
//   by the threshold hasSpaceLeft uses
// - the session read is not short when more sold-out sessions than its limit start before the open ones
// - the session read never returns more than its limit, one row per experience
// - the partial index on starts_at for scheduled sessions exists and the planner can use it

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let home: typeof import('@/server/db/home');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  home = await import('@/server/db/home');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

const fixtures = catalogFixtures(() => client.db);
const { parents, insertSession } = fixtures;

async function insertExperience(
  overrides: Partial<typeof experiences.$inferInsert> = {},
) {
  return fixtures.insertExperience(await parents(), {
    status: 'live',
    ...overrides,
  });
}

const opens = new Date('2026-11-02T15:00:00.000Z');
const window = upcomingWindow(opens.toISOString(), homeLimits.thisWeekDays);

const noCovers = { covers: false };
const withCovers = { covers: true };

async function insertPhoto(experienceId: string, position: number) {
  const id = randomUUID();
  await client.db.insert(photos).values({
    id,
    experienceId,
    position,
    storageKey: `public/photos/${experienceId}/${id}.jpg`,
    url: `https://store.example/${experienceId}/${String(position)}.jpg`,
    width: 1600,
    height: 1000,
    byteSize: 1000,
    decorative: false,
    altText: `Photo ${String(position)}`,
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    rightsBasis: 'ramble_owned',
  });
}

describe('listHomeExperiences', () => {
  it('returns what a card shows for a live and a guide-only experience', async () => {
    const live = await insertExperience({
      name: 'Pasta night',
      slug: 'pasta-night',
      durationMinutes: 150,
      ...(await parents(undefined, { name: 'Carroll Gardens' })),
    });
    await client.db.insert(priceOptions).values([
      { experienceId: live.id, kind: 'child', priceMinor: 4000 },
      {
        experienceId: live.id,
        kind: 'adult',
        priceMinor: 8500,
        usesSpace: false,
      },
    ]);
    const guide = await insertExperience({
      name: 'Harbor walk',
      status: 'guide_only',
      linkOutUrl: 'https://host.example/walk',
    });

    const found = await home.listHomeExperiences([live.id, guide.id], noCovers);

    expect(found.map((row) => row.name)).toEqual([
      'Harbor walk',
      'Pasta night',
    ]);
    const pasta = found.find((row) => row.id === live.id);
    expect(pasta).toMatchObject({
      slug: 'pasta-night',
      status: 'live',
      neighborhoodName: 'Carroll Gardens',
      durationMinutes: 150,
      linkOutUrl: null,
    });
    expect(
      pasta?.priceOptions
        .map(
          (option) =>
            `${String(option.priceMinor)}:${String(option.usesSpace)}`,
        )
        .toSorted(),
    ).toEqual(['4000:true', '8500:false']);
    expect(found.find((row) => row.id === guide.id)).toMatchObject({
      status: 'guide_only',
      linkOutUrl: 'https://host.example/walk',
      priceOptions: [],
    });
  });

  it('carries the lowest-position photo as the cover when covers are asked for', async () => {
    const covered = await insertExperience();
    await insertPhoto(covered.id, 2);
    await insertPhoto(covered.id, 0);
    await insertPhoto(covered.id, 1);

    const [found] = await home.listHomeExperiences([covered.id], withCovers);

    expect(found?.image).toEqual({
      src: `https://store.example/${covered.id}/0.jpg`,
      width: 1600,
      height: 1000,
      alt: 'Photo 0',
      blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
    });
  });

  it('still lists an experience with no photo, with a null image', async () => {
    const bare = await insertExperience();

    const [found] = await home.listHomeExperiences([bare.id], withCovers);

    expect(found?.id).toBe(bare.id);
    expect(found?.image).toBeNull();
  });

  it('leaves the cover out when covers are not asked for', async () => {
    const covered = await insertExperience();
    await insertPhoto(covered.id, 0);

    const [found] = await home.listHomeExperiences([covered.id], noCovers);

    expect(found).not.toHaveProperty('image');
  });

  it('carries nothing a card does not show', async () => {
    const live = await insertExperience({
      taxTreatment: 'taxable',
      meetingPoint: 'Pier 26',
    });

    const [found] = await home.listHomeExperiences([live.id], noCovers);

    expect(Object.keys(found ?? {}).toSorted()).toEqual([
      'durationMinutes',
      'id',
      'linkOutUrl',
      'name',
      'neighborhoodName',
      'priceOptions',
      'slug',
      'status',
    ]);
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'never returns an experience that is %s',
    async (status) => {
      const hidden = await insertExperience({ status });
      const live = await insertExperience();

      const found = await home.listHomeExperiences(
        [hidden.id, live.id],
        noCovers,
      );

      expect(found.map((row) => row.id)).toEqual([live.id]);
    },
  );

  it('returns only the IDs it was asked for', async () => {
    const asked = await insertExperience();
    await insertExperience();

    const found = await home.listHomeExperiences([asked.id], noCovers);

    expect(found.map((row) => row.id)).toEqual([asked.id]);
  });

  it('answers an empty list with nothing', async () => {
    await expect(home.listHomeExperiences([], noCovers)).resolves.toEqual([]);
  });

  it('refuses more IDs than a home read looks up', async () => {
    const tooMany = Array.from(
      { length: homeLimits.maxCardIds + 1 },
      (_, n) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`,
    );

    await expect(home.listHomeExperiences(tooMany, noCovers)).rejects.toThrow(
      ZodError,
    );
  });

  it('refuses an ID that is not a uuid', async () => {
    await expect(
      home.listHomeExperiences(['not-a-uuid'], noCovers),
    ).rejects.toThrow(ZodError);
  });
});

describe('listThisWeekSessions', () => {
  it('returns the soonest session of each experience, soonest first', async () => {
    const first = await insertExperience();
    const second = await insertExperience();
    await insertSession(first.id, new Date(opens.getTime() + 5 * 3_600_000));
    const soonerOfFirst = await insertSession(
      first.id,
      new Date(opens.getTime() + 2 * 3_600_000),
    );
    const soonest = await insertSession(
      second.id,
      new Date(opens.getTime() + 3_600_000),
      { allocation: 5, seatsSold: 2 },
    );

    const found = (await home.listThisWeekSessions(window)).filter((row) =>
      [first.id, second.id].includes(row.experienceId),
    );

    expect(found.map((row) => row.startsAt.getTime())).toEqual([
      soonest.startsAt.getTime(),
      soonerOfFirst.startsAt.getTime(),
    ]);
    expect(found[0]).toEqual({
      experienceId: second.id,
      experienceStatus: 'live',
      startsAt: soonest.startsAt,
      allocation: 5,
      seatsSold: 2,
    });
  });

  it.each([
    ['one space left', 8, 7],
    ['no space left', 8, 8],
    ['an allocation of none', 0, 0],
  ])(
    'treats a session with %s as hasSpaceLeft does',
    async (_name, allocation, seatsSold) => {
      const experience = await insertExperience();
      await insertSession(
        experience.id,
        new Date(opens.getTime() + 3_600_000),
        {
          allocation,
          seatsSold,
        },
      );

      const found = (await home.listThisWeekSessions(window)).filter(
        (row) => row.experienceId === experience.id,
      );

      expect(found.length === 1).toBe(hasSpaceLeft({ allocation, seatsSold }));
    },
  );

  it('returns the later open session of an experience whose early one is sold out', async () => {
    const experience = await insertExperience();
    await insertSession(experience.id, new Date(opens.getTime() + 3_600_000), {
      allocation: 4,
      seatsSold: 4,
    });
    const open = await insertSession(
      experience.id,
      new Date(opens.getTime() + 2 * 3_600_000),
    );

    const found = (await home.listThisWeekSessions(window)).filter(
      (row) => row.experienceId === experience.id,
    );

    expect(found.map((row) => row.startsAt.getTime())).toEqual([
      open.startsAt.getTime(),
    ]);
  });

  it('keeps the opening instant and leaves out the closing one', async () => {
    const experience = await insertExperience();
    const atStart = await insertSession(experience.id, window.from);
    await insertSession(experience.id, window.to);
    await insertSession(experience.id, new Date(window.to.getTime() + 1000));

    const found = (await home.listThisWeekSessions(window)).filter(
      (row) => row.experienceId === experience.id,
    );

    expect(found.map((row) => row.startsAt.getTime())).toEqual([
      atStart.startsAt.getTime(),
    ]);
  });

  it.each(['cancelled', 'completed'] as const)(
    'leaves out a %s session',
    async (status) => {
      const experience = await insertExperience();
      await insertSession(
        experience.id,
        new Date(opens.getTime() + 3_600_000),
        status === 'cancelled' ? { status, cancelReason: 'host' } : { status },
      );

      const found = (await home.listThisWeekSessions(window)).filter(
        (row) => row.experienceId === experience.id,
      );

      expect(found).toEqual([]);
    },
  );

  it.each(['draft', 'in_review', 'paused'] as const)(
    'leaves out a session of an experience that is %s',
    async (status) => {
      const experience = await insertExperience({ status });
      await insertSession(experience.id, new Date(opens.getTime() + 3_600_000));

      const found = (await home.listThisWeekSessions(window)).filter(
        (row) => row.experienceId === experience.id,
      );

      expect(found).toEqual([]);
    },
  );
});

describe('listThisWeekSessions at its limit', () => {
  beforeAll(async () => {
    await client.db.delete(sessions);
  });

  async function insertExperiences(count: number) {
    const shared = await parents();
    const rows = await client.db
      .insert(experiences)
      .values(
        Array.from({ length: count }, () => ({
          ...shared,
          slug: unique('experience'),
          name: unique('Experience'),
          status: 'live' as const,
        })),
      )
      .returning({ id: experiences.id });
    return rows.map((row) => row.id);
  }

  function sessionAt(experienceId: string, n: number, seatsSold: number) {
    const startsAt = new Date(opens.getTime() + (n + 1) * 60_000);
    return {
      experienceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 3_600_000),
      timeZone: 'America/New_York',
      allocation: 8,
      seatsSold,
      source: 'ramble' as const,
    };
  }

  it('is not short when more sold-out sessions than its limit start before the open ones', async () => {
    const ids = await insertExperiences(homeLimits.thisWeekSessions + 1);
    const [openId, ...soldOutIds] = ids.toReversed();
    await client.db
      .insert(sessions)
      .values(soldOutIds.map((id, n) => sessionAt(id, n, 8)));
    await client.db
      .insert(sessions)
      .values(sessionAt(openId ?? '', soldOutIds.length, 0));

    const found = await home.listThisWeekSessions(window);

    expect(found.map((row) => row.experienceId)).toEqual([openId]);
  });

  it('never returns more than its limit', async () => {
    await client.db.delete(sessions);
    const ids = await insertExperiences(homeLimits.thisWeekSessions + 1);
    await client.db
      .insert(sessions)
      .values(ids.map((id, n) => sessionAt(id, n, 0)));

    const found = await home.listThisWeekSessions(window);

    expect(found).toHaveLength(homeLimits.thisWeekSessions);
  });
});

describe('the sessions starts_at index for scheduled sessions', () => {
  it('is partial on scheduled sessions', async () => {
    const { rows } = await client.db.execute<{ indexdef: string }>(
      sql`SELECT indexdef FROM pg_indexes WHERE schemaname = ${fresh.schema} AND indexname = 'sessions_scheduled_starts_at_idx'`,
    );
    expect(rows[0]?.indexdef).toMatch(
      /\(starts_at\).*WHERE.*status = 'scheduled'/,
    );
  });

  it('is what the planner reads for the soonest scheduled sessions', async () => {
    const connection = await client.db.$client.connect();
    try {
      await connection.query('BEGIN');
      await connection.query('SET LOCAL enable_seqscan = off');
      const { rows } = await connection.query<{ 'QUERY PLAN': string }>(
        "EXPLAIN SELECT id FROM sessions WHERE status = 'scheduled' ORDER BY starts_at LIMIT 10",
      );
      expect(rows.map((row) => row['QUERY PLAN']).join('\n')).toContain(
        'sessions_scheduled_starts_at_idx',
      );
    } finally {
      await connection.query('ROLLBACK');
      connection.release();
    }
  });
});
