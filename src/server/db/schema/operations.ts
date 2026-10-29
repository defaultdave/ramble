import { sql } from 'drizzle-orm';
import {
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { privacyRequestKinds, privacyRequestStatuses } from '@/lib/guests';
import { rateLimitKeyPattern } from '@/lib/rateLimits';
import { guests } from './people';
import { isReadableDate } from './shared';

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

export const privacyRequestKindEnum = pgEnum(
  'privacy_request_kind',
  privacyRequestKinds,
);
export const privacyRequestStatusEnum = pgEnum(
  'privacy_request_status',
  privacyRequestStatuses,
);

/**
 * A guest's request for access or deletion. It names the guest and holds no personal data of its
 * own. An open request has no `resolved_at`, and a guest has at most one open request of each kind.
 */
export const privacyRequests = pgTable(
  'privacy_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    guestId: uuid()
      .notNull()
      .references(() => guests.id, { onDelete: 'restrict' }),
    kind: privacyRequestKindEnum().notNull(),
    status: privacyRequestStatusEnum().notNull().default('open'),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    resolvedAt: timestamp({ withTimezone: true }),
  },
  (table) => [
    check(
      'privacy_requests_resolved_iff_not_open',
      sql`(${table.status} = 'open') = (${table.resolvedAt} IS NULL)`,
    ),
    check(
      'privacy_requests_created_at_in_range',
      isReadableDate(table.createdAt),
    ),
    check(
      'privacy_requests_resolved_at_in_range',
      sql`${table.resolvedAt} IS NULL OR (${isReadableDate(table.resolvedAt)} AND ${table.resolvedAt} >= ${table.createdAt})`,
    ),
    uniqueIndex('privacy_requests_one_open_per_kind')
      .on(table.guestId, table.kind)
      .where(sql`${table.status} = 'open'`),
    index('privacy_requests_guest_idx').on(table.guestId),
  ],
);
