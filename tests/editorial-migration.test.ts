import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { editorialLimits } from '@/lib/editorial';
import { legalDocPattern } from '@/lib/legal';
import { settingsBounds } from '@/lib/settings';

const migrations = path.resolve(
  import.meta.dirname,
  '../src/server/db/migrations',
);

// Found by name, not number: the number changes when another unit's migration lands first.
function migrationNamed(name: string): string {
  const files = readdirSync(migrations).filter((file) =>
    new RegExp(`^\\d{4}_${name}\\.sql$`).test(file),
  );
  const [file] = files;
  if (files.length !== 1 || file === undefined) {
    throw new Error(
      `Expected one migration named ${name}, found ${String(files.length)}`,
    );
  }
  return readFileSync(path.join(migrations, file), 'utf8');
}

const migration = migrationNamed('editorial_and_policy_schema');
const guards = migrationNamed('editorial_policy_guards');

const count = (needle: string) => migration.split(needle).length - 1;

// Each Zod rule that has a CHECK states its number in the migration. These read the numbers back
// out of the committed SQL, so a limit changed in one place and not the other fails here.

it('holds the legal document key pattern the Zod schema uses, once', () => {
  expect(count(`~ '${legalDocPattern}'`)).toBe(1);
});

it('holds the stored rich-text limit in each of the six document columns', () => {
  expect(
    count(`::text) <= ${String(editorialLimits.richTextStoredBytes)}`),
  ).toBe(6);
});

it('leaves room in the stored limit for the spaces jsonb adds to a document at the Zod limit', () => {
  expect(editorialLimits.richTextStoredBytes).toBeGreaterThanOrEqual(
    editorialLimits.richTextBytes * 2,
  );
});

it.each([
  ['collections', 'slug', editorialLimits.slug],
  ['collections', 'title', editorialLimits.title],
  ['collections', 'summary', editorialLimits.summary],
  ['collection_items', 'note', editorialLimits.note],
  ['home_modules', 'heading', editorialLimits.heading],
  ['pages', 'heading', editorialLimits.heading],
  ['pages', 'meta_description', editorialLimits.metaDescription],
  ['help_articles', 'slug', editorialLimits.slug],
  ['help_articles', 'title', editorialLimits.title],
  ['help_articles', 'summary', editorialLimits.summary],
  ['legal_documents', 'doc', editorialLimits.slug],
  ['legal_documents', 'title', editorialLimits.title],
])('holds the length limit of %s.%s', (table, column, limit) => {
  expect(migration).toContain(
    `char_length("${table}"."${column}") <= ${String(limit)}`,
  );
});

it('holds the collection and module position limits', () => {
  expect(migration).toContain(
    `"position" < ${String(editorialLimits.collectionItems)}`,
  );
  expect(migration).toContain(
    `"position" < ${String(editorialLimits.homeModules)}`,
  );
  expect(migration).toContain(
    `"position" <= ${String(editorialLimits.helpPosition)}`,
  );
});

it.each([
  ['hold_minutes', settingsBounds.holdMinutes],
  ['payment_grace_minutes', settingsBounds.paymentGraceMinutes],
  ['gift_validity_months', settingsBounds.giftValidityMonths],
  ['tax_rate_ppm', settingsBounds.taxRatePpm],
])('holds the %s bounds', (column, { min, max }) => {
  expect(migration).toContain(
    `"${column}" BETWEEN ${String(min)} AND ${String(max)}`,
  );
});

it('holds the banner length', () => {
  expect(migration).toContain(
    `char_length("settings"."banner_text") <= ${String(settingsBounds.bannerChars)}`,
  );
});

// drizzle-kit regenerates the schema migration from the snapshot and drops anything written by
// hand, so rows and triggers live in their own custom migration.
it('keeps the rows and triggers out of the generated schema migration', () => {
  expect(migration).not.toMatch(/CREATE (FUNCTION|TRIGGER)|INSERT INTO/);
  expect(guards).toContain('INSERT INTO settings DEFAULT VALUES');
  expect(guards.match(/CREATE TRIGGER/g)).toHaveLength(5);
});

it('says the tax default is pending Q-12 wherever it is written', () => {
  expect(guards).toContain('pending Q-12');
});
