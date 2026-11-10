import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { tokenHashPattern } from '@/lib/capabilityTokens';
import {
  emailAddressPattern,
  maxEmailAddressLength,
} from '@/lib/email/address';
import { giftLimits } from '@/lib/giftInDate';
import { orderLimits } from '@/lib/orders';
import { MAX_QUANTITY, MAX_UNIT_PRICE_MINOR, PPM } from '@/lib/pricing';
import { giftStatuses } from '@/lib/transitions';
import { experiences, priceOptions } from './catalog';
import { guests } from './people';
import { orders } from './orders';
import { isReadableDate, optionalText, requiredText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.

export const giftStatusEnum = pgEnum('gift_status', giftStatuses);

const timestampTz = () => timestamp({ withTimezone: true });

/**
 * One gift of a specific experience, bought by one order (design doc 4.2.3, Gifts). The redemption
 * token is derived, not random: only its hash is stored, and `token_version` voids earlier links.
 * `orders.gift_id` points back here, so a purchase inserts its order first, then the gift, then
 * sets the order's `gift_id`.
 */
export const gifts = pgTable(
  'gifts',
  {
    id: uuid().primaryKey().defaultRandom(),
    purchaseOrderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    valueMinor: integer().notNull(),
    buyerGuestId: uuid()
      .notNull()
      .references(() => guests.id, { onDelete: 'restrict' }),
    recipientName: text().notNull(),
    recipientEmail: text().notNull(),
    message: text(),
    sendAt: timestampTz().notNull(),
    sentAt: timestampTz(),
    tokenHash: text().notNull(),
    tokenVersion: integer().notNull().default(1),
    status: giftStatusEnum().notNull().default('pending_payment'),
    validUntil: timestampTz().notNull(),
    redeemedOrderId: uuid().references(() => orders.id, {
      onDelete: 'restrict',
    }),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    redeemedAt: timestampTz(),
  },
  (table) => [
    uniqueIndex('gifts_purchase_order_id_unique').on(table.purchaseOrderId),
    uniqueIndex('gifts_token_hash_unique').on(table.tokenHash),
    index('gifts_buyer_guest_id_idx').on(table.buyerGuestId),
    index('gifts_experience_id_idx').on(table.experienceId),
    index('gifts_redeemed_order_id_idx').on(table.redeemedOrderId),
    check(
      'gifts_value_in_range',
      sql`${table.valueMinor} BETWEEN 1 AND ${sql.raw(String(orderLimits.maxMinor))}`,
    ),
    check(
      'gifts_recipient_name_text',
      requiredText(table.recipientName, giftLimits.recipientName),
    ),
    check(
      'gifts_recipient_email_shape',
      sql`${table.recipientEmail} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND char_length(${table.recipientEmail}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
    check(
      'gifts_message_text',
      optionalText(table.message, giftLimits.message),
    ),
    check(
      'gifts_token_hash_shape',
      sql`${table.tokenHash} ~ ${sql.raw(`'${tokenHashPattern}'`)}`,
    ),
    check('gifts_token_version_positive', sql`${table.tokenVersion} >= 1`),
    check('gifts_created_at_in_range', isReadableDate(table.createdAt)),
    check(
      'gifts_send_at_within_horizon',
      sql`${isReadableDate(table.sendAt)} AND ${table.sendAt} <= ${table.createdAt} + make_interval(days => ${sql.raw(String(giftLimits.sendHorizonDays))})`,
    ),
    check(
      'gifts_valid_until_after_send_at',
      sql`${isReadableDate(table.validUntil)} AND ${table.validUntil} > ${table.sendAt}`,
    ),
    check(
      'gifts_sent_at_matches_status',
      sql`(${table.sentAt} IS NOT NULL) = (${table.status} IN ('delivered', 'redeemed'))
        AND (${table.sentAt} IS NULL OR ${isReadableDate(table.sentAt)})`,
    ),
    check(
      'gifts_redeemed_matches_status',
      sql`(${table.redeemedOrderId} IS NOT NULL) = (${table.status} = 'redeemed')
        AND (${table.redeemedAt} IS NOT NULL) = (${table.status} = 'redeemed')`,
    ),
    check(
      'gifts_redeemed_at_in_range',
      sql`${table.redeemedAt} IS NULL OR (${isReadableDate(table.redeemedAt)} AND ${table.redeemedAt} >= ${table.sentAt})`,
    ),
  ],
);

/** The party a gift covers, as each price option was priced at purchase, so later price changes never touch it. */
export const giftItems = pgTable(
  'gift_items',
  {
    giftId: uuid()
      .notNull()
      .references(() => gifts.id, { onDelete: 'restrict' }),
    priceOptionId: uuid()
      .notNull()
      .references(() => priceOptions.id, { onDelete: 'restrict' }),
    label: text().notNull(),
    quantity: integer().notNull(),
    unitPriceMinor: integer().notNull(),
    taxRatePpm: integer().notNull(),
    usesSpace: boolean().notNull(),
    lineTotalMinor: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.giftId, table.priceOptionId] }),
    check(
      'gift_items_label_text',
      requiredText(table.label, orderLimits.itemLabel),
    ),
    check(
      'gift_items_quantity_in_range',
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_QUANTITY))}`,
    ),
    check(
      'gift_items_unit_price_in_range',
      sql`${table.unitPriceMinor} BETWEEN 0 AND ${sql.raw(String(MAX_UNIT_PRICE_MINOR))}`,
    ),
    check(
      'gift_items_tax_rate_in_range',
      sql`${table.taxRatePpm} BETWEEN 0 AND ${sql.raw(String(PPM))}`,
    ),
    check(
      'gift_items_line_total_is_quantity_times_price',
      sql`${table.lineTotalMinor} = ${table.quantity} * ${table.unitPriceMinor}`,
    ),
  ],
);
