import { eq } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import {
  categories,
  cancellationTiers,
  experiences,
  holds,
  hosts,
  neighborhoods,
  priceOptions,
  sessions,
} from '@/server/db/schema';

type Database = typeof Db;
type ExperienceInsert = typeof experiences.$inferInsert;
type SessionInsert = typeof sessions.$inferInsert;
type HoldInsert = typeof holds.$inferInsert;

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

export const day = 86_400_000;
export const minute = 60_000;

export const hash = (character: string) => character.repeat(64);

/**
 * A live experience with an adult price (5000, uses a space) and a child price (2500, uses none),
 * and one scheduled session a week out with the given capacity.
 */
export async function seedBookable(
  db: Database,
  options: {
    allocation?: number;
    experience?: Partial<ExperienceInsert>;
  } = {},
) {
  const [host] = await db
    .insert(hosts)
    .values({
      slug: unique('host'),
      name: unique('Host'),
      timeZone: 'America/New_York',
    })
    .returning();
  const [category] = await db
    .insert(categories)
    .values({ slug: unique('category'), name: unique('Category') })
    .returning();
  const [neighborhood] = await db
    .insert(neighborhoods)
    .values({ slug: unique('neighborhood'), name: unique('Neighborhood') })
    .returning();
  const [tier] = await db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!host || !category || !neighborhood || !tier)
    throw new Error('missing parents');
  const [experience] = await db
    .insert(experiences)
    .values({
      hostId: host.id,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
      slug: unique('experience'),
      name: unique('Experience'),
      status: 'live',
      taxTreatment: 'taxable',
      ...options.experience,
    })
    .returning();
  if (!experience) throw new Error('insert returned no experience');
  const [adult] = await db
    .insert(priceOptions)
    .values({
      experienceId: experience.id,
      kind: 'adult',
      priceMinor: 5000,
      usesSpace: true,
    })
    .returning();
  const [child] = await db
    .insert(priceOptions)
    .values({
      experienceId: experience.id,
      kind: 'child',
      priceMinor: 2500,
      usesSpace: false,
    })
    .returning();
  if (!adult || !child) throw new Error('insert returned no price option');
  const session = await insertSession(db, experience.id, {
    allocation: options.allocation ?? 10,
  });
  return { host, experience, adult, child, session };
}

export async function insertSession(
  db: Database,
  experienceId: string,
  overrides: { [K in keyof SessionInsert]?: SessionInsert[K] | SQL } = {},
) {
  const startsAt = new Date(Date.now() + 7 * day);
  const [row] = await db
    .insert(sessions)
    .values({
      experienceId,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 2 * 60 * minute),
      timeZone: 'America/New_York',
      allocation: 10,
      source: 'ramble',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no session');
  return row;
}

/** A hold row written straight to the table, valid unless the override says otherwise. */
export async function insertHold(
  db: Pick<Database, 'insert'>,
  sessionId: string,
  overrides: { [K in keyof HoldInsert]?: HoldInsert[K] | SQL } = {},
) {
  const createdAt =
    overrides.createdAt instanceof Date ? overrides.createdAt : new Date();
  const [row] = await db
    .insert(holds)
    .values({
      sessionId,
      purpose: 'booking',
      status: 'active',
      seats: 1,
      deviceKey: hash('a'),
      ipHash: hash('b'),
      createdAt,
      updatedAt: createdAt,
      expiresAt: new Date(createdAt.getTime() + 10 * minute),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no hold');
  return row;
}
