import { sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  index,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
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
import { grantableRoles, hostScopedRoles } from '@/lib/roleGrants';
import { hosts } from './catalog';
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

// Better Auth's four tables, named for what they hold here. `sessions` already means a bookable time,
// so these carry an `auth_` prefix. Better Auth reads and writes them through its Drizzle adapter, so
// the column names are the ones it expects (`user_id`, `expires_at`, ...), and it refuses to start if
// one is missing. The columns that would hold a browser address, a user agent, a picture, or a
// provider's tokens exist for that reason only: a CHECK keeps each of them empty, so sign-in cannot
// start storing them without a decision.

/** One row per person who has signed in. Guests book without one (PRD-15); signing in is optional for them. */
export const authUsers = pgTable(
  'auth_users',
  {
    id: uuid().primaryKey().defaultRandom(),
    email: text().notNull(),
    name: text().notNull().default(''),
    emailVerified: boolean().notNull().default(false),
    image: text(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    uniqueIndex('auth_users_email_unique').on(table.email),
    check(
      'auth_users_email_shape',
      sql`${table.email} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND char_length(${table.email}) <= ${sql.raw(String(maxEmailAddressLength))}`,
    ),
    check('auth_users_name_length', sql`char_length(${table.name}) <= 200`),
    check('auth_users_image_unused', sql`${table.image} IS NULL`),
    check('auth_users_created_at_in_range', isReadableDate(table.createdAt)),
    check('auth_users_updated_at_in_range', isReadableDate(table.updatedAt)),
  ],
);

/**
 * `token` is the secret in the browser's cookie. `expires_at` is the idle deadline, moved forward by
 * each request until `created_at` plus the session ceiling (src/lib/auth.ts).
 */
export const authSessions = pgTable(
  'auth_sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    token: text().notNull(),
    ipAddress: text(),
    userAgent: text(),
    expiresAt: timestampTz().notNull(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    uniqueIndex('auth_sessions_token_unique').on(table.token),
    index('auth_sessions_user_idx').on(table.userId),
    check(
      'auth_sessions_token_length',
      sql`char_length(${table.token}) BETWEEN 16 AND 256`,
    ),
    check(
      'auth_sessions_client_details_unused',
      sql`${table.ipAddress} IS NULL AND ${table.userAgent} IS NULL`,
    ),
    check('auth_sessions_expires_at_in_range', isReadableDate(table.expiresAt)),
    check('auth_sessions_created_at_in_range', isReadableDate(table.createdAt)),
    check('auth_sessions_updated_at_in_range', isReadableDate(table.updatedAt)),
  ],
);

/** Better Auth keeps one per sign-in method a person uses. Magic links write none; the table is part of its core model, and no credential may be stored in it. */
export const authAccounts = pgTable(
  'auth_accounts',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    accountId: text().notNull(),
    providerId: text().notNull(),
    accessToken: text(),
    refreshToken: text(),
    idToken: text(),
    accessTokenExpiresAt: timestampTz(),
    refreshTokenExpiresAt: timestampTz(),
    scope: text(),
    password: text(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    uniqueIndex('auth_accounts_provider_account_unique').on(
      table.providerId,
      table.accountId,
    ),
    index('auth_accounts_user_idx').on(table.userId),
    check(
      'auth_accounts_ids_length',
      sql`char_length(${table.accountId}) <= 256 AND char_length(${table.providerId}) <= 64`,
    ),
    check(
      'auth_accounts_credentials_unused',
      sql`${table.accessToken} IS NULL AND ${table.refreshToken} IS NULL AND ${table.idToken} IS NULL AND ${table.password} IS NULL AND ${table.scope} IS NULL AND ${table.accessTokenExpiresAt} IS NULL AND ${table.refreshTokenExpiresAt} IS NULL`,
    ),
    check('auth_accounts_created_at_in_range', isReadableDate(table.createdAt)),
    check('auth_accounts_updated_at_in_range', isReadableDate(table.updatedAt)),
  ],
);

/**
 * A sign-in link waiting to be used. `identifier` holds the keyed hash of the link's token and
 * `value` the address it was sent to; the token itself is only ever in the email. A used link's row is deleted.
 */
export const authVerifications = pgTable(
  'auth_verifications',
  {
    id: uuid().primaryKey().defaultRandom(),
    identifier: text().notNull(),
    value: text().notNull(),
    expiresAt: timestampTz().notNull(),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
    updatedAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    index('auth_verifications_identifier_idx').on(table.identifier),
    index('auth_verifications_expires_at_idx').on(table.expiresAt),
    check(
      'auth_verifications_identifier_shape',
      sql`${table.identifier} ~ '^magic-link:[0-9a-f]{64}$'`,
    ),
    check(
      'auth_verifications_value_length',
      sql`char_length(${table.value}) <= 1024`,
    ),
    check(
      'auth_verifications_expires_at_in_range',
      isReadableDate(table.expiresAt),
    ),
    check(
      'auth_verifications_created_at_in_range',
      isReadableDate(table.createdAt),
    ),
    check(
      'auth_verifications_updated_at_in_range',
      isReadableDate(table.updatedAt),
    ),
  ],
);

export const roleGrantRoleEnum = pgEnum('role_grant_role', grantableRoles);

const sqlList = (values: readonly string[]) =>
  sql.raw(values.map((value) => `'${value}'`).join(', '));

/**
 * One row per role a person holds. Host owner and host staff name the host they act for; ops and
 * admin name none. Everyone who is signed in is a guest without a row.
 */
export const roleGrants = pgTable(
  'role_grants',
  {
    id: uuid().primaryKey().defaultRandom(),
    userId: uuid()
      .notNull()
      .references(() => authUsers.id, { onDelete: 'cascade' }),
    role: roleGrantRoleEnum().notNull(),
    hostId: uuid().references(() => hosts.id, { onDelete: 'restrict' }),
    createdAt: timestampTz()
      .notNull()
      .default(sql`clock_timestamp()`),
  },
  (table) => [
    // One row per person, role, and host; the ops and admin rows have no host, so a null counts as a value.
    unique('role_grants_user_role_host_unique')
      .on(table.userId, table.role, table.hostId)
      .nullsNotDistinct(),
    index('role_grants_host_idx').on(table.hostId),
    check(
      'role_grants_host_iff_host_role',
      sql`(${table.role} IN (${sqlList(hostScopedRoles)})) = (${table.hostId} IS NOT NULL)`,
    ),
    check('role_grants_created_at_in_range', isReadableDate(table.createdAt)),
  ],
);
