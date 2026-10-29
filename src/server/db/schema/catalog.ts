import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
  check,
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from 'drizzle-orm/pg-core';
import {
  ageRules,
  httpUrlPattern,
  experienceStatuses,
  priceKinds,
  slugEntityKinds,
  taxTreatments,
  weatherPolicies,
} from '@/lib/catalog';
import {
  emailAddressPattern,
  maxEmailAddressLength,
} from '@/lib/email/address';
import {
  blurDataUrlPattern,
  photoLimits,
  photoRightsBases,
} from '@/lib/photos';
import {
  firstSessionDate,
  ianaZonePattern,
  lastSessionDate,
  maxAllocation,
  maxSessionMinutes,
  maxTimeZoneLength,
  sessionCancelReasons,
  sessionSources,
  sessionStatuses,
} from '@/lib/sessions';
import { cancellationTiers, legalDocuments } from './policies';
import { notBlank } from './shared';

export const experienceStatusEnum = pgEnum(
  'experience_status',
  experienceStatuses,
);
export const ageRuleEnum = pgEnum('age_rule', ageRules);
export const weatherPolicyEnum = pgEnum('weather_policy', weatherPolicies);
export const taxTreatmentEnum = pgEnum('tax_treatment', taxTreatments);
export const priceKindEnum = pgEnum('price_kind', priceKinds);
export const slugEntityKindEnum = pgEnum('slug_entity_kind', slugEntityKinds);
export const photoRightsBasisEnum = pgEnum(
  'photo_rights_basis',
  photoRightsBases,
);
export const sessionSourceEnum = pgEnum('session_source', sessionSources);
export const sessionStatusEnum = pgEnum('session_status', sessionStatuses);
export const sessionCancelReasonEnum = pgEnum(
  'session_cancel_reason',
  sessionCancelReasons,
);

const timestampTz = () => timestamp({ withTimezone: true });

// The read schemas test stored links with this same pattern, so the two cannot disagree.
const isHttpUrlOrNull = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR ${column} ~ ${sql.raw(`'${httpUrlPattern}'`)}`;

// Zod reads these columns as a JavaScript Date. Postgres also stores 'infinity', BC dates and years
// past 275760, which become an Invalid Date and fail the parse. The driver builds the Date from the
// text with new Date(), which reads a year below 100 as 19xx or 20xx, so the range is years 1000 to 9999.
const isReadableDate = (column: AnyPgColumn) =>
  sql`${column} >= '1000-01-01 00:00:00+00' AND ${column} < '10000-01-01 00:00:00+00'`;

export const hosts = pgTable(
  'hosts',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    timeZone: text().notNull(),
    /** Where booking and cancellation notices go (PRD-44). Not shown on listings. */
    notificationEmail: text(),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check('hosts_slug_kebab', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('hosts_name_not_blank', notBlank(table.name)),
    check(
      'hosts_notification_email_shape',
      sql`${table.notificationEmail} IS NULL OR (${table.notificationEmail} ~ ${sql.raw(`'${emailAddressPattern}'`)} AND char_length(${table.notificationEmail}) <= ${sql.raw(String(maxEmailAddressLength))})`,
    ),
    check('hosts_created_at_in_range', isReadableDate(table.createdAt)),
    check('hosts_time_zone_not_blank', notBlank(table.timeZone)),
  ],
);

export const categories = pgTable(
  'categories',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    name: text().notNull(),
  },
  (table) => [
    check(
      'categories_slug_kebab',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('categories_name_not_blank', notBlank(table.name)),
  ],
);

export const neighborhoods = pgTable(
  'neighborhoods',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    name: text().notNull(),
  },
  (table) => [
    check(
      'neighborhoods_slug_kebab',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('neighborhoods_name_not_blank', notBlank(table.name)),
  ],
);

export const experiences = pgTable(
  'experiences',
  {
    id: uuid().primaryKey().defaultRandom(),
    hostId: uuid()
      .notNull()
      .references(() => hosts.id, { onDelete: 'restrict' }),
    categoryId: uuid()
      .notNull()
      .references(() => categories.id, { onDelete: 'restrict' }),
    neighborhoodId: uuid()
      .notNull()
      .references(() => neighborhoods.id, { onDelete: 'restrict' }),
    cancellationTierId: uuid()
      .notNull()
      .references(() => cancellationTiers.id, { onDelete: 'restrict' }),
    slug: text().notNull(),
    name: text().notNull(),
    description: text(),
    meetingPoint: text(),
    included: text(),
    durationMinutes: integer(),
    accessibilityNotes: text(),
    status: experienceStatusEnum().notNull().default('draft'),
    outdoor: boolean().notNull().default(false),
    weatherPolicy: weatherPolicyEnum(),
    weatherDecisionHours: integer(),
    ageRule: ageRuleEnum().notNull().default('all_ages'),
    minAge: integer(),
    maxAge: integer(),
    taxTreatment: taxTreatmentEnum().notNull().default('unknown'),
    waiverRequired: boolean().notNull().default(false),
    waiverDocumentId: uuid().references(() => legalDocuments.id, {
      onDelete: 'restrict',
    }),
    linkOutUrl: text(),
    affiliateUrl: text(),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    index('experiences_host_id_idx').on(table.hostId),
    index('experiences_category_id_idx').on(table.categoryId),
    index('experiences_neighborhood_id_idx').on(table.neighborhoodId),
    check(
      'experiences_slug_kebab',
      sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`,
    ),
    check('experiences_name_not_blank', notBlank(table.name)),
    check('experiences_created_at_in_range', isReadableDate(table.createdAt)),
    check('experiences_duration_positive', sql`${table.durationMinutes} > 0`),
    check(
      'experiences_age_rule_limits',
      // IS NOT NULL is spelled out: a comparison with NULL is unknown, and a CHECK passes on unknown.
      sql`(
        ${table.ageRule} IN ('all_ages', 'twenty_one_plus')
          AND ${table.minAge} IS NULL AND ${table.maxAge} IS NULL
      ) OR (
        ${table.ageRule} = 'minimum_age'
          AND ${table.minAge} IS NOT NULL AND ${table.minAge} >= 0
          AND ${table.maxAge} IS NULL
      ) OR (
        ${table.ageRule} = 'age_range'
          AND ${table.minAge} IS NOT NULL AND ${table.minAge} >= 0
          AND ${table.maxAge} IS NOT NULL AND ${table.maxAge} >= ${table.minAge}
      )`,
    ),
    check(
      'experiences_outdoor_has_weather_policy',
      sql`NOT ${table.outdoor} OR ${table.weatherPolicy} IS NOT NULL`,
    ),
    check(
      'experiences_weather_decision_hours',
      sql`coalesce(${table.weatherPolicy} = 'decided_before_start', false)
        = (${table.weatherDecisionHours} IS NOT NULL)
        AND coalesce(${table.weatherDecisionHours} > 0, true)`,
    ),
    check(
      'experiences_guide_only_has_link',
      sql`${table.status} <> 'guide_only' OR ${table.linkOutUrl} IS NOT NULL`,
    ),
    check('experiences_link_out_url_http', isHttpUrlOrNull(table.linkOutUrl)),
    check(
      'experiences_affiliate_url_http',
      isHttpUrlOrNull(table.affiliateUrl),
    ),
  ],
);

export const priceOptions = pgTable(
  'price_options',
  {
    id: uuid().primaryKey().defaultRandom(),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    kind: priceKindEnum().notNull(),
    // Integer cents in USD (design doc 4.2), so there is no currency column.
    priceMinor: integer().notNull(),
    usesSpace: boolean().notNull().default(true),
  },
  (table) => [
    uniqueIndex('price_options_experience_kind_unique').on(
      table.experienceId,
      table.kind,
    ),
    check('price_options_price_not_negative', sql`${table.priceMinor} >= 0`),
  ],
);

/**
 * One stored photo of an experience (ADR 0002). The file is the re-encoded copy ingest produced, in the
 * public store under `storage_key`; the row holds what a page needs to render it (size, blur
 * placeholder, alt text or the decorative flag) and the rights record of PRD-52.
 */
export const photos = pgTable(
  'photos',
  {
    id: uuid().primaryKey().defaultRandom(),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    storageKey: text().notNull(),
    url: text().notNull(),
    width: integer().notNull(),
    height: integer().notNull(),
    byteSize: integer().notNull(),
    decorative: boolean().notNull().default(false),
    altText: text(),
    blurDataUrl: text().notNull(),
    rightsBasis: photoRightsBasisEnum().notNull(),
    rightsHolder: text(),
    rightsLicense: text(),
    rightsSourceUrl: text(),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('photos_experience_position_unique').on(
      table.experienceId,
      table.position,
    ),
    uniqueIndex('photos_storage_key_unique').on(table.storageKey),
    check(
      'photos_position_in_range',
      sql`${table.position} >= 0 AND ${table.position} < ${sql.raw(String(photoLimits.maxPerExperience))}`,
    ),
    // The key is built from the two ids, so a row can never point at another photo's file.
    check(
      'photos_storage_key_from_ids',
      sql`${table.storageKey} = 'public/photos/' || ${table.experienceId}::text || '/' || ${table.id}::text || '.jpg'`,
    ),
    check(
      'photos_url_http',
      sql`${table.url} ~ ${sql.raw(`'${httpUrlPattern}'`)} AND char_length(${table.url}) <= ${sql.raw(String(photoLimits.maxUrlLength))}`,
    ),
    check(
      'photos_dimensions_in_range',
      sql`${table.width} BETWEEN 1 AND ${sql.raw(String(photoLimits.storedEdge))} AND ${table.height} BETWEEN 1 AND ${sql.raw(String(photoLimits.storedEdge))}`,
    ),
    check(
      'photos_byte_size_in_range',
      sql`${table.byteSize} BETWEEN 1 AND ${sql.raw(String(photoLimits.maxStoredBytes))}`,
    ),
    // Alt text is required unless the photo is marked decorative, and a decorative photo carries none.
    check(
      'photos_alt_or_decorative',
      sql`(${table.decorative} AND ${table.altText} IS NULL) OR (
        NOT ${table.decorative}
          AND ${table.altText} IS NOT NULL
          AND char_length(${table.altText}) BETWEEN 1 AND ${sql.raw(String(photoLimits.maxAltLength))}
          AND ${notBlank(table.altText)}
      )`,
    ),
    check(
      'photos_blur_data_url',
      sql`${table.blurDataUrl} ~ ${sql.raw(`'${blurDataUrlPattern}'`)} AND char_length(${table.blurDataUrl}) <= ${sql.raw(String(photoLimits.maxBlurLength))}`,
    ),
    check(
      'photos_rights_holder',
      sql`${table.rightsHolder} IS NULL OR (char_length(${table.rightsHolder}) BETWEEN 1 AND ${sql.raw(String(photoLimits.maxRightsTextLength))} AND ${notBlank(table.rightsHolder)})`,
    ),
    check(
      'photos_rights_license',
      sql`${table.rightsLicense} IS NULL OR (char_length(${table.rightsLicense}) BETWEEN 1 AND ${sql.raw(String(photoLimits.maxRightsTextLength))} AND ${notBlank(table.rightsLicense)})`,
    ),
    check(
      'photos_rights_source_url',
      sql`${table.rightsSourceUrl} IS NULL OR (${table.rightsSourceUrl} ~ ${sql.raw(`'${httpUrlPattern}'`)} AND char_length(${table.rightsSourceUrl}) <= ${sql.raw(String(photoLimits.maxUrlLength))})`,
    ),
    // A licensed photo names holder, licence, and source; any other basis carries no licence or source.
    check(
      'photos_rights_licensed_complete',
      sql`${table.rightsBasis} <> 'licensed' OR (
        ${table.rightsHolder} IS NOT NULL
          AND ${table.rightsLicense} IS NOT NULL
          AND ${table.rightsSourceUrl} IS NOT NULL
      )`,
    ),
    check(
      'photos_rights_unlicensed_bare',
      sql`${table.rightsBasis} = 'licensed' OR (${table.rightsLicense} IS NULL AND ${table.rightsSourceUrl} IS NULL)`,
    ),
    check('photos_created_at_in_range', isReadableDate(table.createdAt)),
  ],
);

/**
 * Slugs an entity used to have. Triggers write a row when a slug changes, so no code path can
 * rename without recording it. `entityId` is not a foreign key because it points at one of four tables.
 */
export const slugHistory = pgTable(
  'slug_history',
  {
    id: uuid().primaryKey().defaultRandom(),
    entityKind: slugEntityKindEnum().notNull(),
    entityId: uuid().notNull(),
    slug: text().notNull(),
    retiredAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check('slug_history_retired_at_in_range', isReadableDate(table.retiredAt)),
    // Category and neighborhood slugs are unique while live, so a retired one names one entity.
    uniqueIndex('slug_history_unique_slug_per_kind')
      .on(table.entityKind, table.slug)
      .where(sql`${table.entityKind} IN ('category', 'neighborhood')`),
    // Experience and host slugs repeat across entities; each entity retires a given slug once.
    uniqueIndex('slug_history_entity_slug_unique').on(
      table.entityKind,
      table.entityId,
      table.slug,
    ),
  ],
);

/**
 * A weekly recurrence: every `weekday` at `startTime` on the host's wall clock. The time zone is
 * the host's (`hosts.time_zone`), read when sessions are generated, so a template cannot disagree
 * with its host. Generated sessions copy the zone and the template's source and allocation.
 */
export const sessionTemplates = pgTable(
  'session_templates',
  {
    id: uuid().primaryKey().defaultRandom(),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    // 0 is Sunday, as in JavaScript.
    weekday: smallint().notNull(),
    startTime: time({ precision: 0 }).notNull(),
    durationMinutes: integer().notNull(),
    allocation: integer().notNull(),
    source: sessionSourceEnum().notNull().default('ramble'),
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    // Lets a session's foreign key name the template and the experience together.
    unique('session_templates_id_experience_unique').on(
      table.id,
      table.experienceId,
    ),
    uniqueIndex('session_templates_slot_unique').on(
      table.experienceId,
      table.weekday,
      table.startTime,
    ),
    check(
      'session_templates_weekday_in_range',
      sql`${table.weekday} BETWEEN 0 AND 6`,
    ),
    // '24:00:00' is a valid Postgres time, and so is a leap second; neither is a start time.
    check(
      'session_templates_start_time_whole_minute',
      sql`${table.startTime} < '24:00:00' AND extract(second FROM ${table.startTime}) = 0`,
    ),
    check(
      'session_templates_duration_in_range',
      sql`${table.durationMinutes} BETWEEN 1 AND ${sql.raw(String(maxSessionMinutes))}`,
    ),
    check(
      'session_templates_allocation_in_range',
      sql`${table.allocation} BETWEEN 0 AND ${sql.raw(String(maxAllocation))}`,
    ),
    check(
      'session_templates_source_generated',
      sql`${table.source} IN ('ramble', 'allocation')`,
    ),
    check(
      'session_templates_created_at_in_range',
      isReadableDate(table.createdAt),
    ),
  ],
);

/**
 * One dated session. `seats_sold` moves only when an order confirms or a confirmed order is
 * cancelled (design doc 4.2.2). `local_date` and `template_id` together make generation
 * idempotent: a template has at most one session per date on the host's wall calendar, whatever
 * instant the zone's rules give it, and a session that was edited or cancelled is never rebuilt.
 */
export const sessions = pgTable(
  'sessions',
  {
    id: uuid().primaryKey().defaultRandom(),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    // Null for a session entered by hand.
    templateId: uuid(),
    localDate: date({ mode: 'string' }),
    startsAt: timestampTz().notNull(),
    endsAt: timestampTz().notNull(),
    timeZone: text().notNull(),
    allocation: integer().notNull(),
    seatsSold: integer().notNull().default(0),
    status: sessionStatusEnum().notNull().default('scheduled'),
    source: sessionSourceEnum().notNull(),
    cancelReason: sessionCancelReasonEnum(),
    version: integer().notNull().default(1),
  },
  (table) => [
    // A session cannot point at another experience's template. Without a template the key is not checked.
    foreignKey({
      name: 'sessions_template_experience_fk',
      columns: [table.templateId, table.experienceId],
      foreignColumns: [sessionTemplates.id, sessionTemplates.experienceId],
    }).onDelete('restrict'),
    index('sessions_experience_starts_at_idx').on(
      table.experienceId,
      table.startsAt,
    ),
    // Nulls never collide, so sessions without a template are not constrained.
    uniqueIndex('sessions_template_local_date_unique').on(
      table.templateId,
      table.localDate,
    ),
    check(
      'sessions_ends_after_start',
      sql`${table.endsAt} > ${table.startsAt}`,
    ),
    check('sessions_starts_at_in_range', isReadableDate(table.startsAt)),
    check('sessions_ends_at_in_range', isReadableDate(table.endsAt)),
    check(
      'sessions_allocation_in_range',
      sql`${table.allocation} BETWEEN 0 AND ${sql.raw(String(maxAllocation))}`,
    ),
    check('sessions_seats_sold_not_negative', sql`${table.seatsSold} >= 0`),
    // The backstop under the hold logic. It also refuses a capacity edit below what is booked.
    check(
      'sessions_seats_sold_within_allocation',
      sql`${table.seatsSold} <= ${table.allocation}`,
    ),
    check(
      'sessions_time_zone_iana',
      sql`char_length(${table.timeZone}) <= ${sql.raw(String(maxTimeZoneLength))} AND ${table.timeZone} ~ ${sql.raw(`'${ianaZonePattern}'`)}`,
    ),
    check(
      'sessions_cancel_reason_matches_status',
      sql`(${table.status} = 'cancelled') = (${table.cancelReason} IS NOT NULL)`,
    ),
    check('sessions_version_positive', sql`${table.version} >= 1`),
    check(
      'sessions_template_has_local_date',
      sql`(${table.templateId} IS NULL) = (${table.localDate} IS NULL)`,
    ),
    check(
      'sessions_local_date_in_range',
      sql`${table.localDate} IS NULL OR ${table.localDate} BETWEEN ${sql.raw(`'${firstSessionDate}'`)} AND ${sql.raw(`'${lastSessionDate}'`)}`,
    ),
    check(
      'sessions_template_source_generated',
      sql`${table.templateId} IS NULL OR ${table.source} IN ('ramble', 'allocation')`,
    ),
  ],
);

export const photosRelations = relations(photos, ({ one }) => ({
  experience: one(experiences, {
    fields: [photos.experienceId],
    references: [experiences.id],
  }),
}));

export const hostsRelations = relations(hosts, ({ many }) => ({
  experiences: many(experiences),
}));

export const experiencesRelations = relations(experiences, ({ one, many }) => ({
  host: one(hosts, { fields: [experiences.hostId], references: [hosts.id] }),
  category: one(categories, {
    fields: [experiences.categoryId],
    references: [categories.id],
  }),
  neighborhood: one(neighborhoods, {
    fields: [experiences.neighborhoodId],
    references: [neighborhoods.id],
  }),
  cancellationTier: one(cancellationTiers, {
    fields: [experiences.cancellationTierId],
    references: [cancellationTiers.id],
  }),
  priceOptions: many(priceOptions),
  photos: many(photos),
  sessionTemplates: many(sessionTemplates),
  sessions: many(sessions),
}));

export const sessionTemplatesRelations = relations(
  sessionTemplates,
  ({ one, many }) => ({
    experience: one(experiences, {
      fields: [sessionTemplates.experienceId],
      references: [experiences.id],
    }),
    sessions: many(sessions),
  }),
);

export const sessionsRelations = relations(sessions, ({ one }) => ({
  experience: one(experiences, {
    fields: [sessions.experienceId],
    references: [experiences.id],
  }),
  template: one(sessionTemplates, {
    fields: [sessions.templateId],
    references: [sessionTemplates.id],
  }),
}));

export const priceOptionsRelations = relations(priceOptions, ({ one }) => ({
  experience: one(experiences, {
    fields: [priceOptions.experienceId],
    references: [experiences.id],
  }),
}));

export const categoriesRelations = relations(categories, ({ many }) => ({
  experiences: many(experiences),
}));

export const neighborhoodsRelations = relations(neighborhoods, ({ many }) => ({
  experiences: many(experiences),
}));
