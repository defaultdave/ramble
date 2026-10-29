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
import { insertHold, seedBookable } from './holdFixtures';

const sendHeartbeat = vi.hoisted(() => vi.fn());
const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);
vi.mock('@/server/monitoring/heartbeat', () => ({ sendHeartbeat }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, against a real database and the real limiter, drain, and purge:
// - a wrong secret gets 401, writes a count on the failure surface, and runs no job
// - a source past 20 wrong secrets gets 429
// - the right secret drains a due job, answers counts only, and pings the heartbeat once
// - the pulse deletes expired rate-limit rows and keeps live ones
// - the pulse releases lapsed holds and scrubs old released ones at database time, even for a manual asOf
// - a manual asOf with DEMO_CLOCK on runs a job scheduled for tomorrow, and sends no heartbeat
// - the same asOf with DEMO_CLOCK off is refused with 400 and the job stays pending

const secret = 'p'.repeat(40);
let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let pulse: typeof import('@/server/pulse');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  vi.stubEnv('PULSE_SECRET', secret);
  vi.stubEnv('DEMO_CLOCK', 'on');
  client = await import('@/server/db/client');
  pulse = await import('@/server/pulse');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  sendHeartbeat.mockReset().mockResolvedValue('sent');
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM rate_limits`);
  await client.db.execute(sql`TRUNCATE hold_items, holds CASCADE`);
  cache.revalidateTag.mockClear();
});

const call = (headers: Record<string, string>, body?: string) =>
  pulse.pulseResponse(
    new Request('http://localhost/api/pulse', {
      method: 'POST',
      headers,
      ...(body === undefined ? {} : { body }),
    }),
  );
const authorized = { authorization: `Bearer ${secret}` };

async function statuses() {
  const { rows } = await client.db.execute<{ status: string }>(
    sql`SELECT status FROM jobs`,
  );
  return rows.map((row) => row.status);
}

describe('POST /api/pulse against a database', () => {
  it('refuses a wrong secret, counts it, and runs nothing', async () => {
    await client.db.execute(
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('noop', '{}', '2026-01-01T00:00:00Z')`,
    );

    const response = await call({ authorization: 'Bearer wrong' });

    expect(response.status).toBe(401);
    expect(await statuses()).toEqual(['pending']);
    const { rows } = await client.db.execute<{ key: string }>(
      sql`SELECT key FROM rate_limits`,
    );
    expect(rows.map((row) => row.key.split(':')[0])).toEqual(['pulse_failed']);
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it('answers 429 after 20 wrong secrets from one source', async () => {
    const statusesSeen: number[] = [];
    for (let index = 0; index < 21; index += 1) {
      statusesSeen.push((await call({ authorization: 'Bearer wrong' })).status);
    }

    expect(statusesSeen.slice(0, 20).every((status) => status === 401)).toBe(
      true,
    );
    expect(statusesSeen[20]).toBe(429);
  });

  it('drains a due job, purges expired limits, pings once, and answers counts only', async () => {
    await client.db.execute(
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('noop', '{"note":"private"}', '2026-01-01T00:00:00Z')`,
    );
    await client.db.execute(
      sql`INSERT INTO rate_limits (key, count, window_started_at, expires_at)
        VALUES (${`forms:${'a'.repeat(64)}`}, 1, now() - interval '2 hours', now() - interval '1 hour'),
               (${`forms:${'b'.repeat(64)}`}, 1, now(), now() + interval '1 hour')`,
    );

    const response = await call(authorized);

    expect(response.status).toBe(200);
    const text = await response.text();
    expect(text).not.toContain('private');
    expect(JSON.parse(text)).toEqual({
      claimed: 1,
      succeeded: 1,
      retried: 0,
      dead: 0,
      lost: 0,
      unrecorded: 0,
      left: 0,
      purged: 1,
      holdsReleased: 0,
      holdsScrubbed: 0,
    });
    expect(await statuses()).toEqual(['succeeded']);
    expect(sendHeartbeat).toHaveBeenCalledOnce();
    const { rows } = await client.db.execute<{ key: string }>(
      sql`SELECT key FROM rate_limits WHERE key LIKE 'forms:%'`,
    );
    expect(rows).toEqual([{ key: `forms:${'b'.repeat(64)}` }]);
  });

  it('releases a lapsed hold and scrubs an old released one, at database time, even for a manual asOf', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await insertHold(client.db, bookable.session.id, {
      createdAt: sql`now() - interval '20 minutes'`,
    });
    const open = await insertHold(client.db, bookable.session.id);
    const old = await insertHold(client.db, bookable.session.id, {
      createdAt: sql`now() - interval '41 days'`,
      status: 'released',
      releasedReason: 'expired',
      updatedAt: sql`now() - interval '40 days'`,
    });
    const farFuture = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

    const response = await call(
      authorized,
      JSON.stringify({ asOf: farFuture }),
    );

    expect(await response.json()).toMatchObject({
      holdsReleased: 1,
      holdsScrubbed: 1,
    });
    const { rows } = await client.db.execute<{
      id: string;
      status: string;
      device_key: string;
    }>(sql`SELECT id, status, device_key FROM holds`);
    const byId = new Map(rows.map((row) => [row.id, row]));
    expect(byId.get(lapsed.id)?.status).toBe('released');
    expect(byId.get(open.id)?.status).toBe('active');
    expect(byId.get(old.id)?.device_key).toBe('0'.repeat(64));
    expect(cache.revalidateTag).toHaveBeenCalledExactlyOnceWith(
      `session:${bookable.session.id}`,
      'max',
    );
  });

  it("runs tomorrow's job for a manual asOf, with no heartbeat", async () => {
    await client.db.execute(
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('noop', '{}', now() + interval '1 day')`,
    );
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

    const response = await call(authorized, JSON.stringify({ asOf: tomorrow }));

    expect(response.status).toBe(200);
    expect(await statuses()).toEqual(['succeeded']);
    expect(sendHeartbeat).not.toHaveBeenCalled();
  });

  it("leaves tomorrow's job pending on a plain pulse", async () => {
    await client.db.execute(
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('noop', '{}', now() + interval '1 day')`,
    );

    await call(authorized);

    expect(await statuses()).toEqual(['pending']);
  });
});

describe('with DEMO_CLOCK off', () => {
  it('refuses asOf and runs nothing', async () => {
    vi.stubEnv('DEMO_CLOCK', 'off');
    vi.resetModules();
    const { pulseResponse } = await import('@/server/pulse');
    await client.db.execute(
      sql`INSERT INTO jobs (kind, payload, run_after) VALUES ('noop', '{}', now() + interval '1 day')`,
    );
    const tomorrow = new Date(Date.now() + 25 * 60 * 60 * 1000).toISOString();

    const response = await pulseResponse(
      new Request('http://localhost/api/pulse', {
        method: 'POST',
        headers: authorized,
        body: JSON.stringify({ asOf: tomorrow }),
      }),
    );

    expect(response.status).toBe(400);
    expect(await statuses()).toEqual(['pending']);
    await (await import('@/server/db/client')).db.$client.end();
    vi.stubEnv('DEMO_CLOCK', 'on');
  });
});
