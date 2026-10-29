import { neonConfig } from '@neondatabase/serverless';
import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFreshDatabase,
  startNeonHttpShim,
  type FreshDatabase,
} from './harness';

let fresh: FreshDatabase;
let shim: Awaited<ReturnType<typeof startNeonHttpShim>>;
const originalEndpoint = neonConfig.fetchEndpoint;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  shim = await startNeonHttpShim(fresh.url);
});

afterAll(async () => {
  neonConfig.fetchEndpoint = originalEndpoint;
  vi.unstubAllEnvs();
  await shim.stop();
  await fresh.dispose();
});

describe('dbRead with NEON_HTTP_ENDPOINT', () => {
  it('reads through the endpoint it is given', async () => {
    vi.stubEnv('DATABASE_URL', fresh.url);
    vi.stubEnv('NEON_HTTP_ENDPOINT', shim.endpoint);
    vi.resetModules();
    const { dbRead } = await import('@/server/db/client');

    const result = await dbRead.execute(
      sql`SELECT current_schema() AS schema_name`,
    );

    expect(result.rows).toEqual([{ schema_name: fresh.schema }]);
    expect(neonConfig.fetchEndpoint).toBe(shim.endpoint);
  });

  it('refuses a request that carries an Origin header', async () => {
    const response = await fetch(shim.endpoint, {
      method: 'POST',
      headers: { origin: 'https://evil.example' },
      body: JSON.stringify({ query: 'SELECT 1', params: [] }),
    });

    expect(response.status).toBe(403);
  });
});
