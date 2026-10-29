import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  char,
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
import { ledgerAccounts, ledgerEntryTypes, ledgerLimits } from '@/lib/ledger';
import { orderCurrency, orderLimits } from '@/lib/orders';
import { paymentLimits } from '@/lib/payments';
import { hosts } from './catalog';
import { orders } from './orders';
import { paymentAttempts, refunds, transfers } from './payments';
import { isReadableDate, optionalText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.
// Each CHECK repeats a rule in src/lib/ledger.ts, so a row the Zod schema refuses cannot be written
// another way. The trigger that keeps the table append-only is in the `ledger_guards` migration.

export const ledgerAccountEnum = pgEnum('ledger_account', ledgerAccounts);
export const ledgerEntryTypeEnum = pgEnum(
  'ledger_entry_type',
  ledgerEntryTypes,
);

const timestampTz = () => timestamp({ withTimezone: true });

/**
 * One movement of money from a debit account to a credit account (design doc 4.2.3, Ledger).
 * `recorded_at` is when Ramble wrote the row, taken after any lock; `occurred_at` is provider time
 * and can arrive out of order. `gift_id`, `dispute_id`, and `created_by` are uuid columns with no
 * foreign key yet: the tables they point to are built by units that depend on this one.
 */
export const ledgerEntries = pgTable(
  'ledger_entries',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    occurredAt: timestampTz().notNull(),
    recordedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    entryType: ledgerEntryTypeEnum().notNull(),
    debitAccount: ledgerAccountEnum().notNull(),
    creditAccount: ledgerAccountEnum().notNull(),
    amountMinor: integer().notNull(),
    currency: char({ length: 3 }).notNull().default(orderCurrency),
    orderId: uuid().references(() => orders.id, { onDelete: 'restrict' }),
    // TODO(U-017): foreign key to gifts.
    giftId: uuid(),
    hostId: uuid().references(() => hosts.id, { onDelete: 'restrict' }),
    paymentAttemptId: uuid().references(() => paymentAttempts.id, {
      onDelete: 'restrict',
    }),
    refundId: uuid().references(() => refunds.id, { onDelete: 'restrict' }),
    transferId: uuid().references(() => transfers.id, {
      onDelete: 'restrict',
    }),
    // TODO(U-081): foreign key to disputes.
    disputeId: uuid(),
    providerObjectId: text(),
    simulated: boolean().notNull(),
    // TODO(U-004a): foreign key to the staff users table once an auth unit builds it.
    createdBy: uuid(),
    memo: text(),
  },
  (table) => [
    uniqueIndex('ledger_entries_cash_event_unique')
      .on(table.entryType, table.providerObjectId)
      .where(sql`${table.providerObjectId} IS NOT NULL`),
    index('ledger_entries_host_occurred_idx').on(
      table.hostId,
      table.occurredAt,
    ),
    index('ledger_entries_order_id_idx').on(table.orderId),
    check(
      'ledger_entries_accounts_differ',
      sql`${table.debitAccount} <> ${table.creditAccount}`,
    ),
    check(
      'ledger_entries_amount_in_range',
      sql`${table.amountMinor} BETWEEN 1 AND ${sql.raw(String(orderLimits.maxMinor))}`,
    ),
    check(
      'ledger_entries_currency_usd',
      sql`${table.currency} = ${sql.raw(`'${orderCurrency}'`)}`,
    ),
    check(
      'ledger_entries_names_a_subject',
      sql`num_nonnulls(${table.orderId}, ${table.giftId}, ${table.hostId}) >= 1 OR ${table.entryType} = 'ramble_payout'`,
    ),
    check(
      'ledger_entries_provider_id_on_cash',
      sql`(${table.providerObjectId} IS NOT NULL) = (${table.debitAccount} = 'platform_cash' OR ${table.creditAccount} = 'platform_cash')`,
    ),
    check(
      'ledger_entries_provider_id_text',
      optionalText(table.providerObjectId, paymentLimits.providerId),
    ),
    check(
      'ledger_entries_memo_text',
      optionalText(table.memo, ledgerLimits.memo),
    ),
    check(
      'ledger_entries_occurred_at_in_range',
      isReadableDate(table.occurredAt),
    ),
    check(
      'ledger_entries_recorded_at_in_range',
      isReadableDate(table.recordedAt),
    ),
  ],
);
