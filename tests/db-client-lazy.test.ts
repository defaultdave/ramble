import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test, one per branch:
// - importing the client with no DATABASE_URL neither throws nor connects
// - awaiting a handle, or probing it with a symbol, does not build the client
// - the first use of db or dbRead with no DATABASE_URL throws the clear error, and keeps throwing
// - the pool is not built from the PG environment variables when DATABASE_URL is missing

async function loadClient() {
  vi.resetModules();
  return import('@/server/db/client');
}

describe('the database client without DATABASE_URL', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('imports without throwing', async () => {
    vi.stubEnv('DATABASE_URL', undefined);

    await expect(loadClient()).resolves.toHaveProperty('db');
  });

  it('does not build the client when awaited or probed with a symbol', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    const { db, dbRead } = await loadClient();

    expect(await Promise.resolve(db)).toBe(db);
    expect(await Promise.resolve(dbRead)).toBe(dbRead);
    expect(Reflect.get(db, Symbol.toPrimitive)).toBeUndefined();
  });

  it.each(['db', 'dbRead'] as const)(
    'throws the clear error on the first use of %s, every time',
    async (name) => {
      vi.stubEnv('DATABASE_URL', undefined);
      const client = await loadClient();

      expect(() => Reflect.get(client[name], 'select')).toThrow(
        'DATABASE_URL is not set',
      );
      expect(() => Reflect.get(client[name], 'select')).toThrow(
        'DATABASE_URL is not set',
      );
    },
  );

  it('does not fall back to the PG environment', async () => {
    vi.stubEnv('DATABASE_URL', undefined);
    vi.stubEnv('PGHOST', 'db.invalid');
    const { db } = await loadClient();

    expect(() => db.$client).toThrow('DATABASE_URL is not set');
  });
});
