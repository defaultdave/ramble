import { loadEnvConfig } from '@next/env';
import { defineConfig } from 'drizzle-kit';

loadEnvConfig(process.cwd());

// Migrations use the direct host: the pooler's transaction mode does not suit DDL.
const url = process.env.DATABASE_URL_UNPOOLED ?? 'postgres://unset';

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/server/db/schema/index.ts',
  out: './src/server/db/migrations',
  casing: 'snake_case',
  dbCredentials: { url },
});
