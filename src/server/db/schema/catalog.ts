import { relations, sql } from 'drizzle-orm';
import {
  type AnyPgColumn,
  boolean,
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
  ageRules,
  httpUrlPattern,
  experienceStatuses,
  priceKinds,
  slugEntityKinds,
  taxTreatments,
  weatherPolicies,
} from '@/lib/catalog';
import { cancellationTiers, legalDocuments } from './policies';

export const experienceStatusEnum = pgEnum(
  'experience_status',
  experienceStatuses,
);
export const ageRuleEnum = pgEnum('age_rule', ageRules);
export const weatherPolicyEnum = pgEnum('weather_policy', weatherPolicies);
export const taxTreatmentEnum = pgEnum('tax_treatment', taxTreatments);
export const priceKindEnum = pgEnum('price_kind', priceKinds);
export const slugEntityKindEnum = pgEnum('slug_entity_kind', slugEntityKinds);

const timestampTz = () => timestamp({ withTimezone: true });

// A row the Zod schema in src/lib/catalog.ts refuses makes a whole list read throw, so a CHECK here
// must refuse whatever that schema refuses.
const notBlank = (column: AnyPgColumn) => sql`${column} ~ '[^[:space:]]'`;

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
    createdAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check('hosts_slug_kebab', sql`${table.slug} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`),
    check('hosts_name_not_blank', notBlank(table.name)),
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
