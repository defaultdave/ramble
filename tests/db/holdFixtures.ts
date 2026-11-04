import { sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import { experiences, holds, priceOptions, sessions } from '@/server/db/schema';
import { catalogFixtures } from './catalogFixtures';

type Database = typeof Db;
type ExperienceInsert = typeof experiences.$inferInsert;
type SessionInsert = typeof sessions.$inferInsert;
type HoldInsert = typeof holds.$inferInsert;

/**
 * Deletes every hold and its items. TRUNCATE ... CASCADE would reach the append-only ledger, and a
 * plain DELETE trips the restricting `superseded_by` key, so each pass deletes the holds no other
 * hold points at.
 */
export async function clearHolds(db: Pick<Database, 'execute'>) {
  await db.execute(sql`
    DO $$ BEGIN
      LOOP
        DELETE FROM hold_items;
        DELETE FROM holds WHERE id NOT IN (SELECT superseded_by FROM holds WHERE superseded_by IS NOT NULL);
        EXIT WHEN NOT EXISTS (SELECT 1 FROM holds);
      END LOOP;
    END $$`);
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
  const catalog = catalogFixtures(() => db);
  const host = await catalog.insertHost();
  const experience = await catalog.insertExperience(
    await catalog.parents(host.id),
    { status: 'live', taxTreatment: 'taxable', ...options.experience },
  );
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
  // The timestamps come from the database clock unless the caller gives a createdAt: a product write
  // stamps updated_at from that clock, and the host clock can run ahead of it.
  const createdAt = overrides.createdAt;
  const [row] = await db
    .insert(holds)
    .values({
      sessionId,
      purpose: 'booking',
      status: 'active',
      seats: 1,
      deviceKey: hash('a'),
      ipHash: hash('b'),
      ...(createdAt === undefined
        ? {
            createdAt: sql`now()`,
            updatedAt: sql`now()`,
            expiresAt: sql`now() + make_interval(mins => 10)`,
          }
        : {
            updatedAt: createdAt,
            expiresAt:
              createdAt instanceof Date
                ? new Date(createdAt.getTime() + 10 * minute)
                : sql`${createdAt} + make_interval(mins => 10)`,
          }),
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no hold');
  return row;
}
