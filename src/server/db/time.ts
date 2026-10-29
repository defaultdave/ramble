import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client';

// The driver hands timestamps back as text, so the time travels as whole milliseconds since the epoch.
const TimeRowSchema = z.object({ atMs: z.coerce.number().int() });

/**
 * The database's clock, to the millisecond (rounded down). A hold is judged by the clock that runs
 * the SQL pre-filter and the later re-checks (design doc 4.2.3 rule 2). It is its own statement,
 * read after the lock: a `clock_timestamp()` in the locking SELECT's own column list could be
 * evaluated before the lock wait ends.
 */
export async function readDatabaseTime(executor: {
  execute: (query: SQL) => PromiseLike<{ rows: unknown[] }>;
}): Promise<Date> {
  const result = await executor.execute(
    sql`SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint AS "atMs"`,
  );
  return new Date(TimeRowSchema.parse(result.rows[0]).atMs);
}

/** The database's clock outside a transaction, for a refusal that needs a time and takes no lock. */
export function currentDatabaseTime(): Promise<Date> {
  return readDatabaseTime(db);
}
