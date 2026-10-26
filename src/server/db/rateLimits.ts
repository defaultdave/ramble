import 'server-only';
import { sql } from 'drizzle-orm';
import { ConsumeInputSchema, type RateLimitDecision } from '@/lib/rateLimits';
import { db } from './client';
import { rateLimits } from './schema';

/**
 * Runs on the pooled handle, not `dbRead`, because it writes. One INSERT ... ON CONFLICT DO UPDATE
 * is atomic and takes the row's lock, so concurrent tries on a key run one after another and each
 * sees the count the last one left. Time is the database's `now()`, one clock for every instance.
 *
 * `count` stops at limit + 1, so a refused try is recorded once and a flood cannot grow the row.
 * A try after `expires_at` replaces the window instead of adding to it.
 */
export async function consumeRateLimitRow(input: {
  key: string;
  limit: number;
  windowSeconds: number;
}): Promise<RateLimitDecision> {
  const { key, limit, windowSeconds } = ConsumeInputSchema.parse(input);
  const window = sql`make_interval(secs => ${windowSeconds})`;
  const lapsed = sql`${rateLimits.expiresAt} <= now()`;

  const [row] = await db
    .insert(rateLimits)
    .values({ key, count: 1, expiresAt: sql`now() + ${window}` })
    .onConflictDoUpdate({
      target: rateLimits.key,
      set: {
        count: sql`CASE WHEN ${lapsed} THEN 1 ELSE LEAST(${rateLimits.count} + 1, ${limit}::integer + 1) END`,
        windowStartedAt: sql`CASE WHEN ${lapsed} THEN now() ELSE ${rateLimits.windowStartedAt} END`,
        expiresAt: sql`CASE WHEN ${lapsed} THEN now() + ${window} ELSE ${rateLimits.expiresAt} END`,
      },
    })
    .returning({
      count: rateLimits.count,
      retryAfterSeconds: sql<number>`GREATEST(1, CEIL(EXTRACT(EPOCH FROM ${rateLimits.expiresAt} - now())))::integer`,
    });

  if (!row) throw new Error('Rate limit upsert returned no row');
  return row.count <= limit
    ? { allowed: true, remaining: limit - row.count }
    : { allowed: false, retryAfterSeconds: row.retryAfterSeconds };
}

const PURGE_BATCH = 1000;

// TODO(U-005): first caller, on each pulse.
/**
 * Deletes rows whose window has ended, at most one batch per call, and returns how many. A row is
 * dead the moment `expires_at` passes (the next try replaces it), so purging only keeps the table
 * small. SKIP LOCKED leaves a row a concurrent try is rewriting for the next call.
 */
export async function purgeExpiredRateLimits(): Promise<number> {
  const result = await db.execute(sql`
    DELETE FROM ${rateLimits}
    WHERE ${rateLimits.key} IN (
      SELECT ${rateLimits.key} FROM ${rateLimits}
      WHERE ${rateLimits.expiresAt} <= now()
      ORDER BY ${rateLimits.expiresAt}
      LIMIT ${PURGE_BATCH}
      FOR UPDATE SKIP LOCKED
    ) AND ${rateLimits.expiresAt} <= now()
  `);
  return result.rowCount ?? 0;
}
