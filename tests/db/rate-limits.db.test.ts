import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFreshDatabase, type FreshDatabase } from './harness';

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let store: typeof import('@/server/db/rateLimits');
let limiter: typeof import('@/server/ports/rate-limit/postgres');
let counter = 0;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  store = await import('@/server/db/rateLimits');
  limiter = await import('@/server/ports/rate-limit/postgres');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

/** A fresh, well-formed key so no test sees another's row. */
function newKey(surface = 'forms') {
  counter += 1;
  return `${surface}:${counter.toString(16).padStart(64, '0')}`;
}

function consume(key: string, limit: number, windowSeconds = 60) {
  return limiter.postgresRateLimiter.consume({ key, limit, windowSeconds });
}

async function storedRow(key: string) {
  const { rows } = await client.db.execute<{
    count: number;
    window_seconds: number;
  }>(
    sql`SELECT count, EXTRACT(EPOCH FROM expires_at - window_started_at)::integer AS window_seconds FROM rate_limits WHERE key = ${key}`,
  );
  return rows[0];
}

describe('rate_limits constraints', () => {
  const goodKey = `forms:${'a'.repeat(64)}`;

  function insert(key: string, count: number, windowOffset = '1 minute') {
    return client.db.execute(
      sql`INSERT INTO rate_limits (key, count, expires_at) VALUES (${key}, ${count}, now() + ${windowOffset}::interval)`,
    );
  }

  it('accepts a well-formed row', async () => {
    await insert(goodKey, 1);

    expect((await storedRow(goodKey))?.count).toBe(1);
  });

  it.each([
    ['a raw email', 'forms:guest@example.com'],
    ['no digest', 'forms'],
    ['a short digest', `forms:${'a'.repeat(63)}`],
    ['a long digest', `forms:${'a'.repeat(65)}`],
    ['an upper-case digest', `forms:${'A'.repeat(64)}`],
    ['an upper-case surface', `Forms:${'a'.repeat(64)}`],
    ['a hyphenated surface', `sign-in:${'a'.repeat(64)}`],
    ['a trailing newline', `forms:${'a'.repeat(64)}\n`],
    ['a surface of 33 letters', `${'a'.repeat(33)}:${'a'.repeat(64)}`],
    ['an unbounded surface', `${'a'.repeat(100_000)}:${'a'.repeat(64)}`],
    ['an unbounded key', 'x'.repeat(100_000)],
  ])('refuses a key that is %s', async (_name, key) => {
    await expect(insert(key, 1)).rejects.toMatchObject({
      cause: { constraint: 'rate_limits_key_shape' },
    });
  });

  it.each([0, -1])('refuses a count of %i', async (count) => {
    await expect(insert(newKey(), count)).rejects.toMatchObject({
      cause: { constraint: 'rate_limits_count_positive' },
    });
  });

  it('refuses a window that ends before it starts', async () => {
    await expect(insert(newKey(), 1, '-1 minute')).rejects.toMatchObject({
      cause: { constraint: 'rate_limits_window_forward' },
    });
  });

  it('refuses a null count and a null expiry', async () => {
    await expect(
      client.db.execute(
        sql`INSERT INTO rate_limits (key, count, expires_at) VALUES (${newKey()}, NULL, now() + interval '1 minute')`,
      ),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
    await expect(
      client.db.execute(
        sql`INSERT INTO rate_limits (key, count, expires_at) VALUES (${newKey()}, 1, NULL)`,
      ),
    ).rejects.toMatchObject({ cause: { code: '23502' } });
  });
});

describe('postgresRateLimiter', () => {
  it('allows up to the limit, then refuses with a wait', async () => {
    const key = newKey();

    expect(await consume(key, 3)).toEqual({ allowed: true, remaining: 2 });
    expect(await consume(key, 3)).toEqual({ allowed: true, remaining: 1 });
    expect(await consume(key, 3)).toEqual({ allowed: true, remaining: 0 });

    const refused = await consume(key, 3);
    expect(refused.allowed).toBe(false);
    if (!refused.allowed) {
      expect(refused.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(refused.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('counts each key on its own', async () => {
    const first = newKey();
    const second = newKey('reserve');
    await consume(first, 1);

    expect((await consume(first, 1)).allowed).toBe(false);
    expect((await consume(second, 1)).allowed).toBe(true);
  });

  it('lets exactly the limit through when many tries arrive at once', async () => {
    const key = newKey();

    const decisions = await Promise.all(
      Array.from({ length: 40 }, () => consume(key, 5)),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(5);
    expect(decisions.filter((decision) => !decision.allowed)).toHaveLength(35);
    const remaining = decisions
      .filter((decision) => decision.allowed)
      .map((decision) => decision.remaining)
      .sort();
    expect(remaining).toEqual([0, 1, 2, 3, 4]);
  });

  it('holds the limit across keys tried at once', async () => {
    const keys = [newKey(), newKey(), newKey()];

    const decisions = await Promise.all(
      keys.flatMap((key) => Array.from({ length: 10 }, () => consume(key, 2))),
    );

    expect(decisions.filter((decision) => decision.allowed)).toHaveLength(6);
  });

  it('stops counting one past the limit, so a flood cannot grow the row', async () => {
    const key = newKey();

    await Promise.all(Array.from({ length: 30 }, () => consume(key, 4)));

    expect((await storedRow(key))?.count).toBe(5);
  });

  it('starts a new window once the old one has ended', async () => {
    const key = newKey();
    await consume(key, 1);
    expect((await consume(key, 1)).allowed).toBe(false);

    await client.db.execute(
      sql`UPDATE rate_limits SET window_started_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE key = ${key}`,
    );

    expect(await consume(key, 1)).toEqual({ allowed: true, remaining: 0 });
    expect((await storedRow(key))?.count).toBe(1);
    expect((await consume(key, 1)).allowed).toBe(false);
  });

  it('does not extend a window by refusing tries inside it', async () => {
    const key = newKey();
    await consume(key, 1, 120);
    const before = await storedRow(key);

    await consume(key, 1, 120);
    await consume(key, 1, 120);

    expect(await storedRow(key)).toMatchObject({
      window_seconds: before?.window_seconds,
    });
  });

  it.each([
    [
      'a key that is not well formed',
      { key: 'forms:guest@example.com', limit: 1, windowSeconds: 60 },
    ],
    [
      'a zero limit',
      { key: `forms:${'b'.repeat(64)}`, limit: 0, windowSeconds: 60 },
    ],
    [
      'a window over a day',
      { key: `forms:${'b'.repeat(64)}`, limit: 1, windowSeconds: 86_401 },
    ],
  ])('refuses %s before it reaches the table', async (_name, input) => {
    await expect(limiter.postgresRateLimiter.consume(input)).rejects.toThrow();
  });
});

describe('purgeExpiredRateLimits', () => {
  it('deletes ended windows and keeps live ones', async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);
    const live = newKey();
    const ended = newKey();
    await consume(live, 5);
    await consume(ended, 5);
    await client.db.execute(
      sql`UPDATE rate_limits SET window_started_at = now() - interval '2 minutes', expires_at = now() - interval '1 minute' WHERE key = ${ended}`,
    );

    expect(await store.purgeExpiredRateLimits()).toBe(1);

    expect(await storedRow(ended)).toBeUndefined();
    expect((await storedRow(live))?.count).toBe(1);
  });

  it('removes at most one batch per call', async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);
    await client.db.execute(sql`
      INSERT INTO rate_limits (key, count, window_started_at, expires_at)
      SELECT 'forms:' || lpad(to_hex(n), 64, '0'), 1, now() - interval '2 minutes', now() - interval '1 minute'
      FROM generate_series(1, 1100) AS n
    `);

    expect(await store.purgeExpiredRateLimits()).toBe(1000);
    expect(await store.purgeExpiredRateLimits()).toBe(100);
    expect(await store.purgeExpiredRateLimits()).toBe(0);
  });
});
