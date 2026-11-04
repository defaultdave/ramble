import { beforeAll, describe, expect, it, vi } from 'vitest';
import { sql } from 'drizzle-orm';
import { client, fakeEvent, post, setupEmailDatabase } from './emailFixtures';

vi.mock('@/server/env', async () => ({
  env: (await import('./emailFixtures')).testEnv,
}));

// Behaviours under test, one per decision, branch, or risk:
// - 20 failed verifications from one address are 401 and the 21st is 429 with Retry-After, while other addresses and verified requests still pass
// - the 601st verified request in a minute is 429, and failed verifications do not use that cap

setupEmailDatabase();

describe('webhook rate limiting with the real limiter', () => {
  // Start from an empty window so no earlier tries count against these.
  beforeAll(async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);
  });

  const bad = (address: string) => post('{}', { 'x-forwarded-for': address });

  it('answers 401 to 20 failed verifications from one address and 429 to the next, without touching other addresses or verified traffic', async () => {
    for (let n = 0; n < 20; n += 1) {
      expect((await bad('203.0.113.9')).status).toBe(401);
    }
    const refused = await bad('203.0.113.9');

    expect(refused.status).toBe(429);
    const retry = Number(refused.headers.get('retry-after'));
    expect(retry).toBeGreaterThanOrEqual(1);
    expect(retry).toBeLessThanOrEqual(600);
    expect((await bad('203.0.113.10')).status).toBe(401);
    const verified = await fakeEvent('fake-unknown', 'delivered');
    expect(verified.status).toBe(200);
  });

  it('refuses the 601st verified request in a minute and counts only verified ones against that cap', async () => {
    await client.db.execute(sql`DELETE FROM rate_limits`);

    // One real request opens the window; 600 more sequential requests cost about two seconds, so
    // the count is moved to 599 tries instead, which leaves the 600th to pass and the 601st to fail.
    expect((await fakeEvent('fake-unknown', 'delivered')).status).toBe(200);
    await client.db.execute(
      sql`UPDATE rate_limits SET count = 599 WHERE key LIKE 'email_webhook:%'`,
    );

    const last = await fakeEvent('fake-unknown', 'delivered');
    const refused = await fakeEvent('fake-unknown', 'delivered');

    expect(last.status).toBe(200);
    expect(refused.status).toBe(429);
    const retryAfter = Number(refused.headers.get('retry-after'));
    expect(retryAfter).toBeGreaterThanOrEqual(50);
    expect(retryAfter).toBeLessThanOrEqual(60);
    expect((await bad('198.51.100.1')).status).toBe(401);
  });
});
