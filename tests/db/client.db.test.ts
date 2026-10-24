import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

describe('migrations', () => {
  it('apply to an empty database and are recorded', async () => {
    const { rows } = await client.db.execute<{ count: string }>(
      sql.raw(
        `SELECT count(*) AS count FROM ${fresh.schema}.__drizzle_migrations`,
      ),
    );

    expect(Number(rows[0]?.count)).toBeGreaterThanOrEqual(1);
  });
});

describe('db', () => {
  it('rolls a transaction back', async () => {
    const rolledBack = client.db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TABLE rollback_probe (id integer)`);
      tx.rollback();
    });
    await expect(rolledBack).rejects.toThrow('Rollback');

    const { rows } = await client.db.execute<{ found: string | null }>(
      sql`SELECT to_regclass('rollback_probe') AS found`,
    );
    expect(rows[0]?.found).toBeNull();
  });

  it('commits a transaction', async () => {
    await client.db.transaction(async (tx) => {
      await tx.execute(sql`CREATE TABLE commit_probe (id integer)`);
    });

    const { rows } = await client.db.execute<{ found: string | null }>(
      sql`SELECT to_regclass('commit_probe') AS found`,
    );
    expect(rows[0]?.found).not.toBeNull();
  });
});

describe('dbRead', () => {
  it('runs a single select over HTTP', async () => {
    const result = await client.dbRead.execute(sql`SELECT 1 AS one`);

    expect(result.rows).toEqual([{ one: 1 }]);
  });
});
