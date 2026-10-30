import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  deviceHashPattern,
  holdLimits,
  holdPurposes,
  holdReleasedReasons,
  holdStatuses,
  scrubbedHash,
} from '@/lib/holds';
import { MAX_UNIT_PRICE_MINOR } from '@/lib/pricing';
import { priceOptions, sessions } from './catalog';
import { isReadableDate } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.

export const holdPurposeEnum = pgEnum('hold_purpose', holdPurposes);
export const holdStatusEnum = pgEnum('hold_status', holdStatuses);
export const holdReleasedReasonEnum = pgEnum(
  'hold_released_reason',
  holdReleasedReasons,
);

const timestampTz = () => timestamp({ withTimezone: true });

/**
 * A guest's claim on spaces while they pay (design doc 4.2.3). It counts against a session only
 * while it is open: `active` before `expires_at`, or `paying` before `paying_until`. Every column
 * the design doc lists exists now, so the units that move a hold on write columns that are there.
 * The cross-row rules (the items belong to the session's experience, `seats` is the sum of the
 * space-using quantities) are held by the data layer and pinned by tests.
 */
export const holds = pgTable(
  'holds',
  {
    id: uuid().primaryKey().defaultRandom(),
    sessionId: uuid()
      .notNull()
      .references(() => sessions.id, { onDelete: 'restrict' }),
    purpose: holdPurposeEnum().notNull(),
    // No foreign key until the gifts table exists.
    giftId: uuid(),
    status: holdStatusEnum().notNull().default('active'),
    seats: integer().notNull(),
    deviceKey: text().notNull(),
    ipHash: text().notNull(),
    expiresAt: timestampTz().notNull(),
    payingUntil: timestampTz(),
    releasedReason: holdReleasedReasonEnum(),
    supersededBy: uuid(),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    foreignKey({
      name: 'holds_superseded_by_fk',
      columns: [table.supersededBy],
      foreignColumns: [table.id],
    }).onDelete('restrict'),
    // The spaces-left read touches only the holds that can still count.
    index('holds_session_open_idx')
      .on(table.sessionId)
      .where(sql`${table.status} IN ('active', 'paying')`),
    // The device limit and the block look up a device's and an address's recent holds.
    index('holds_device_key_idx').on(table.deviceKey, table.expiresAt),
    index('holds_ip_hash_idx').on(table.ipHash, table.expiresAt),
    // The cleanup job finds released holds whose hashes are still to be scrubbed.
    index('holds_released_unscrubbed_idx')
      .on(table.updatedAt)
      .where(
        sql`${table.status} = 'released' AND ${table.deviceKey} <> ${sql.raw(`'${scrubbedHash}'`)}`,
      ),
    check(
      'holds_gift_matches_purpose',
      sql`(${table.purpose} = 'gift_redemption') = (${table.giftId} IS NOT NULL)`,
    ),
    check(
      'holds_seats_in_range',
      sql`${table.seats} BETWEEN ${sql.raw(String(holdLimits.minSeats))} AND ${sql.raw(String(holdLimits.maxSeats))}`,
    ),
    check(
      'holds_device_key_sha256',
      sql`${table.deviceKey} ~ ${sql.raw(`'${deviceHashPattern}'`)}`,
    ),
    check(
      'holds_ip_hash_sha256',
      sql`${table.ipHash} ~ ${sql.raw(`'${deviceHashPattern}'`)}`,
    ),
    check(
      'holds_released_reason_matches_status',
      sql`(${table.status} = 'released') = (${table.releasedReason} IS NOT NULL)`,
    ),
    // coalesce: a comparison with NULL is unknown, and a CHECK passes on unknown.
    check(
      'holds_superseded_by_matches_reason',
      sql`coalesce(${table.releasedReason} = 'superseded', false) = (${table.supersededBy} IS NOT NULL)`,
    ),
    check(
      'holds_not_superseded_by_itself',
      sql`${table.supersededBy} IS NULL OR ${table.supersededBy} <> ${table.id}`,
    ),
    check(
      'holds_paying_has_deadline',
      sql`${table.status} <> 'paying' OR ${table.payingUntil} IS NOT NULL`,
    ),
    check(
      'holds_paying_until_not_before_expiry',
      sql`${table.payingUntil} IS NULL OR ${table.payingUntil} >= ${table.expiresAt}`,
    ),
    check(
      'holds_expiry_window',
      sql`${table.expiresAt} > ${table.createdAt} AND ${table.expiresAt} <= ${table.createdAt} + make_interval(mins => ${sql.raw(String(holdLimits.maxHoldMinutes))})`,
    ),
    check(
      'holds_updated_not_before_created',
      sql`${table.updatedAt} >= ${table.createdAt}`,
    ),
    check('holds_expires_at_in_range', isReadableDate(table.expiresAt)),
    check('holds_paying_until_in_range', isReadableDate(table.payingUntil)),
    check('holds_created_at_in_range', isReadableDate(table.createdAt)),
    check('holds_updated_at_in_range', isReadableDate(table.updatedAt)),
  ],
);

/** One price line of a hold. The unit price and `uses_space` are snapshots, so the hold keeps what the guest was shown. */
export const holdItems = pgTable(
  'hold_items',
  {
    holdId: uuid()
      .notNull()
      .references(() => holds.id, { onDelete: 'restrict' }),
    priceOptionId: uuid()
      .notNull()
      .references(() => priceOptions.id, { onDelete: 'restrict' }),
    quantity: integer().notNull(),
    unitPriceMinor: integer().notNull(),
    usesSpace: boolean().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.holdId, table.priceOptionId] }),
    check(
      'hold_items_quantity_in_range',
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(holdLimits.maxSeats))}`,
    ),
    check(
      'hold_items_unit_price_in_range',
      sql`${table.unitPriceMinor} BETWEEN 0 AND ${sql.raw(String(MAX_UNIT_PRICE_MINOR))}`,
    ),
  ],
);
