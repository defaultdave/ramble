import { sql } from 'drizzle-orm';
import {
  bigint,
  check,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import { auditActorKinds, auditLimits, auditPatterns } from '@/lib/audit';
import { privacyRequestKinds, privacyRequestStatuses } from '@/lib/guests';
import {
  emailAddressPattern,
  maxEmailAddressLength,
} from '@/lib/email/address';
import { rateLimitKeyPattern } from '@/lib/rateLimits';
import { supportLimits, supportTopics } from '@/lib/support';
import { guests } from './people';
import { isReadableDate, maxChars, requiredText } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.

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

// Adding a value is a migration, and Postgres cannot drop one: removing a kind means rebuilding the type.
export const auditActorKindEnum = pgEnum('audit_actor_kind', auditActorKinds);

const nameShape = `^[a-z][a-z0-9_]{0,${String(auditLimits.detailsKeyMaxChars - 1)}}$`;
// jsonpath filters over `details`: each one matches a name, nested value, non-integer, or string that breaks the lib's rule.
// Strict mode, so an array value is judged as an array and not unwrapped into its elements.
const detailsBreakingRules = [
  `strict $.keyvalue() ? (!(@.key like_regex "${nameShape}"))`,
  `strict $.* ? (@.type() == "array" || @.type() == "object")`,
  `strict $.* ? (@.type() == "number" && (@ != @.floor() || @ > 9007199254740991 || @ < -9007199254740991))`,
  `strict $.* ? (@.type() == "string" && !(@ like_regex "${auditPatterns.detailValue}"))`,
];

/**
 * Who did what to which record, and when (PRD-74). A row is written in the same transaction as the
 * change it records and is never changed or removed: the `audit_log_guards` migration adds the
 * trigger and the restricted role. `details` holds ids, codes, and amounts and no free text. Each
 * CHECK repeats a rule in src/lib/audit.ts. A `user` actor names the signed-in user; a guest who
 * acts by capability token is identified by the subject, so no guest id lives in this table.
 */
export const auditLog = pgTable(
  'audit_log',
  {
    id: bigint({ mode: 'number' }).primaryKey().generatedAlwaysAsIdentity(),
    recordedAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
    actorKind: auditActorKindEnum().notNull(),
    // TODO(U-004a): foreign key to the users table once an auth unit builds it.
    actorId: uuid(),
    action: text().notNull(),
    subjectKind: text().notNull(),
    subjectId: uuid().notNull(),
    details: jsonb()
      .notNull()
      .default(sql`'{}'::jsonb`),
  },
  (table) => [
    check(
      'audit_log_actor_matches_kind',
      sql`(${table.actorKind} = 'user') = (${table.actorId} IS NOT NULL)`,
    ),
    check(
      'audit_log_action_shape',
      sql`${table.action} ~ ${sql.raw(`'${auditPatterns.action}'`)} AND ${maxChars(table.action, auditLimits.actionMaxChars)}`,
    ),
    check(
      'audit_log_subject_kind_shape',
      sql`${table.subjectKind} ~ ${sql.raw(`'${auditPatterns.word}'`)} AND ${maxChars(table.subjectKind, auditLimits.subjectKindMaxChars)}`,
    ),
    check(
      'audit_log_details_shape',
      sql`jsonb_typeof(${table.details}) = 'object' AND octet_length(${table.details}::text) <= ${sql.raw(String(auditLimits.detailsStoredMaxBytes))} AND jsonb_array_length(jsonb_path_query_array(${table.details}, 'strict $.*')) <= ${sql.raw(String(auditLimits.detailsMaxKeys))} AND ${sql.join(
        detailsBreakingRules.map(
          (rule) =>
            sql`NOT jsonb_path_exists(${table.details}, ${sql.raw(`'${rule}'`)})`,
        ),
        sql` AND `,
      )}`,
    ),
    check('audit_log_recorded_at_in_range', isReadableDate(table.recordedAt)),
    index('audit_log_recorded_at_idx').on(table.recordedAt),
    index('audit_log_subject_idx').on(table.subjectKind, table.subjectId),
  ],
);

export const supportTopicEnum = pgEnum('support_topic', supportTopics);

/**
 * A guest's message through the contact form. It holds exactly what the form collects and no guest
 * id: the sender may not have an account or a booking. The support queue (a later unit) reads it.
 */
export const supportRequests = pgTable(
  'support_requests',
  {
    id: uuid().primaryKey().defaultRandom(),
    name: text().notNull(),
    email: text().notNull(),
    topic: supportTopicEnum().notNull(),
    message: text().notNull(),
    createdAt: timestamp({ withTimezone: true })
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check(
      'support_requests_name_shape',
      requiredText(table.name, supportLimits.nameMaxChars),
    ),
    check(
      'support_requests_email_shape',
      sql`${table.email} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND ${maxChars(table.email, maxEmailAddressLength)}`,
    ),
    check(
      'support_requests_message_shape',
      requiredText(table.message, supportLimits.messageMaxChars),
    ),
    check(
      'support_requests_created_at_in_range',
      isReadableDate(table.createdAt),
    ),
    index('support_requests_created_at_idx').on(table.createdAt.desc()),
  ],
);
