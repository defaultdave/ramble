import { sql } from 'drizzle-orm';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import type { db as Db } from '@/server/db/client';
import { raceAgainstOpenTransaction as race, type RaceHooks } from './harness';
import type { seedBookable } from './holdFixtures';

type Database = typeof Db;
type Tx = Parameters<Parameters<Database['transaction']>[0]>[0];

export type Bookable = Awaited<ReturnType<typeof seedBookable>>;

/** The client replaced by one with a pool of 25, so 30 reserves really do compete for connections. */
export async function pooledClientModule() {
  const { drizzle } = await import('drizzle-orm/node-postgres');
  const { Pool } = await import('pg');
  const schema = await import('@/server/db/schema');
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    max: 25,
  });
  const db = drizzle(pool, { schema, casing: 'snake_case' });
  return { db, dbRead: db };
}

// A failed query's message hides the Postgres error; the report needs its code and text.
export const describeFailure = (reason: unknown) => {
  const cause = reason instanceof Error ? reason.cause : undefined;
  if (cause instanceof Error) {
    const code = (cause as { code?: unknown }).code;
    return `${String(reason)} | cause ${String(code)}: ${cause.message}`;
  }
  return String(reason);
};

export const ops = testCaller({ roles: [Role.Ops] });

export const request = (
  sessionId: string,
  bookable: Bookable,
  quantity = 1,
) => ({
  sessionId,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

export const lockSession = (tx: Tx, sessionId: string) =>
  tx.execute(sql`SELECT id FROM sessions WHERE id = ${sessionId} FOR UPDATE`);

/** Race helpers bound to the database the test file opened in its beforeAll. */
export function holdRaceFixtures(getDb: () => Database) {
  const raceAgainstOpenTransaction = <T>(
    holder: (tx: Tx) => Promise<void>,
    challenger: () => Promise<T>,
    hooks: RaceHooks<Tx> = {},
  ) =>
    race<Tx, T>((body) => getDb().transaction(body), holder, challenger, hooks);

  async function heldSeatsOf(sessionId: string): Promise<number> {
    const result = await getDb().execute(sql`
      SELECT coalesce(sum(seats), 0)::int AS seats FROM holds
      WHERE session_id = ${sessionId}
        AND ((status = 'active' AND expires_at > now()) OR (status = 'paying' AND paying_until > now()))
    `);
    return (result.rows[0] as { seats: number }).seats;
  }

  return { raceAgainstOpenTransaction, heldSeatsOf };
}
