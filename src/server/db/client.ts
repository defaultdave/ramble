import 'server-only';
import { neon, neonConfig } from '@neondatabase/serverless';
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

function createPooledDb() {
  const pool = new Pool({ connectionString: requireUrl() });
  // Without a listener, an error on an idle pooled client would crash the process. Only the
  // message is logged: the error object can carry the connection string.
  pool.on('error', (error) => {
    console.error(`Idle database client failed: ${error.message}`);
  });
  attachDatabasePool(pool);
  return drizzlePool(pool, { schema, casing: 'snake_case' });
}

type ReadDb = Omit<
  ReturnType<typeof drizzleHttp<typeof schema>>,
  'transaction' | 'batch'
>;

function createReadDb(): ReadDb {
  // The driver takes its endpoint from process-wide config only. env.ts has already refused a
  // non-local value and any value in a deployed environment.
  if (env.NEON_HTTP_ENDPOINT) {
    neonConfig.fetchEndpoint = env.NEON_HTTP_ENDPOINT;
  }
  return drizzleHttp(neon(requireUrl()), { schema, casing: 'snake_case' });
}

/**
 * The real client is built on first use, so importing this module (as `next build` does for every
 * route that reaches it) never needs a database or connects to one. Using the handle with no
 * `DATABASE_URL` throws the usual error at that moment; nothing falls back to the PG environment.
 * A Proxy keeps `db` and `dbRead` as plain exports with their full types.
 */
function lazy<T extends object>(create: () => T): T {
  let instance: T | undefined;
  return new Proxy({} as T, {
    get(_target, property) {
      // `await db` and a symbol probe (inspection, serialization) must not open a connection.
      if (property === 'then' || typeof property === 'symbol') {
        return undefined;
      }
      instance ??= create();
      const value: unknown = Reflect.get(instance, property, instance);
      if (typeof value !== 'function') return value;
      const bound: unknown = value.bind(instance);
      return bound;
    },
  });
}

/** Pooled host. The only handle that may open a transaction. */
export const db = lazy(createPooledDb);

/**
 * HTTP driver, for single reads only. It has no transactions, and a check that reads other rows
 * (capacity, balance) oversold 615 spaces in 8 rounds of the concurrency spike, so never run one here.
 */
export const dbRead: ReadDb = lazy(createReadDb);
