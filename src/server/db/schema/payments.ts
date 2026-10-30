import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  char,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { orderCurrency, orderLimits } from '@/lib/orders';
import {
  attemptStatuses,
  failureCodePattern,
  fakeGatewayLimits,
  maxFailedTries,
  paymentLimits,
  paymentMethods,
  paymentProviders,
  providerCurrencyPattern,
  providerEventTypes,
  terminalAttemptStatuses,
} from '@/lib/payments';
import { refundReasons, refundStatuses } from '@/lib/refunds';
import { amountSetStatuses, transferStatuses } from '@/lib/transfers';
import { hosts } from './catalog';
import { orders } from './orders';
import { isReadableDate, optionalText, requiredText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.
// Each CHECK repeats a rule in src/lib/payments.ts, refunds.ts, or transfers.ts, so a row the Zod
// schemas refuse cannot be written another way.

export const paymentProviderEnum = pgEnum('payment_provider', paymentProviders);
export const paymentMethodEnum = pgEnum('payment_method', paymentMethods);
export const attemptStatusEnum = pgEnum('attempt_status', attemptStatuses);
export const providerEventTypeEnum = pgEnum(
  'provider_event_type',
  providerEventTypes,
);
export const refundReasonEnum = pgEnum('refund_reason', refundReasons);
export const refundStatusEnum = pgEnum('refund_status', refundStatuses);
export const transferStatusEnum = pgEnum('transfer_status', transferStatuses);

const timestampTz = () => timestamp({ withTimezone: true });

const maxMinor = sql.raw(String(orderLimits.maxMinor));
const providerId = (column: AnyPgColumn) =>
  requiredText(column, paymentLimits.providerId);
const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * A try to collect the amount due on an order. An order has at most one that is not `succeeded` or
 * `canceled` (design doc 4.2.3 rule 4), and a new one only after the previous is canceled.
 */
export const paymentAttempts = pgTable(
  'payment_attempts',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    attemptNo: integer().notNull(),
    provider: paymentProviderEnum().notNull(),
    providerKey: text().notNull(),
    providerPaymentId: text(),
    amountMinor: integer().notNull(),
    currency: char({ length: 3 }).notNull().default(orderCurrency),
    failedTries: integer().notNull().default(0),
    method: paymentMethodEnum(),
    status: attemptStatusEnum().notNull().default('created'),
    failureCode: text(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    unique('payment_attempts_order_attempt_no_unique').on(
      table.orderId,
      table.attemptNo,
    ),
    uniqueIndex('payment_attempts_one_live_per_order')
      .on(table.orderId)
      .where(sql`${table.status} NOT IN (${sqlList(terminalAttemptStatuses)})`),
    uniqueIndex('payment_attempts_provider_key_unique').on(table.providerKey),
    uniqueIndex('payment_attempts_provider_payment_id_unique').on(
      table.providerPaymentId,
    ),
    check(
      'payment_attempts_attempt_no_in_range',
      sql`${table.attemptNo} BETWEEN 1 AND ${sql.raw(String(paymentLimits.maxAttemptNo))}`,
    ),
    check(
      'payment_attempts_provider_key_from_order',
      sql`${table.providerKey} = 'pay:' || ${table.orderId}::text || ':' || ${table.attemptNo}::text`,
    ),
    check(
      'payment_attempts_provider_payment_id_text',
      sql`${table.providerPaymentId} IS NULL OR (${providerId(table.providerPaymentId)})`,
    ),
    check(
      'payment_attempts_amount_in_range',
      sql`${table.amountMinor} BETWEEN 0 AND ${maxMinor}`,
    ),
    check(
      'payment_attempts_currency_usd',
      sql`${table.currency} = ${sql.raw(`'${orderCurrency}'`)}`,
    ),
    check(
      'payment_attempts_failed_tries_in_range',
      sql`${table.failedTries} BETWEEN 0 AND ${sql.raw(String(maxFailedTries))}`,
    ),
    check(
      'payment_attempts_failed_try_counted',
      sql`${table.status} <> 'failed_try' OR ${table.failedTries} >= 1`,
    ),
    check(
      'payment_attempts_failure_code_shape',
      sql`${table.failureCode} IS NULL OR (${table.failedTries} >= 1
        AND char_length(${table.failureCode}) <= ${sql.raw(String(paymentLimits.failureCode))}
        AND ${table.failureCode} ~ ${sql.raw(`'${failureCodePattern}'`)})`,
    ),
    check(
      'payment_attempts_created_at_in_range',
      isReadableDate(table.createdAt),
    ),
    check(
      'payment_attempts_updated_at_in_range',
      sql`${isReadableDate(table.updatedAt)} AND ${table.updatedAt} >= ${table.createdAt}`,
    ),
  ],
);

/**
 * What a provider told us, kept as it arrived (trimmed) before anything acts on it. A repeat is a
 * no-op through the unique key. `ramble_order_id` and `ramble_record_id` come from the provider
 * object's metadata and name records that may not exist, so they carry no foreign key.
 */
export const providerEvents = pgTable(
  'provider_events',
  {
    id: uuid().primaryKey().defaultRandom(),
    provider: paymentProviderEnum().notNull(),
    providerEventId: text().notNull(),
    type: providerEventTypeEnum().notNull(),
    objectId: text().notNull(),
    rambleOrderId: uuid(),
    rambleRecordId: uuid(),
    amountMinor: integer(),
    currency: char({ length: 3 }),
    occurredAt: timestampTz().notNull(),
    receivedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    processedAt: timestampTz(),
    attempts: integer().notNull().default(0),
    lastError: text(),
    payload: jsonb().notNull(),
  },
  (table) => [
    unique('provider_events_provider_event_id_unique').on(
      table.provider,
      table.providerEventId,
    ),
    index('provider_events_unprocessed_idx')
      .on(table.receivedAt)
      .where(sql`${table.processedAt} IS NULL`),
    check('provider_events_event_id_text', providerId(table.providerEventId)),
    check('provider_events_object_id_text', providerId(table.objectId)),
    check(
      'provider_events_amount_in_range',
      sql`${table.amountMinor} IS NULL OR ${table.amountMinor} BETWEEN 0 AND ${maxMinor}`,
    ),
    check(
      'provider_events_amount_and_currency_together',
      sql`(${table.amountMinor} IS NULL) = (${table.currency} IS NULL)`,
    ),
    check(
      'provider_events_currency_shape',
      sql`${table.currency} IS NULL OR ${table.currency} ~ ${sql.raw(`'${providerCurrencyPattern}'`)}`,
    ),
    check(
      'provider_events_attempts_in_range',
      sql`${table.attempts} BETWEEN 0 AND ${sql.raw(String(paymentLimits.maxEventAttempts))}`,
    ),
    check(
      'provider_events_last_error_text',
      optionalText(table.lastError, paymentLimits.lastError),
    ),
    check(
      'provider_events_payload_object',
      sql`jsonb_typeof(${table.payload}) = 'object'
        AND octet_length(${table.payload}::text) <= ${sql.raw(String(paymentLimits.payloadStoredBytes))}`,
    ),
    check(
      'provider_events_occurred_at_in_range',
      isReadableDate(table.occurredAt),
    ),
    check(
      'provider_events_received_at_in_range',
      isReadableDate(table.receivedAt),
    ),
    check(
      'provider_events_processed_at_in_range',
      sql`${table.processedAt} IS NULL OR (${isReadableDate(table.processedAt)} AND ${table.processedAt} >= ${table.receivedAt})`,
    ),
  ],
);

/**
 * The fake payment gateway's objects and events, kept whole as one jsonb document so every server
 * instance sees the same payments (the fake stands in for an outside provider and may not forget a
 * payment because a process was recycled). One row: the key is the constant `fake`. The document is
 * capped in size here, and in object and event counts by the gateway. It holds Ramble ids, amounts, and
 * fake client secrets, no personal data.
 */
export const fakeGatewayState = pgTable(
  'fake_gateway_state',
  {
    key: text().primaryKey().default('fake'),
    state: jsonb().notNull(),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check('fake_gateway_state_single_row', sql`${table.key} = 'fake'`),
    check(
      'fake_gateway_state_document',
      sql`jsonb_typeof(${table.state}) = 'object'
        AND octet_length(${table.state}::text) <= ${sql.raw(String(fakeGatewayLimits.stateStoredBytes))}`,
    ),
    check(
      'fake_gateway_state_updated_at_in_range',
      isReadableDate(table.updatedAt),
    ),
  ],
);

/** Money sent back to the payment method that paid, or a gift put back (design doc 4.2.3, Refunds). */
export const refunds = pgTable(
  'refunds',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    paymentAttemptId: uuid().references(() => paymentAttempts.id, {
      onDelete: 'restrict',
    }),
    ticketMinor: integer().notNull(),
    taxMinor: integer().notNull(),
    commissionReturnedMinor: integer().notNull(),
    amountMinor: integer().notNull(),
    reason: refundReasonEnum().notNull(),
    // TODO(U-004a): foreign key to the staff users table once an auth unit builds it.
    initiatedBy: uuid(),
    providerKey: text().notNull(),
    providerRefundId: text(),
    status: refundStatusEnum().notNull(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    succeededAt: timestampTz(),
  },
  (table) => [
    index('refunds_order_id_idx').on(table.orderId),
    uniqueIndex('refunds_provider_key_unique').on(table.providerKey),
    uniqueIndex('refunds_provider_refund_id_unique').on(table.providerRefundId),
    check(
      'refunds_parts_in_range',
      sql`${table.ticketMinor} BETWEEN 0 AND ${maxMinor}
        AND ${table.taxMinor} BETWEEN 0 AND ${maxMinor}
        AND ${table.commissionReturnedMinor} BETWEEN 0 AND ${table.ticketMinor}`,
    ),
    check(
      'refunds_amount_is_ticket_plus_tax',
      sql`${table.amountMinor} = ${table.ticketMinor} + ${table.taxMinor} AND ${table.amountMinor} > 0`,
    ),
    check(
      'refunds_provider_key_from_id',
      sql`${table.providerKey} = 'refund:' || ${table.id}::text`,
    ),
    check(
      'refunds_provider_refund_id_text',
      sql`${table.providerRefundId} IS NULL OR (${providerId(table.providerRefundId)})`,
    ),
    check(
      'refunds_reinstated_gift_refunds_no_payment',
      sql`${table.status} <> 'gift_reinstated' OR (${table.paymentAttemptId} IS NULL AND ${table.providerRefundId} IS NULL)`,
    ),
    check(
      'refunds_succeeded_at_matches_status',
      sql`(${table.succeededAt} IS NOT NULL) = (${table.status} = 'succeeded')`,
    ),
    check('refunds_created_at_in_range', isReadableDate(table.createdAt)),
    check(
      'refunds_succeeded_at_in_range',
      sql`${table.succeededAt} IS NULL OR (${isReadableDate(table.succeededAt)} AND ${table.succeededAt} >= ${table.createdAt})`,
    ),
  ],
);

/** The host's share of one booking, released weekly (design doc 4.2.3, Transfers). */
export const transfers = pgTable(
  'transfers',
  {
    id: uuid().primaryKey().defaultRandom(),
    orderId: uuid()
      .notNull()
      .references(() => orders.id, { onDelete: 'restrict' }),
    hostId: uuid()
      .notNull()
      .references(() => hosts.id, { onDelete: 'restrict' }),
    // Null until the weekly job sets it at release.
    amountMinor: integer(),
    releaseAfter: timestampTz().notNull(),
    providerKey: text().notNull(),
    providerTransferId: text(),
    reversedMinor: integer().notNull().default(0),
    status: transferStatusEnum().notNull().default('scheduled'),
  },
  (table) => [
    uniqueIndex('transfers_order_id_unique').on(table.orderId),
    uniqueIndex('transfers_provider_key_unique').on(table.providerKey),
    uniqueIndex('transfers_provider_transfer_id_unique').on(
      table.providerTransferId,
    ),
    index('transfers_host_id_idx').on(table.hostId),
    check(
      'transfers_amount_in_range',
      sql`${table.amountMinor} IS NULL OR ${table.amountMinor} BETWEEN 0 AND ${maxMinor}`,
    ),
    check(
      'transfers_amount_set_at_release',
      sql`(${table.status} = 'scheduled' AND ${table.amountMinor} IS NULL)
        OR (${table.status} IN (${sqlList(amountSetStatuses)}) AND coalesce(${table.amountMinor} >= 1, false))
        OR ${table.status} = 'skipped'`,
    ),
    check(
      'transfers_reversed_within_amount',
      sql`${table.reversedMinor} BETWEEN 0 AND coalesce(${table.amountMinor}, 0)`,
    ),
    check(
      'transfers_provider_key_from_order',
      sql`${table.providerKey} = 'transfer:' || ${table.orderId}::text`,
    ),
    check(
      'transfers_provider_transfer_id_text',
      sql`${table.providerTransferId} IS NULL OR (${providerId(table.providerTransferId)})`,
    ),
    check(
      'transfers_release_after_in_range',
      isReadableDate(table.releaseAfter),
    ),
  ],
);
