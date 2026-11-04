import { eq } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import {
  cancellationTiers,
  categories,
  experiences,
  hosts,
  neighborhoods,
  sessions,
} from '@/server/db/schema';

type Database = typeof Db;

let counter = 0;
/** A name or slug no other row in this test file has, so a test reads only the rows it made. */
export function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

export type Parents = {
  hostId: string;
  categoryId: string;
  neighborhoodId: string;
  cancellationTierId: string;
};

/**
 * Inserts for the catalog tables. The client is a getter because a db file imports it lazily,
 * after stubbing DATABASE_URL.
 */
export function catalogFixtures(getDb: () => Database) {
  async function defaultTierId() {
    const [tier] = await getDb()
      .select()
      .from(cancellationTiers)
      .where(eq(cancellationTiers.isDefault, true));
    if (!tier) throw new Error('The migration inserts a default tier');
    return tier.id;
  }

  async function insertHost(
    overrides: Partial<typeof hosts.$inferInsert> = {},
  ) {
    const [row] = await getDb()
      .insert(hosts)
      .values({
        slug: unique('host'),
        name: unique('Host'),
        timeZone: 'America/New_York',
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert returned no host');
    return row;
  }

  async function insertCategory(
    overrides: Partial<typeof categories.$inferInsert> = {},
  ) {
    const [row] = await getDb()
      .insert(categories)
      .values({
        slug: unique('category'),
        name: unique('Category'),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert returned no category');
    return row;
  }

  async function insertNeighborhood(
    overrides: Partial<typeof neighborhoods.$inferInsert> = {},
  ) {
    const [row] = await getDb()
      .insert(neighborhoods)
      .values({
        slug: unique('neighborhood'),
        name: unique('Neighborhood'),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert returned no neighborhood');
    return row;
  }

  /** Every parent an experience needs, on the host given or a new one. */
  async function parents(
    hostId?: string,
    neighborhood: Partial<typeof neighborhoods.$inferInsert> = {},
  ): Promise<Parents> {
    return {
      hostId: hostId ?? (await insertHost()).id,
      categoryId: (await insertCategory()).id,
      neighborhoodId: (await insertNeighborhood(neighborhood)).id,
      cancellationTierId: await defaultTierId(),
    };
  }

  async function insertExperience(
    parentIds: Parents,
    overrides: Partial<typeof experiences.$inferInsert> = {},
  ) {
    const [row] = await getDb()
      .insert(experiences)
      .values({
        ...parentIds,
        slug: unique('experience'),
        name: unique('Experience'),
        ...overrides,
      })
      .returning();
    if (!row) throw new Error('insert returned no experience');
    return row;
  }

  /** A two hour session for eight spaces unless the overrides say otherwise. */
  async function insertSession(
    experienceId: string,
    startsAt: Date,
    overrides: Partial<typeof sessions.$inferInsert> = {},
  ) {
    const [row] = await getDb()
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

  return {
    defaultTierId,
    insertHost,
    insertCategory,
    insertNeighborhood,
    parents,
    insertExperience,
    insertSession,
  };
}
