import { relations, sql } from 'drizzle-orm';
import {
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
  experienceStatuses,
  priceKinds,
  slugEntityKinds,
  taxTreatments,
  weatherPolicies,
} from '@/lib/catalog';
import { cancellationTiers } from './policies';

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
    // No foreign key: the legal documents table arrives with the policy schema.
    waiverDocumentId: uuid(),
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
    check(
      'experiences_urls_are_http',
      sql`(${table.linkOutUrl} IS NULL OR ${table.linkOutUrl} ~* '^https?://')
        AND (${table.affiliateUrl} IS NULL OR ${table.affiliateUrl} ~* '^https?://')`,
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
    uniqueIndex('slug_history_kind_slug_unique').on(
      table.entityKind,
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
