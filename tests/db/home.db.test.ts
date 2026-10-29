import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { homeLimits } from '@/lib/home';
import { upcomingWindow } from '@/lib/sessionWindow';
import {
  categories,
  cancellationTiers,
  experiences,
  hosts,
  neighborhoods,
  photos,
  priceOptions,
  sessions,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

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
// - the session read never returns more than its limit

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

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

async function parents(neighborhoodName = unique('Neighborhood')) {
  const [host] = await client.db
    .insert(hosts)
    .values({
      slug: unique('host'),
      name: unique('Host'),
      timeZone: 'America/New_York',
    })
    .returning();
  const [category] = await client.db
    .insert(categories)
    .values({ slug: unique('category'), name: unique('Category') })
    .returning();
  const [neighborhood] = await client.db
    .insert(neighborhoods)
    .values({ slug: unique('neighborhood'), name: neighborhoodName })
    .returning();
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!host || !category || !neighborhood || !tier) {
    throw new Error('missing parents');
  }
  return {
    hostId: host.id,
    categoryId: category.id,
    neighborhoodId: neighborhood.id,
    cancellationTierId: tier.id,
  };
}

async function insertExperience(
  overrides: Partial<typeof experiences.$inferInsert> = {},
) {
  const [row] = await client.db
    .insert(experiences)
    .values({
      ...(await parents()),
      slug: unique('experience'),
      name: unique('Experience'),
      status: 'live',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no experience');
  return row;
}

const opens = new Date('2026-11-02T15:00:00.000Z');
const window = upcomingWindow(opens.toISOString(), homeLimits.thisWeekDays);

async function insertSession(
  experienceId: string,
  startsAt: Date,
  overrides: Partial<typeof sessions.$inferInsert> = {},
) {
  const [row] = await client.db
    .insert(sessions)
    .values({
      experienceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 3_600_000),
      timeZone: 'America/New_York',
      allocation: 8,
      source: 'ramble',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no session');
  return row;
}

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
      ...(await parents('Carroll Gardens')),
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
  it('returns scheduled sessions inside the window, soonest first', async () => {
    const experience = await insertExperience();
    const later = await insertSession(
      experience.id,
      new Date(opens.getTime() + 5 * 3_600_000),
    );
    const sooner = await insertSession(
      experience.id,
      new Date(opens.getTime() + 3_600_000),
      { allocation: 5, seatsSold: 2 },
    );

    const found = (await home.listThisWeekSessions(window)).filter(
      (row) => row.experienceId === experience.id,
    );

    expect(found.map((row) => row.startsAt.getTime())).toEqual([
      sooner.startsAt.getTime(),
      later.startsAt.getTime(),
    ]);
    expect(found[0]).toEqual({
      experienceId: experience.id,
      experienceStatus: 'live',
      startsAt: sooner.startsAt,
      allocation: 5,
      seatsSold: 2,
    });
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

  it('never returns more than its limit', async () => {
    const experience = await insertExperience();
    await client.db.insert(sessions).values(
      Array.from({ length: homeLimits.thisWeekSessions + 1 }, (_, n) => {
        const startsAt = new Date(opens.getTime() + (n + 1) * 60_000);
        return {
          experienceId: experience.id,
          startsAt,
          endsAt: new Date(startsAt.getTime() + 3_600_000),
          timeZone: 'America/New_York',
          allocation: 8,
          source: 'ramble' as const,
        };
      }),
    );

    const found = await home.listThisWeekSessions(window);

    expect(found).toHaveLength(homeLimits.thisWeekSessions);
  });
});
