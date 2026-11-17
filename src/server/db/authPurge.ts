import 'server-only';
import { sql, type AnyColumn } from 'drizzle-orm';
import type { PgTable } from 'drizzle-orm/pg-core';
import { authRowRetentionDays } from '@/lib/privacy';
import { db } from './client';
import { PURGE_BATCH } from './rateLimits';
import { authSessions, authVerifications } from './schema';

/**
 * Deletes rows that expired more than `authRowRetentionDays` ago, at most one batch per call. Time
 * is the database's `now()`, so a demo `asOf` clock never purges early. The second `expires_at`
 * test under the lock keeps a row that was extended after it was picked.
 */
async function purgeLapsedRows(
  table: PgTable & { id: AnyColumn },
  expiresAt: AnyColumn,
): Promise<number> {
  const lapsed = sql`${expiresAt} < now() - make_interval(days => ${authRowRetentionDays})`;
  const result = await db.execute(sql`
    DELETE FROM ${table}
    WHERE ${table.id} IN (
      SELECT ${table.id} FROM ${table}
      WHERE ${lapsed}
      ORDER BY ${expiresAt}
      LIMIT ${PURGE_BATCH}
      FOR UPDATE SKIP LOCKED
    ) AND ${lapsed}
  `);
  if (result.rowCount === null) {
    throw new Error('The driver did not report how many rows were purged');
  }
  return result.rowCount;
}

/** Sign-in link rows hold the address the link was sent to; one that is never used stays until this runs. */
export function purgeLapsedAuthVerifications(): Promise<number> {
  return purgeLapsedRows(authVerifications, authVerifications.expiresAt);
}

/** Sessions past their idle deadline. Nothing references a session row, so deleting one has no side effect. */
export function purgeLapsedAuthSessions(): Promise<number> {
  return purgeLapsedRows(authSessions, authSessions.expiresAt);
}
