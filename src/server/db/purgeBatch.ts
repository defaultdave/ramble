import 'server-only';
import { sql, type AnyColumn, type SQL } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { db } from './client';

export const PURGE_BATCH = 1000;

/**
 * Deletes rows whose `expiresAt` is at or before `cutoff`, at most one batch per call, and returns
 * how many. `cutoff` is a SQL expression on the database clock, so no caller's clock can purge
 * early. SKIP LOCKED leaves a row another transaction holds for the next call, and the second
 * `expiresAt` test under the lock keeps a row that was extended after it was picked.
 */
export async function purgeExpiredBatch(input: {
  table: PgTable;
  key: AnyColumn;
  expiresAt: AnyColumn;
  cutoff: SQL;
}): Promise<number> {
  const { table, key, expiresAt, cutoff } = input;
  const result = await db.execute(sql`
    DELETE FROM ${table}
    WHERE ${key} IN (
      SELECT ${key} FROM ${table}
      WHERE ${expiresAt} <= ${cutoff}
      ORDER BY ${expiresAt}
      LIMIT ${PURGE_BATCH}
      FOR UPDATE SKIP LOCKED
    ) AND ${expiresAt} <= ${cutoff}
  `);
  if (result.rowCount === null) {
    throw new Error('The driver did not report how many rows were purged');
  }
  return result.rowCount;
}
