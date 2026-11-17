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
import { reviewLimits, reviewStatuses } from '@/lib/reviews';
import { experiences } from './catalog';
import { orders } from './orders';
import { isReadableDate, requiredText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.

export const reviewStatusEnum = pgEnum('review_status', reviewStatuses);

const timestampTz = () => timestamp({ withTimezone: true });

/**
 * What a verified booker wrote about a session they took: one row per order. The experience is
 * the order's, copied at write time so a page lists an experience's reviews without a join through
 * orders. `status` says whether the review may be shown; a row is written `visible`.
 */
export const reviews = pgTable(
  'reviews',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    rating: integer().notNull(),
    body: text().notNull(),
    status: reviewStatusEnum().notNull().default('visible'),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // One review per order: the second of two racing submits fails here.
    uniqueIndex('reviews_order_id_unique').on(table.orderId),
    index('reviews_experience_status_idx').on(
      table.experienceId,
      table.status,
      table.createdAt,
    ),
    check(
      'reviews_rating_in_range',
      sql`${table.rating} BETWEEN ${sql.raw(String(reviewLimits.minRating))} AND ${sql.raw(String(reviewLimits.maxRating))}`,
    ),
    check(
      'reviews_body_text',
      requiredText(table.body, reviewLimits.bodyMaxChars),
    ),
    check('reviews_created_at_in_range', isReadableDate(table.createdAt)),
    check(
      'reviews_updated_at_in_range',
      sql`${isReadableDate(table.updatedAt)} AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);
