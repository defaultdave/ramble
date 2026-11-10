import 'server-only';
import { and, eq, gt, sql } from 'drizzle-orm';
import { db } from './client';
import { authSessions } from './schema';

/**
 * Moves a session's idle deadline forward to `expiresAt`, never back, and never on a session that
 * has already lapsed: a request that raced the deadline cannot bring the session back.
 */
export async function extendSessionExpiry(
  sessionId: string,
  expiresAt: Date,
  now: Date,
): Promise<void> {
  await db
    .update(authSessions)
    .set({
      expiresAt: sql`GREATEST(${authSessions.expiresAt}, ${expiresAt.toISOString()}::timestamptz)`,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(
      and(
        eq(authSessions.id, sessionId),
        gt(authSessions.expiresAt, sql`${now.toISOString()}::timestamptz`),
      ),
    );
}
