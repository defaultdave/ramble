import { sql } from 'drizzle-orm';
import {
  boolean,
  char,
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
import {
  idempotencyKeyUuidPattern,
  orderCancelledBys,
  orderCurrency,
  orderKinds,
  orderLimits,
  orderReferencePattern,
  orderStatuses,
} from '@/lib/orders';
import { MAX_QUANTITY, MAX_UNIT_PRICE_MINOR, PPM } from '@/lib/pricing';
import {
  experiences,
  hosts,
  priceOptions,
  sessions,
  taxTreatmentEnum,
} from './catalog';
import { holds } from './holds';
import { cancellationTiers, legalDocuments } from './policies';
import { guests } from './people';
import { isReadableDate, optionalText, requiredText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.
// Each CHECK repeats a rule in src/lib/orders.ts, so a row the Zod schema refuses cannot be written another way.

export const orderKindEnum = pgEnum('order_kind', orderKinds);
export const orderStatusEnum = pgEnum('order_status', orderStatuses);
export const orderCancelledByEnum = pgEnum(
  'order_cancelled_by',
  orderCancelledBys,
);

const timestampTz = () => timestamp({ withTimezone: true });

const maxMinor = sql.raw(String(orderLimits.maxMinor));
const maxSubtotal = sql.raw(String(orderLimits.maxSubtotalMinor));
const childAges = sql.raw(
  Array.from({ length: orderLimits.maxChildAge + 1 }, (_, age) =>
    String(age),
  ).join(', '),
);

/**
 * One order per booking or gift purchase (design doc 4.2.3, Orders). Time columns that order
 * records come from `clock_timestamp()`. `gift_id` is a uuid column with no foreign key yet: the
 * gifts table is built by a unit that depends on this one.
 */
export const orders = pgTable(
  'orders',
  {
    id: uuid().primaryKey().defaultRandom(),
    reference: text().notNull(),
    kind: orderKindEnum().notNull(),
    status: orderStatusEnum().notNull(),
    idempotencyKey: text().notNull(),
    holdId: uuid().references(() => holds.id, { onDelete: 'restrict' }),
    sessionId: uuid().references(() => sessions.id, { onDelete: 'restrict' }),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    hostId: uuid()
      .notNull()
      .references(() => hosts.id, { onDelete: 'restrict' }),
    // TODO(U-017): foreign key to gifts.
    giftId: uuid(),
    guestId: uuid()
      .notNull()
      .references(() => guests.id, { onDelete: 'restrict' }),
    contactEmail: text().notNull(),
    contactPhone: text(),
    leadGuestName: text(),
    ageConfirmed: boolean(),
    childrenAges: integer().array(),
    guardianName: text(),
    guardianContact: text(),
    waiverDocumentId: uuid().references(() => legalDocuments.id, {
      onDelete: 'restrict',
    }),
    termsDocumentId: uuid()
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    currency: char({ length: 3 }).notNull().default(orderCurrency),
    ticketSubtotalMinor: integer().notNull(),
    taxTreatment: taxTreatmentEnum().notNull(),
    taxRatePpm: integer().notNull(),
    taxMinor: integer().notNull(),
    totalMinor: integer().notNull(),
    giftAppliedMinor: integer().notNull().default(0),
    amountDueMinor: integer().notNull(),
    commissionRateBps: integer().notNull(),
    commissionMinor: integer().notNull(),
    refundedTicketMinor: integer().notNull().default(0),
    refundedTaxMinor: integer().notNull().default(0),
    commissionReturnedMinor: integer().notNull().default(0),
    refundFailed: boolean().notNull().default(false),
    cancellationTierId: uuid()
      .notNull()
      .references(() => cancellationTiers.id, { onDelete: 'restrict' }),
    freeCancelUntil: timestampTz(),
    cancelledBy: orderCancelledByEnum(),
    attributionSource: text(),
    attributionCampaign: text(),
    attributionIssue: text(),
    manageTokenHash: text(),
    manageTokenVersion: integer().notNull().default(1),
    // Set by U-114 on the orders it makes for the demo.
    synthetic: boolean().notNull().default(false),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    confirmedAt: timestampTz(),
    cancelledAt: timestampTz(),
  },
  (table) => [
    uniqueIndex('orders_reference_unique').on(table.reference),
    uniqueIndex('orders_idempotency_key_unique').on(table.idempotencyKey),
    // One live order per hold; a `void` order frees the hold.
    uniqueIndex('orders_one_live_per_hold')
      .on(table.holdId)
      .where(sql`${table.status} <> 'void'`),
    uniqueIndex('orders_manage_token_hash_unique').on(table.manageTokenHash),
    index('orders_guest_id_idx').on(table.guestId),
    index('orders_session_id_idx').on(table.sessionId),
    index('orders_host_id_idx').on(table.hostId),
    check(
      'orders_reference_shape',
      sql`${table.reference} ~ ${sql.raw(`'${orderReferencePattern}'`)}`,
    ),
    // A booking's key comes from its hold; a gift purchase's is a uuid made once per checkout.
    check(
      'orders_kind_shape',
      sql`(${table.kind} = 'booking'
        AND ${table.holdId} IS NOT NULL
        AND ${table.sessionId} IS NOT NULL
        AND ${table.leadGuestName} IS NOT NULL
        AND ${table.idempotencyKey} = 'book:' || ${table.holdId}::text)
        OR (${table.kind} = 'gift_purchase'
        AND ${table.holdId} IS NULL
        AND ${table.sessionId} IS NULL
        AND ${table.giftAppliedMinor} = 0
        AND ${table.idempotencyKey} ~ ${sql.raw(`'${idempotencyKeyUuidPattern}'`)})`,
    ),
    check(
      'orders_contact_email_shape',
      sql`${table.contactEmail} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND char_length(${table.contactEmail}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
    check(
      'orders_contact_phone_text',
      optionalText(table.contactPhone, orderLimits.contactPhone),
    ),
    check(
      'orders_lead_guest_name_text',
      sql`${table.leadGuestName} IS NULL OR (${requiredText(table.leadGuestName, orderLimits.leadGuestName)})`,
    ),
    check(
      'orders_children_ages_valid',
      sql`${table.childrenAges} IS NULL OR (
        array_ndims(${table.childrenAges}) = 1
        AND cardinality(${table.childrenAges}) BETWEEN 1 AND ${sql.raw(String(orderLimits.maxChildren))}
        AND ${table.childrenAges} <@ ARRAY[${childAges}]::integer[])`,
    ),
    check(
      'orders_guardian_text',
      sql`(${optionalText(table.guardianName, orderLimits.guardianName)})
        AND (${optionalText(table.guardianContact, orderLimits.guardianContact)})`,
    ),
    check(
      'orders_guardian_complete',
      sql`(${table.guardianName} IS NULL) = (${table.guardianContact} IS NULL)
        AND (${table.childrenAges} IS NULL OR ${table.guardianName} IS NOT NULL)`,
    ),
    check(
      'orders_currency_usd',
      sql`${table.currency} = ${sql.raw(`'${orderCurrency}'`)}`,
    ),
    check(
      'orders_ticket_subtotal_in_range',
      sql`${table.ticketSubtotalMinor} BETWEEN 0 AND ${maxSubtotal}`,
    ),
    check(
      'orders_tax_rate_in_range',
      sql`${table.taxRatePpm} BETWEEN 0 AND ${sql.raw(String(PPM))}`,
    ),
    check(
      'orders_tax_rate_zero_unless_taxable',
      sql`${table.taxTreatment} = 'taxable' OR ${table.taxRatePpm} = 0`,
    ),
    check(
      'orders_tax_is_rounded_rate',
      sql`${table.taxMinor} = (${table.ticketSubtotalMinor}::bigint * ${table.taxRatePpm}::bigint + 500000) / 1000000`,
    ),
    check(
      'orders_total_is_subtotal_plus_tax',
      sql`${table.totalMinor} = ${table.ticketSubtotalMinor} + ${table.taxMinor}`,
    ),
    check(
      'orders_gift_applied_within_total',
      sql`${table.giftAppliedMinor} BETWEEN 0 AND ${table.totalMinor}`,
    ),
    check(
      'orders_gift_applied_names_gift',
      sql`${table.giftAppliedMinor} = 0 OR ${table.giftId} IS NOT NULL`,
    ),
    check(
      'orders_amount_due_is_total_less_gift',
      sql`${table.amountDueMinor} = ${table.totalMinor} - ${table.giftAppliedMinor}`,
    ),
    check(
      'orders_commission_rate_in_range',
      sql`${table.commissionRateBps} BETWEEN 0 AND ${sql.raw(String(orderLimits.maxBps))}`,
    ),
    check(
      'orders_commission_is_rounded_rate',
      sql`${table.commissionMinor} = (${table.ticketSubtotalMinor}::bigint * ${table.commissionRateBps}::bigint * 100 + 500000) / 1000000`,
    ),
    check(
      'orders_refunded_ticket_within_subtotal',
      sql`${table.refundedTicketMinor} BETWEEN 0 AND ${table.ticketSubtotalMinor}`,
    ),
    check(
      'orders_refunded_tax_within_tax',
      sql`${table.refundedTaxMinor} BETWEEN 0 AND ${table.taxMinor}`,
    ),
    check(
      'orders_commission_returned_within_commission',
      sql`${table.commissionReturnedMinor} BETWEEN 0 AND ${table.commissionMinor}`,
    ),
    check(
      'orders_money_in_range',
      sql`${table.taxMinor} BETWEEN 0 AND ${maxMinor}
        AND ${table.totalMinor} <= ${maxMinor}
        AND ${table.commissionMinor} <= ${maxMinor}`,
    ),
    check(
      'orders_attribution_text',
      sql`(${optionalText(table.attributionSource, orderLimits.attribution)})
        AND (${optionalText(table.attributionCampaign, orderLimits.attribution)})
        AND (${optionalText(table.attributionIssue, orderLimits.attribution)})`,
    ),
    check(
      'orders_manage_token_hash_shape',
      sql`${table.manageTokenHash} IS NULL OR ${table.manageTokenHash} ~ ${sql.raw(`'${tokenHashPattern}'`)}`,
    ),
    check(
      'orders_manage_token_version_positive',
      sql`${table.manageTokenVersion} >= 1`,
    ),
    check(
      'orders_confirmed_at_matches_status',
      sql`(${table.confirmedAt} IS NOT NULL) = (${table.status} IN ('confirmed', 'cancelled'))`,
    ),
    check(
      'orders_cancelled_matches_status',
      sql`(${table.cancelledAt} IS NOT NULL) = (${table.status} = 'cancelled')
        AND (${table.cancelledBy} IS NOT NULL) = (${table.status} = 'cancelled')`,
    ),
    check('orders_created_at_in_range', isReadableDate(table.createdAt)),
    check(
      'orders_confirmed_at_in_range',
      sql`${table.confirmedAt} IS NULL OR (${isReadableDate(table.confirmedAt)} AND ${table.confirmedAt} >= ${table.createdAt})`,
    ),
    check(
      'orders_cancelled_at_in_range',
      sql`${table.cancelledAt} IS NULL OR (${isReadableDate(table.cancelledAt)} AND ${table.cancelledAt} >= ${table.confirmedAt})`,
    ),
    check(
      'orders_free_cancel_until_in_range',
      sql`${table.freeCancelUntil} IS NULL OR ${isReadableDate(table.freeCancelUntil)}`,
    ),
  ],
);

/** What an order was sold: one row per price option, as it was priced at the time. */
export const orderItems = pgTable(
  'order_items',
  {
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    priceOptionId: uuid()
      .notNull()
      .references(() => priceOptions.id, { onDelete: 'restrict' }),
    label: text().notNull(),
    quantity: integer().notNull(),
    unitPriceMinor: integer().notNull(),
    usesSpace: boolean().notNull(),
    lineTotalMinor: integer().notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.orderId, table.priceOptionId] }),
    check(
      'order_items_label_text',
      requiredText(table.label, orderLimits.itemLabel),
    ),
    check(
      'order_items_quantity_in_range',
      sql`${table.quantity} BETWEEN 1 AND ${sql.raw(String(MAX_QUANTITY))}`,
    ),
    check(
      'order_items_unit_price_in_range',
      sql`${table.unitPriceMinor} BETWEEN 0 AND ${sql.raw(String(MAX_UNIT_PRICE_MINOR))}`,
    ),
    check(
      'order_items_line_total_is_quantity_times_price',
      sql`${table.lineTotalMinor} = ${table.quantity} * ${table.unitPriceMinor}`,
    ),
  ],
);
