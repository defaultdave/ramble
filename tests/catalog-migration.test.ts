import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { httpUrlPattern } from '@/lib/catalog';

it('holds the exact URL pattern the read schemas use, in both URL CHECKs', () => {
  const migration = readFileSync(
    path.resolve(
      import.meta.dirname,
      '../src/server/db/migrations/0001_catalog_tables.sql',
    ),
    'utf8',
  );

  const copies = migration.split(`~ '${httpUrlPattern}'`).length - 1;

  expect(copies).toBe(2);
});
