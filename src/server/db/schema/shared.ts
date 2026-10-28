import { sql } from 'drizzle-orm';
import { type AnyPgColumn, pgEnum } from 'drizzle-orm/pg-core';
import { editorialLimits, publishStatuses } from '@/lib/editorial';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.
// What the editorial and policy tables share: the publish status enum and CHECK builders. Each one states a rule the Zod schemas in
// src/lib/editorial.ts, legal.ts, and settings.ts state too, so a row the schema refuses never lands.

export const publishStatusEnum = pgEnum('publish_status', publishStatuses);

const notBlank = (column: AnyPgColumn) => sql`${column} ~ '[^[:space:]]'`;

export const isKebab = (column: AnyPgColumn) =>
  sql`${column} ~ '^[a-z0-9]+(-[a-z0-9]+)*$'`;

export const maxChars = (column: AnyPgColumn, max: number) =>
  sql`char_length(${column}) <= ${sql.raw(String(max))}`;

/** A required text column: not blank and within its length. */
export const requiredText = (column: AnyPgColumn, max: number) =>
  sql`${notBlank(column)} AND ${maxChars(column, max)}`;

/** An optional text column: null, or not blank and within its length. */
export const optionalText = (column: AnyPgColumn, max: number) =>
  sql`${column} IS NULL OR (${requiredText(column, max)})`;

// Zod reads these columns as a JavaScript Date; see the same note in catalog.ts.
export const isReadableDate = (column: AnyPgColumn) =>
  sql`${column} >= '1000-01-01 00:00:00+00' AND ${column} < '10000-01-01 00:00:00+00'`;

/**
 * A stored rich-text document: Tiptap's root node, within the size the backstop allows. A missing
 * key reads as NULL, and a CHECK passes on NULL, so each test coalesces to something that fails.
 */
export const isRichTextDoc = (column: AnyPgColumn) =>
  sql`jsonb_typeof(${column}) = 'object'
    AND coalesce(${column}->>'type', '') = 'doc'
    AND coalesce(jsonb_typeof(${column}->'content'), '') = 'array'
    AND octet_length(${column}::text) <= ${sql.raw(String(editorialLimits.richTextStoredBytes))}`;

export const isRichTextDocOrNull = (column: AnyPgColumn) =>
  sql`${column} IS NULL OR (${isRichTextDoc(column)})`;

/** Published exactly when it has a publication time. */
export const publishedMatchesTime = (
  status: AnyPgColumn,
  publishedAt: AnyPgColumn,
) => sql`(${status} = 'published') = (${publishedAt} IS NOT NULL)`;
