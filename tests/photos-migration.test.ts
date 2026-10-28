import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import { httpUrlPattern } from '@/lib/catalog';
import { blurDataUrlPattern } from '@/lib/photos';

const folder = path.resolve(import.meta.dirname, '../src/server/db/migrations');
const migrationFile = readdirSync(folder).find((name) =>
  /^\d{4}_photos\.sql$/.test(name),
);

function migration() {
  if (!migrationFile) throw new Error('No photos migration found');
  return readFileSync(path.join(folder, migrationFile), 'utf8');
}

it('holds the exact URL pattern the read schemas use, in both photo URL CHECKs', () => {
  expect(migration().split(`~ '${httpUrlPattern}'`).length - 1).toBe(2);
});

it('holds the exact blur placeholder pattern the read schema uses', () => {
  expect(migration().split(`~ '${blurDataUrlPattern}'`).length - 1).toBe(1);
});
