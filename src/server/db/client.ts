import 'server-only';
import { neon } from '@neondatabase/serverless';
import { attachDatabasePool } from '@vercel/functions';
import { drizzle as drizzleHttp } from 'drizzle-orm/neon-http';
import { drizzle as drizzlePool } from 'drizzle-orm/node-postgres';
import { Pool } from 'pg';
import { env } from '@/server/env';
import * as schema from './schema';

function requireUrl(): string {
  if (!env.DATABASE_URL) {
    throw new Error('DATABASE_URL is not set');
  }
  return env.DATABASE_URL;
}

const pool = new Pool({ connectionString: requireUrl() });
// Without a listener, an error on an idle pooled client would crash the process.
pool.on('error', (error) => {
  console.error('Idle database client failed', error);
});
attachDatabasePool(pool);

/** Pooled host. The only handle that may open a transaction. */
export const db = drizzlePool(pool, { schema, casing: 'snake_case' });

/**
 * HTTP driver, for single reads only. It has no transactions, and a check that reads other rows
 * (capacity, balance) oversold 615 spaces in 8 rounds of the concurrency spike, so never run one here.
 */
export const dbRead: Omit<
  ReturnType<typeof drizzleHttp<typeof schema>>,
  'transaction'
> = drizzleHttp(neon(requireUrl()), { schema, casing: 'snake_case' });
