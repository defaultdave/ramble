import { sql } from 'drizzle-orm';
import {
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
import { dedupeKeyPattern, jobLimits, jobStatuses } from '@/lib/jobs';
import { isKebab, isReadableDate, maxChars } from './shared';

// No `import 'server-only'` here: drizzle-kit loads the schema outside Next.js, where that import throws.

export const jobStatusEnum = pgEnum('job_status', jobStatuses);

const timestampTz = () => timestamp({ withTimezone: true });
// clock_timestamp(), not now(): rows are ordered by when they were written, not by when the transaction began.
const writtenAt = () =>
  timestampTz()
    .notNull()
    .default(sql`clock_timestamp()`);

/**
 * The outbox. A row is written in the same transaction as the change it belongs to and drained by
 * `POST /api/pulse`. `kind` is text, not an enum: the registry in code decides which kinds exist,
 * so a new kind needs no migration. Each CHECK repeats a rule in src/lib/jobs.ts.
 */
export const jobs = pgTable(
  'jobs',
  {
    id: uuid().primaryKey().defaultRandom(),
    kind: text().notNull(),
    payload: jsonb().notNull(),
    dedupeKey: text(),
    status: jobStatusEnum().notNull().default('pending'),
    attempts: integer().notNull().default(0),
    maxAttempts: integer().notNull().default(jobLimits.defaultMaxAttempts),
    runAfter: writtenAt(),
    lockedUntil: timestampTz(),
    createdAt: writtenAt(),
    finishedAt: timestampTz(),
    lastError: text(),
  },
  (table) => [
    check(
      'jobs_kind_shape',
      sql`${isKebab(table.kind)} AND ${maxChars(table.kind, jobLimits.kindMaxChars)}`,
    ),
    check(
      'jobs_payload_bounded',
      sql`jsonb_typeof(${table.payload}) = 'object' AND pg_column_size(${table.payload}) <= ${sql.raw(String(jobLimits.payloadMaxBytes))}`,
    ),
    check(
      'jobs_dedupe_key_shape',
      sql`${table.dedupeKey} IS NULL OR (${table.dedupeKey} ~ ${sql.raw(`'${dedupeKeyPattern}'`)} AND ${maxChars(table.dedupeKey, jobLimits.dedupeKeyMaxChars)})`,
    ),
    check(
      'jobs_max_attempts_range',
      sql`${table.maxAttempts} BETWEEN 1 AND ${sql.raw(String(jobLimits.maxAttemptsCeiling))}`,
    ),
    check(
      'jobs_attempts_range',
      sql`${table.attempts} >= 0 AND ${table.attempts} <= ${table.maxAttempts}`,
    ),
    check(
      'jobs_last_error_bounded',
      sql`${table.lastError} IS NULL OR ${maxChars(table.lastError, jobLimits.lastErrorMaxChars)}`,
    ),
    check(
      'jobs_finished_matches_status',
      sql`(${table.status} IN ('succeeded', 'dead')) = (${table.finishedAt} IS NOT NULL)`,
    ),
    check(
      'jobs_locked_matches_status',
      sql`(${table.status} = 'running') = (${table.lockedUntil} IS NOT NULL)`,
    ),
    check('jobs_run_after_readable', isReadableDate(table.runAfter)),
    uniqueIndex('jobs_dedupe_key_unique')
      .on(table.dedupeKey)
      .where(sql`${table.dedupeKey} IS NOT NULL`),
    index('jobs_status_run_after').on(table.status, table.runAfter),
  ],
);
