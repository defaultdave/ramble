import 'server-only';
import { sql } from 'drizzle-orm';
import { authRowRetentionDays } from '@/lib/privacy';
import { purgeExpiredBatch } from './purgeBatch';
import { authSessions, authVerifications } from './schema';

const lapsedLongAgo = sql`now() - make_interval(days => ${authRowRetentionDays})`;

/** Sign-in link rows hold the address the link was sent to; one that is never used stays until this runs. */
export function purgeLapsedAuthVerifications(): Promise<number> {
  return purgeExpiredBatch({
    table: authVerifications,
    key: authVerifications.id,
    expiresAt: authVerifications.expiresAt,
    cutoff: lapsedLongAgo,
  });
}

/** Sessions past their idle deadline. Nothing references a session row, so deleting one has no side effect. */
export function purgeLapsedAuthSessions(): Promise<number> {
  return purgeExpiredBatch({
    table: authSessions,
    key: authSessions.id,
    expiresAt: authSessions.expiresAt,
    cutoff: lapsedLongAgo,
  });
}
