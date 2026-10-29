import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { editorialLimits } from '@/lib/editorial';
import { acceptanceSubjectKinds, legalDocPattern } from '@/lib/legal';
import type { RichTextDoc } from '@/lib/richText/format';
import { giftExpiryActions, settingsBounds } from '@/lib/settings';
import {
  isReadableDate,
  isRichTextDoc,
  notBlank,
  publishedMatchesTime,
  publishStatusEnum,
  requiredText,
} from './shared';

export const acceptanceSubjectKindEnum = pgEnum(
  'acceptance_subject_kind',
  acceptanceSubjectKinds,
);
export const giftExpiryActionEnum = pgEnum(
  'gift_expiry_action',
  giftExpiryActions,
);

const timestampTz = () => timestamp({ withTimezone: true });

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
    check('cancellation_tiers_key_not_blank', notBlank(table.key)),
    check('cancellation_tiers_name_not_blank', notBlank(table.name)),
    check(
      'cancellation_tiers_hours_not_negative',
      sql`${table.fullRefundHoursBefore} >= 0`,
    ),
    uniqueIndex('cancellation_tiers_one_default')
      .on(table.isDefault)
      .where(sql`${table.isDefault}`),
  ],
);

/**
 * One row per version of a document. A published version never changes (a trigger refuses it), so
 * the text a guest accepted is the text on file; a change is a new version. The highest published
 * version of a `doc` is the current one.
 */
export const legalDocuments = pgTable(
  'legal_documents',
  {
    id: uuid().primaryKey().defaultRandom(),
    doc: text().notNull(),
    version: integer().notNull(),
    title: text().notNull(),
    body: jsonb().$type<RichTextDoc>().notNull(),
    status: publishStatusEnum().notNull().default('draft'),
    publishedAt: timestampTz(),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legal_documents_doc_version_unique').on(
      table.doc,
      table.version,
    ),
    check(
      'legal_documents_doc_key',
      sql`${table.doc} ~ ${sql.raw(`'${legalDocPattern}'`)} AND char_length(${table.doc}) <= ${sql.raw(String(editorialLimits.slug))}`,
    ),
    check('legal_documents_version_positive', sql`${table.version} >= 1`),
    check(
      'legal_documents_title',
      requiredText(table.title, editorialLimits.title),
    ),
    check('legal_documents_body_is_rich_text', isRichTextDoc(table.body)),
    check(
      'legal_documents_published_at_matches_status',
      publishedMatchesTime(table.status, table.publishedAt),
    ),
    check(
      'legal_documents_dates_in_range',
      sql`${isReadableDate(table.createdAt)}
        AND (${table.publishedAt} IS NULL OR (${isReadableDate(table.publishedAt)}))`,
    ),
  ],
);

/**
 * Who accepted which version, at checkout (an order) or at onboarding (a host). Insert-only, and
 * only a published version can be accepted (triggers). `subject_id` has no foreign key because it
 * points at one of two tables, as `slug_history.entity_id` does.
 */
export const legalAcceptances = pgTable(
  'legal_acceptances',
  {
    id: uuid().primaryKey().defaultRandom(),
    legalDocumentId: uuid()
      .notNull()
      .references(() => legalDocuments.id, { onDelete: 'restrict' }),
    subjectKind: acceptanceSubjectKindEnum().notNull(),
    subjectId: uuid().notNull(),
    acceptedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('legal_acceptances_once_per_subject').on(
      table.subjectKind,
      table.subjectId,
      table.legalDocumentId,
    ),
    check(
      'legal_acceptances_accepted_at_in_range',
      isReadableDate(table.acceptedAt),
    ),
  ],
);

/**
 * Ops switches and the numbers the hold and payment paths read. A single row: the primary key is
 * the constant `true`, so a second row cannot exist. The migration inserts the row.
 */
export const settings = pgTable(
  'settings',
  {
    id: boolean().primaryKey().default(true),
    bannerText: text(),
    bookingsPaused: boolean().notNull().default(false),
    giftsEnabled: boolean().notNull().default(true),
    checkoutMaintenance: boolean().notNull().default(false),
    holdMinutes: integer().notNull().default(10),
    paymentGraceMinutes: integer().notNull().default(5),
    giftValidityMonths: integer().notNull().default(12),
    giftExpiryAction: giftExpiryActionEnum().notNull().default('refund_buyer'),
    // NYC combined sales tax, 8.875 percent, pending Q-12.
    taxRatePpm: integer().notNull().default(88_750),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check('settings_single_row', sql`${table.id}`),
    check(
      'settings_banner_text',
      sql`${table.bannerText} IS NULL OR (${notBlank(table.bannerText)} AND char_length(${table.bannerText}) <= ${sql.raw(String(settingsBounds.bannerChars))})`,
    ),
    check(
      'settings_hold_minutes',
      sql`${table.holdMinutes} BETWEEN ${sql.raw(String(settingsBounds.holdMinutes.min))} AND ${sql.raw(String(settingsBounds.holdMinutes.max))}`,
    ),
    check(
      'settings_payment_grace_minutes',
      sql`${table.paymentGraceMinutes} BETWEEN ${sql.raw(String(settingsBounds.paymentGraceMinutes.min))} AND ${sql.raw(String(settingsBounds.paymentGraceMinutes.max))}`,
    ),
    check(
      'settings_gift_validity_months',
      sql`${table.giftValidityMonths} BETWEEN ${sql.raw(String(settingsBounds.giftValidityMonths.min))} AND ${sql.raw(String(settingsBounds.giftValidityMonths.max))}`,
    ),
    check(
      'settings_tax_rate_ppm',
      sql`${table.taxRatePpm} BETWEEN ${sql.raw(String(settingsBounds.taxRatePpm.min))} AND ${sql.raw(String(settingsBounds.taxRatePpm.max))}`,
    ),
    check('settings_updated_at_in_range', isReadableDate(table.updatedAt)),
  ],
);
