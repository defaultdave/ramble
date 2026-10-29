import 'server-only';
import { sql } from 'drizzle-orm';
import { z } from 'zod';
import { db } from './client';
import type { Transaction } from './locks';

const TimeRowSchema = z.object({ at: z.date() });

/**
 * The database's clock, to the millisecond. A hold is judged by the clock that runs the SQL
 * pre-filter and the later re-checks (design doc 4.2.3 rule 2). It is its own statement, read
 * after the lock: a `clock_timestamp()` in the locking SELECT's own column list could be
 * evaluated before the lock wait ends.
 */
export async function readDatabaseTime(
  executor: Pick<Transaction, 'execute'>,
): Promise<Date> {
  const result = await executor.execute(
    sql`SELECT date_trunc('milliseconds', clock_timestamp()) AS at`,
  );
  return TimeRowSchema.parse(result.rows[0]).at;
}

/** The database's clock outside a transaction, for a refusal that needs a time and takes no lock. */
export function currentDatabaseTime(): Promise<Date> {
  return readDatabaseTime(db);
}
