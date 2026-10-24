import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

// Migrations use the direct host: the pooler's transaction mode does not suit DDL.
// generate and check never connect, so only migrate needs it.
const url = process.env.DATABASE_URL_UNPOOLED;
if (!url && process.argv.includes('migrate')) {
  throw new Error(
    'DATABASE_URL_UNPOOLED is not set; migrate needs the direct host.',
  );
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './src/server/db/migrations',
  casing: 'snake_case',
  ...(url ? { dbCredentials: { url } } : {}),
});
