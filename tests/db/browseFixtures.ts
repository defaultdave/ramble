import { isoDateOf, msPerDay } from '@/lib/time';
import type { db as Db } from '@/server/db/client';
import {
  priceOptions,
  sessionTemplates,
  type experiences,
  type sessions,
} from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';

type Database = typeof Db;

export type Scope = {
  hostId: string;
  category: { id: string; slug: string };
  neighborhood: { id: string; slug: string; name: string };
  cancellationTierId: string;
};

export function shiftDay(date: string, days: number): string {
  return isoDateOf(new Date(Date.parse(`${date}T00:00:00Z`) + days * msPerDay));
}

/** Inserts for the browse and calendar reads, which filter by category and neighborhood. */
export function browseFixtures(getDb: () => Database) {
  const catalog = catalogFixtures(getDb);

  /** A category and neighborhood of their own, so a test reads only the rows it made. */
  async function scope(timeZone?: string): Promise<Scope> {
    return {
      hostId: (
        await catalog.insertHost(timeZone === undefined ? {} : { timeZone })
      ).id,
      category: await catalog.insertCategory(),
      neighborhood: await catalog.insertNeighborhood(),
      cancellationTierId: await catalog.defaultTierId(),
    };
  }

  /** A live experience with an adult price of 5000, or none when `price` is null. */
  async function insertExperience(
    where: Scope,
    overrides: Partial<typeof experiences.$inferInsert> & {
      price?: number | null;
    } = {},
  ) {
    const { price = 5000, ...rest } = overrides;
    const status = rest.status ?? 'live';
    const row = await catalog.insertExperience(
      {
        hostId: where.hostId,
        categoryId: where.category.id,
        neighborhoodId: where.neighborhood.id,
        cancellationTierId: where.cancellationTierId,
      },
      {
        status,
        ...(status === 'guide_only'
          ? { linkOutUrl: 'https://example.com/class' }
          : {}),
        ...rest,
      },
    );
    if (price !== null && status !== 'guide_only') {
      await getDb()
        .insert(priceOptions)
        .values({ experienceId: row.id, kind: 'adult', priceMinor: price });
    }
    return row;
  }

  function insertSession(
    experienceId: string,
    startsAt: string,
    overrides: Partial<typeof sessions.$inferInsert> = {},
  ) {
    return catalog.insertSession(experienceId, new Date(startsAt), overrides);
  }

  async function insertTemplate(experienceId: string) {
    const [template] = await getDb()
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

  return { scope, insertExperience, insertSession, insertTemplate };
}
