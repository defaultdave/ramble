import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  check,
  index,
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
  anonymizedEmailDomain,
  anonymizedEmailPattern,
  consentKinds,
  consentSources,
  consentSourceStatuses,
  consentStatuses,
} from '@/lib/guests';
import { isReadableDate } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.
// Each CHECK repeats a rule in src/lib/guests.ts, so a row the Zod schemas refuse cannot be written another way.

export const consentKindEnum = pgEnum('consent_kind', consentKinds);
export const consentStatusEnum = pgEnum('consent_status', consentStatuses);
export const consentSourceEnum = pgEnum('consent_source', consentSources);

const timestampTz = () => timestamp({ withTimezone: true });

/**
 * One row per email address. Anonymizing a guest rewrites the address to one derived from the row
 * id and stamps `anonymized_at`, so the address is free for a new guest and every row that points
 * here stays whole. Times come from `clock_timestamp()` so they order writes made after a lock.
 */
export const guests = pgTable(
  'guests',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    anonymizedAt: timestampTz(),
  },
  (table) => [
    uniqueIndex('guests_email_unique').on(table.email),
    check(
      'guests_email_shape',
      sql`${table.email} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND char_length(${table.email}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
    // The reserved domain marks erased rows and nothing else.
    check(
      'guests_reserved_domain_iff_anonymized',
      sql`(${table.anonymizedAt} IS NOT NULL) = (${table.email} ~ ${sql.raw(`'${anonymizedEmailPattern}'`)})`,
    ),
    check(
      'guests_anonymized_email_from_id',
      sql`${table.anonymizedAt} IS NULL OR ${table.email} = 'erased-' || ${table.id}::text || ${sql.raw(`'@${anonymizedEmailDomain}'`)}`,
    ),
    check('guests_created_at_in_range', isReadableDate(table.createdAt)),
    check(
      'guests_anonymized_at_in_range',
      sql`${table.anonymizedAt} IS NULL OR (${isReadableDate(table.anonymizedAt)} AND ${table.anonymizedAt} >= ${table.createdAt})`,
    ),
  ],
);

/** One clause per source: the statuses that source may record, from the same table the Zod rule reads. */
function sourceAllowsStatus(source: AnyPgColumn, status: AnyPgColumn) {
  return sql.join(
    consentSources.map((name) => {
      const allowed = consentSourceStatuses[name]
        .map((value) => `'${value}'`)
        .join(', ');
      return sql`(${source} = ${sql.raw(`'${name}'`)} AND ${status} IN (${sql.raw(allowed)}))`;
    }),
    sql` OR `,
  );
}

/**
 * An append-only log of consent changes: one row per grant or withdrawal, with its time and
 * source. The latest row for a guest and kind is the current answer.
 */
export const consents = pgTable(
  'consents',
  {
    id: uuid().primaryKey().defaultRandom(),
    guestId: uuid()
      .notNull()
      .references(() => guests.id, { onDelete: 'restrict' }),
    kind: consentKindEnum().notNull(),
    status: consentStatusEnum().notNull(),
    source: consentSourceEnum().notNull(),
    recordedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    check(
      'consents_source_allows_status',
      sourceAllowsStatus(table.source, table.status),
    ),
    check('consents_recorded_at_in_range', isReadableDate(table.recordedAt)),
    index('consents_guest_kind_recorded_idx').on(
      table.guestId,
      table.kind,
      table.recordedAt.desc(),
      table.id.desc(),
    ),
  ],
);
