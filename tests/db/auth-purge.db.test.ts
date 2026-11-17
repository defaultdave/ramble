import { sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { createFreshDatabase, type FreshDatabase } from './harness';

// Behaviours, one per decision or risk:
// - a sign-in link row or a session row that expired 31 days ago is deleted; one that expired 29 days ago is kept
// - a row that expired only just, or not yet, is kept (the 30 days run from expiry)
// - each purge touches only its own table
// - one call removes at most one batch, and the next call takes the rest
// - deleting a session leaves its sign-in user

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let purge: typeof import('@/server/db/authPurge');
let userId: string;
let counter = 0;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  purge = await import('@/server/db/authPurge');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM auth_verifications`);
  await client.db.execute(sql`DELETE FROM auth_sessions`);
  await client.db.execute(sql`DELETE FROM auth_users`);
  const { rows } = await client.db.execute<{ id: string }>(
    sql`INSERT INTO auth_users (email, email_verified) VALUES ('guest@example.com', true) RETURNING id`,
  );
  userId = rows[0]?.id ?? '';
});

async function addVerification(expiredAgo: string): Promise<string> {
  counter += 1;
  const { rows } = await client.db.execute<{ id: string }>(sql`
    INSERT INTO auth_verifications (identifier, value, expires_at)
    VALUES (${`magic-link:${counter.toString(16).padStart(64, '0')}`}, 'guest@example.com', now() - ${expiredAgo}::interval)
    RETURNING id`);
  return rows[0]?.id ?? '';
}

async function addSession(expiredAgo: string): Promise<string> {
  counter += 1;
  const { rows } = await client.db.execute<{ id: string }>(sql`
    INSERT INTO auth_sessions (user_id, token, expires_at)
    VALUES (${userId}, ${`token-${counter.toString().padStart(20, '0')}`}, now() - ${expiredAgo}::interval)
    RETURNING id`);
  return rows[0]?.id ?? '';
}

async function ids(table: 'auth_verifications' | 'auth_sessions') {
  const { rows } = await client.db.execute<{ id: string }>(
    sql`SELECT id FROM ${sql.identifier(table)}`,
  );
  return rows.map(({ id }) => id).sort();
}

describe.each([
  ['auth_verifications', 'purgeLapsedAuthVerifications', addVerification],
  ['auth_sessions', 'purgeLapsedAuthSessions', addSession],
] as const)('%s', (table, fn, add) => {
  it('deletes a row that expired 31 days ago and keeps one that expired 29 days ago, a recent one, and one not yet expired', async () => {
    await add('31 days');
    const kept = [
      await add('29 days'),
      await add('29 days 23 hours'),
      await add('1 minute'),
      await add('-1 day'),
    ].sort();

    expect(await purge[fn]()).toBe(1);

    expect(await ids(table)).toEqual(kept);
  });

  it('removes at most one batch per call, and the next call takes the rest', async () => {
    const insert =
      table === 'auth_verifications'
        ? sql`INSERT INTO auth_verifications (identifier, value, expires_at)
            SELECT 'magic-link:' || lpad(to_hex(n), 64, '0'), 'guest@example.com', now() - interval '31 days'
            FROM generate_series(1, 1100) AS n`
        : sql`INSERT INTO auth_sessions (user_id, token, expires_at)
            SELECT ${userId}, 'token-' || lpad(n::text, 20, '0'), now() - interval '31 days'
            FROM generate_series(1, 1100) AS n`;
    await client.db.execute(insert);

    expect(await purge[fn]()).toBe(1000);
    expect(await purge[fn]()).toBe(100);
    expect(await purge[fn]()).toBe(0);
  });
});

it('purges one table without touching the other', async () => {
  await addVerification('31 days');
  const session = await addSession('31 days');

  await purge.purgeLapsedAuthVerifications();

  expect(await ids('auth_verifications')).toEqual([]);
  expect(await ids('auth_sessions')).toEqual([session]);
});

it('leaves the sign-in user when its lapsed session is deleted', async () => {
  await addSession('31 days');

  await purge.purgeLapsedAuthSessions();

  const { rows } = await client.db.execute(
    sql`SELECT 1 FROM auth_users WHERE id = ${userId}`,
  );
  expect(rows).toHaveLength(1);
});
