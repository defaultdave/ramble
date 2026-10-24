import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  pgTable,
  text,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';

/** Reference data: a migration inserts the rows, and a host picks one per experience. */
export const cancellationTiers = pgTable(
  'cancellation_tiers',
  {
    id: uuid().primaryKey().defaultRandom(),
    key: text().notNull().unique(),
    name: text().notNull(),
    fullRefundHoursBefore: integer().notNull(),
    isDefault: boolean().notNull().default(false),
  },
  (table) => [
    check(
      'cancellation_tiers_hours_not_negative',
      sql`${table.fullRefundHoursBefore} >= 0`,
    ),
    uniqueIndex('cancellation_tiers_one_default')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);
