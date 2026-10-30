import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ZodError } from 'zod';
import { upcomingWindow } from '@/lib/sessionWindow';
import { upcomingSessionLimits } from '@/lib/upcomingSessions';
import {
  cancellationTiers,
  categories,
  experiences,
  hosts,
  neighborhoods,
  sessions,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - the read returns the experience's scheduled sessions inside the window, soonest first, with the zone each starts in
// - the opening instant is inside the window and the closing instant outside
// - a full session is still returned: nothing here filters on spaces
// - cancelled and completed sessions, and the sessions of another experience, are left out
// - the sessions of an experience a guest cannot see are left out
// - the read never returns more than the row bound, and keeps the soonest ones
// - an ID that is not a uuid is refused before the database is asked

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let reads: typeof import('@/server/db/upcomingSessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  reads = await import('@/server/db/upcomingSessions');
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

async function insertExperience(
  overrides: Partial<typeof experiences.$inferInsert> = {},
) {
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
    .values({ slug: unique('neighborhood'), name: unique('Neighborhood') })
    .returning();
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!host || !category || !neighborhood || !tier) {
    throw new Error('missing parents');
  }
  const [row] = await client.db
    .insert(experiences)
    .values({
      hostId: host.id,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
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
const window = upcomingWindow(
  opens.toISOString(),
  upcomingSessionLimits.windowDays,
);
const hour = 3_600_000;

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
      endsAt: new Date(startsAt.getTime() + 2 * hour),
      timeZone: 'America/New_York',
      allocation: 8,
      source: 'ramble',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no session');
  return row;
}

describe('listUpcomingSessions', () => {
  it('returns the scheduled sessions inside the window, soonest first, with their zone', async () => {
    const experience = await insertExperience();
    const later = await insertSession(
      experience.id,
      new Date(opens.getTime() + 5 * hour),
      { timeZone: 'America/Chicago' },
    );
    const sooner = await insertSession(
      experience.id,
      new Date(opens.getTime() + hour),
    );

    const found = await reads.listUpcomingSessions(experience.id, window);

    expect(found).toEqual([
      {
        id: sooner.id,
        startsAt: sooner.startsAt,
        timeZone: 'America/New_York',
      },
      { id: later.id, startsAt: later.startsAt, timeZone: 'America/Chicago' },
    ]);
  });

  it('keeps the opening instant and leaves out the closing one', async () => {
    const experience = await insertExperience();
    const atStart = await insertSession(experience.id, window.from);
    await insertSession(experience.id, window.to);
    await insertSession(experience.id, new Date(window.from.getTime() - 1000));

    const found = await reads.listUpcomingSessions(experience.id, window);

    expect(found.map((row) => row.id)).toEqual([atStart.id]);
  });

  it('still returns a session with no space left', async () => {
    const experience = await insertExperience();
    const full = await insertSession(
      experience.id,
      new Date(opens.getTime() + hour),
      { allocation: 4, seatsSold: 4 },
    );

    const found = await reads.listUpcomingSessions(experience.id, window);

    expect(found.map((row) => row.id)).toEqual([full.id]);
  });

  it.each(['cancelled', 'completed'] as const)(
    'leaves out a %s session',
    async (status) => {
      const experience = await insertExperience();
      await insertSession(
        experience.id,
        new Date(opens.getTime() + hour),
        status === 'cancelled' ? { status, cancelReason: 'host' } : { status },
      );

      await expect(
        reads.listUpcomingSessions(experience.id, window),
      ).resolves.toEqual([]);
    },
  );

  it("leaves out another experience's sessions", async () => {
    const experience = await insertExperience();
    const other = await insertExperience();
    await insertSession(other.id, new Date(opens.getTime() + hour));

    await expect(
      reads.listUpcomingSessions(experience.id, window),
    ).resolves.toEqual([]);
  });

  it.each(['draft', 'in_review', 'paused'] as const)(
    'leaves out the sessions of an experience that is %s',
    async (status) => {
      const experience = await insertExperience({ status });
      await insertSession(experience.id, new Date(opens.getTime() + hour));

      await expect(
        reads.listUpcomingSessions(experience.id, window),
      ).resolves.toEqual([]);
    },
  );

  it('never returns more than the row bound, and keeps the soonest', async () => {
    const experience = await insertExperience();
    const starts = Array.from(
      { length: upcomingSessionLimits.maxRows + 2 },
      (_, n) => new Date(opens.getTime() + (n + 1) * hour),
    );
    await client.db.insert(sessions).values(
      starts.map((startsAt) => ({
        experienceId: experience.id,
        startsAt,
        endsAt: new Date(startsAt.getTime() + hour),
        timeZone: 'America/New_York',
        allocation: 8,
        source: 'ramble' as const,
      })),
    );

    const found = await reads.listUpcomingSessions(experience.id, window);

    expect(found.map((row) => row.startsAt.getTime())).toEqual(
      starts
        .slice(0, upcomingSessionLimits.maxRows)
        .map((start) => start.getTime()),
    );
  });

  it('refuses an ID that is not a uuid', async () => {
    await expect(
      reads.listUpcomingSessions('not-a-guid', window),
    ).rejects.toBeInstanceOf(ZodError);
  });
});
