import { sql } from 'drizzle-orm';
import {
  boolean,
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
import {
  collectionKinds,
  editorialLimits,
  homeModuleKinds,
  homeModuleKindsWithCollection,
} from '@/lib/editorial';
import type { RichTextDoc } from '@/lib/richText/format';
import { categories, experiences, neighborhoods } from './catalog';
import {
  isKebab,
  isReadableDate,
  isRichTextDoc,
  isRichTextDocOrNull,
  maxChars,
  optionalText,
  publishedMatchesTime,
  publishStatusEnum,
  requiredText,
} from './shared';

export const collectionKindEnum = pgEnum('collection_kind', collectionKinds);
export const homeModuleKindEnum = pgEnum('home_module_kind', homeModuleKinds);

const timestampTz = () => timestamp({ withTimezone: true });

const slugShape = (column: Parameters<typeof isKebab>[0]) =>
  sql`${isKebab(column)} AND ${maxChars(column, editorialLimits.slug)}`;

/**
 * Ramble Picks (many) and the gift guide (exactly one). A draft is invisible to guests; the
 * time of publication is set exactly when the status is `published`.
 */
export const collections = pgTable(
  'collections',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: collectionKindEnum().notNull(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    summary: text(),
    intro: jsonb().$type<RichTextDoc>(),
    status: publishStatusEnum().notNull().default('draft'),
    publishedAt: timestampTz(),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('collections_one_gift_guide')
      .on(table.kind)
      .where(sql`${table.kind} = 'gift_guide'`),
    check('collections_slug_shape', slugShape(table.slug)),
    check(
      'collections_title',
      requiredText(table.title, editorialLimits.title),
    ),
    check(
      'collections_summary',
      optionalText(table.summary, editorialLimits.summary),
    ),
    check('collections_intro_is_rich_text', isRichTextDocOrNull(table.intro)),
    check(
      'collections_published_at_matches_status',
      publishedMatchesTime(table.status, table.publishedAt),
    ),
    check(
      'collections_dates_in_range',
      sql`${isReadableDate(table.createdAt)} AND ${isReadableDate(table.updatedAt)}
        AND (${table.publishedAt} IS NULL OR (${isReadableDate(table.publishedAt)}))`,
    ),
  ],
);

/** The experiences of a collection in order. Positions are unique and bounded, which caps the list. */
export const collectionItems = pgTable(
  'collection_items',
  {
    id: uuid().primaryKey().defaultRandom(),
    collectionId: uuid()
      .notNull()
      .references(() => collections.id, { onDelete: 'cascade' }),
    experienceId: uuid()
      .notNull()
      .references(() => experiences.id, { onDelete: 'restrict' }),
    position: integer().notNull(),
    note: text(),
  },
  (table) => [
    uniqueIndex('collection_items_position_unique').on(
      table.collectionId,
      table.position,
    ),
    uniqueIndex('collection_items_experience_unique').on(
      table.collectionId,
      table.experienceId,
    ),
    index('collection_items_experience_id_idx').on(table.experienceId),
    check(
      'collection_items_position_in_range',
      sql`${table.position} >= 0 AND ${table.position} < ${sql.raw(String(editorialLimits.collectionItems))}`,
    ),
    check(
      'collection_items_note',
      optionalText(table.note, editorialLimits.note),
    ),
  ],
);

/**
 * The home page: ordered rows, saved as one list. A disabled module stays for the editor and is
 * hidden from guests.
 */
export const homeModules = pgTable(
  'home_modules',
  {
    id: uuid().primaryKey().defaultRandom(),
    position: integer().notNull().unique(),
    kind: homeModuleKindEnum().notNull(),
    enabled: boolean().notNull().default(true),
    heading: text(),
    body: jsonb().$type<RichTextDoc>(),
    collectionId: uuid().references(() => collections.id, {
      onDelete: 'restrict',
    }),
  },
  (table) => [
    index('home_modules_collection_id_idx').on(table.collectionId),
    check(
      'home_modules_position_in_range',
      sql`${table.position} >= 0 AND ${table.position} < ${sql.raw(String(editorialLimits.homeModules))}`,
    ),
    check(
      'home_modules_heading',
      optionalText(table.heading, editorialLimits.heading),
    ),
    check('home_modules_body_is_rich_text', isRichTextDocOrNull(table.body)),
    check(
      'home_modules_collection_only_where_shown',
      sql`${table.collectionId} IS NULL OR ${table.kind} IN (${sql.raw(
        homeModuleKindsWithCollection.map((kind) => `'${kind}'`).join(', '),
      )})`,
    ),
  ],
);

/** Editorial copy for one category or one neighborhood page: exactly one of the two foreign keys is set. */
export const pages = pgTable(
  'pages',
  {
    id: uuid().primaryKey().defaultRandom(),
    categoryId: uuid().references(() => categories.id, {
      onDelete: 'restrict',
    }),
    neighborhoodId: uuid().references(() => neighborhoods.id, {
      onDelete: 'restrict',
    }),
    heading: text(),
    metaDescription: text(),
    intro: jsonb().$type<RichTextDoc>(),
    body: jsonb().$type<RichTextDoc>(),
    status: publishStatusEnum().notNull().default('draft'),
    publishedAt: timestampTz(),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex('pages_category_unique')
      .on(table.categoryId)
      .where(sql`${table.categoryId} IS NOT NULL`),
    uniqueIndex('pages_neighborhood_unique')
      .on(table.neighborhoodId)
      .where(sql`${table.neighborhoodId} IS NOT NULL`),
    check(
      'pages_one_target',
      sql`num_nonnulls(${table.categoryId}, ${table.neighborhoodId}) = 1`,
    ),
    check(
      'pages_heading',
      optionalText(table.heading, editorialLimits.heading),
    ),
    check(
      'pages_meta_description',
      optionalText(table.metaDescription, editorialLimits.metaDescription),
    ),
    check('pages_intro_is_rich_text', isRichTextDocOrNull(table.intro)),
    check('pages_body_is_rich_text', isRichTextDocOrNull(table.body)),
    check(
      'pages_published_at_matches_status',
      publishedMatchesTime(table.status, table.publishedAt),
    ),
    check(
      'pages_dates_in_range',
      sql`${isReadableDate(table.updatedAt)}
        AND (${table.publishedAt} IS NULL OR (${isReadableDate(table.publishedAt)}))`,
    ),
  ],
);

export const helpArticles = pgTable(
  'help_articles',
  {
    id: uuid().primaryKey().defaultRandom(),
    slug: text().notNull().unique(),
    title: text().notNull(),
    summary: text(),
    body: jsonb().$type<RichTextDoc>().notNull(),
    position: integer().notNull().default(0),
    status: publishStatusEnum().notNull().default('draft'),
    publishedAt: timestampTz(),
    createdAt: timestampTz().notNull().defaultNow(),
    updatedAt: timestampTz().notNull().defaultNow(),
  },
  (table) => [
    check('help_articles_slug_shape', slugShape(table.slug)),
    check(
      'help_articles_title',
      requiredText(table.title, editorialLimits.title),
    ),
    check(
      'help_articles_summary',
      optionalText(table.summary, editorialLimits.summary),
    ),
    check('help_articles_body_is_rich_text', isRichTextDoc(table.body)),
    check(
      'help_articles_position_in_range',
      sql`${table.position} >= 0 AND ${table.position} <= ${sql.raw(String(editorialLimits.helpPosition))}`,
    ),
    check(
      'help_articles_published_at_matches_status',
      publishedMatchesTime(table.status, table.publishedAt),
    ),
    check(
      'help_articles_dates_in_range',
      sql`${isReadableDate(table.createdAt)} AND ${isReadableDate(table.updatedAt)}
        AND (${table.publishedAt} IS NULL OR (${isReadableDate(table.publishedAt)}))`,
    ),
  ],
);
