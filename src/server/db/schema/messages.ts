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
import {
  emailAddressPattern,
  maxEmailAddressLength,
} from '@/lib/email/address';
import {
  emailAdapterNames,
  idempotencyKeyPattern,
  maxBodyLength,
  maxFailureReasonLength,
  maxProviderMessageIdLength,
  maxSendAttempts,
  maxSubjectLength,
  maxTemplateNameLength,
  messageStatuses,
  subjectPattern,
  suppressionReasons,
  templateNamePattern,
} from '@/lib/email/message';

export const messageStatusEnum = pgEnum('message_status', messageStatuses);
export const emailAdapterEnum = pgEnum('email_adapter', emailAdapterNames);
export const suppressionReasonEnum = pgEnum(
  'suppression_reason',
  suppressionReasons,
);

const timestampTz = () => timestamp({ withTimezone: true });

// The Zod rules in src/lib/email decide what may be sent; each CHECK below repeats one of them so
// a row the send path would refuse cannot be written another way. The patterns are shared strings.
const matches = (column: unknown, pattern: string) =>
  sql`${column} ~ ${sql.raw(`'${pattern}'`)}`;

/** The message log. A row exists for every send, including ones that never left. */
export const messages = pgTable(
  'messages',
  {
    id: uuid().primaryKey().defaultRandom(),
    idempotencyKey: text().notNull().unique(),
    template: text().notNull(),
    recipient: text().notNull(),
    subject: text().notNull(),
    status: messageStatusEnum().notNull(),
    adapter: emailAdapterEnum().notNull(),
    providerMessageId: text(),
    /** Kept only for the fake adapter, whose bodies are the dev mailbox. A real send keeps no body. */
    html: text(),
    textBody: text(),
    attempts: integer().notNull().default(0),
    failureReason: text(),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check(
      'messages_idempotency_key_shape',
      matches(table.idempotencyKey, idempotencyKeyPattern),
    ),
    check(
      'messages_template_shape',
      sql`${matches(table.template, templateNamePattern)} AND char_length(${table.template}) <= ${sql.raw(String(maxTemplateNameLength))}`,
    ),
    check(
      'messages_recipient_shape',
      sql`${matches(table.recipient, emailAddressPattern)} AND char_length(${table.recipient}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
    check(
      'messages_subject_shape',
      sql`${matches(table.subject, subjectPattern)} AND char_length(${table.subject}) <= ${sql.raw(String(maxSubjectLength))}`,
    ),
    check(
      'messages_provider_message_id_length',
      sql`${table.providerMessageId} IS NULL OR char_length(${table.providerMessageId}) BETWEEN 1 AND ${sql.raw(String(maxProviderMessageIdLength))}`,
    ),
    // A message that reached a provider has its ID; one that did not has none.
    check(
      'messages_provider_message_id_follows_status',
      sql`(${table.status} IN ('queued', 'failed', 'suppressed')) = (${table.providerMessageId} IS NULL)`,
    ),
    check(
      'messages_body_only_for_fake_adapter',
      sql`${table.adapter} = 'fake' OR (${table.html} IS NULL AND ${table.textBody} IS NULL)`,
    ),
    check(
      'messages_body_is_both_or_neither',
      sql`(${table.html} IS NULL) = (${table.textBody} IS NULL)`,
    ),
    check(
      'messages_body_length',
      sql`(${table.html} IS NULL OR char_length(${table.html}) BETWEEN 1 AND ${sql.raw(String(maxBodyLength))}) AND (${table.textBody} IS NULL OR char_length(${table.textBody}) BETWEEN 1 AND ${sql.raw(String(maxBodyLength))})`,
    ),
    check(
      'messages_attempts_capped',
      sql`${table.attempts} BETWEEN 0 AND ${sql.raw(String(maxSendAttempts))}`,
    ),
    check(
      'messages_failure_reason_iff_failed',
      sql`(${table.status} = 'failed') = (${table.failureReason} IS NOT NULL) AND (${table.failureReason} IS NULL OR char_length(${table.failureReason}) BETWEEN 1 AND ${sql.raw(String(maxFailureReasonLength))})`,
    ),
    // The read schema takes a Date; Postgres also stores 'infinity' and years past 9999, which are not one.
    check(
      'messages_created_at_in_range',
      sql`${table.createdAt} >= '1000-01-01 00:00:00+00' AND ${table.createdAt} < '10000-01-01 00:00:00+00'`,
    ),
    uniqueIndex('messages_provider_message_id_unique')
      .on(table.adapter, table.providerMessageId)
      .where(sql`${table.providerMessageId} IS NOT NULL`),
    index('messages_created_at_idx').on(
      table.createdAt.desc(),
      table.id.desc(),
    ),
  ],
);

/** An address a hard bounce or a spam complaint closed. Sends to it are logged and not made. */
export const emailSuppressions = pgTable(
  'email_suppressions',
  {
    address: text().primaryKey(),
    reason: suppressionReasonEnum().notNull(),
    sourceMessageId: uuid().references(() => messages.id, {
      onDelete: 'set null',
    }),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check(
      'email_suppressions_address_shape',
      sql`${matches(table.address, emailAddressPattern)} AND char_length(${table.address}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
  ],
);
