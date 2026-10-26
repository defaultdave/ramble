import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgTable,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { rateLimitKeyPattern } from '@/lib/rateLimits';

/**
 * One fixed window per key. A row past `expires_at` is dead: the next try starts a new window, and
 * the purge removes it. `count` stops one past the limit, so a flood cannot grow it.
 */
export const rateLimits = pgTable(
  'rate_limits',
  {
    key: text().primaryKey(),
    count: integer().notNull(),
    windowStartedAt: timestamp({ withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp({ withTimezone: true }).notNull(),
  },
  (table) => [
    check(
      'rate_limits_key_shape',
      sql`${table.key} ~ ${sql.raw(`'${rateLimitKeyPattern}'`)}`,
    ),
    check('rate_limits_count_positive', sql`${table.count} >= 1`),
    check(
      'rate_limits_window_forward',
      sql`${table.expiresAt} > ${table.windowStartedAt}`,
    ),
    index('rate_limits_expires_at').on(table.expiresAt),
  ],
);
