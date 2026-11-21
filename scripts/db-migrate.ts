// `pnpm db:migrate`. A drop-in for `drizzle-kit migrate`, whose spinner hides the Postgres error.
// The workflow and the Vercel build have Node and pnpm only, so this runs under plain Node.
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import nextEnv from '@next/env';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { formatMigrationError } from './db-migrate-error.ts';

nextEnv.loadEnvConfig(process.cwd());

// Migrations use the direct host: the pooler's transaction mode does not suit DDL.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url) {
  console.error(
    'DATABASE_URL_UNPOOLED is not set; migrate needs the direct host.',
  );
  process.exit(1);
}

const migrationsFolder = path.resolve('src/server/db/migrations');
const pool = new pg.Pool({ connectionString: url, max: 1 });

/** Same rule drizzle's migrator uses: an entry is pending when it is newer than the last applied one. */
async function pendingTags(): Promise<string[]> {
  const journal = JSON.parse(
    await readFile(path.join(migrationsFolder, 'meta/_journal.json'), 'utf8'),
  ) as { entries: { when: number; tag: string }[] };
  let lastApplied = 0;
  try {
    const { rows } = await pool.query<{ created_at: string | null }>(
      'select max(created_at) as created_at from drizzle.__drizzle_migrations',
    );
    lastApplied = Number(rows[0]?.created_at ?? 0);
  } catch (error) {
    if ((error as { code?: string }).code !== '42P01') throw error;
  }
  return journal.entries.filter((e) => e.when > lastApplied).map((e) => e.tag);
}

try {
  const pending = await pendingTags();
  console.log(
    `Pending migrations (${pending.length}): ${pending.join(', ') || 'none'}`,
  );
  await migrate(drizzle(pool), { migrationsFolder });
  console.log(`Applied ${pending.length} migration(s).`);
} catch (error) {
  console.error(
    'db:migrate failed. Drizzle applies the pending migrations in one transaction, so none of them were kept.',
  );
  console.error(formatMigrationError(error));
  process.exitCode = 1;
} finally {
  await pool.end();
}
