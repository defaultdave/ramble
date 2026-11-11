import { afterAll, beforeAll, describe, it, vi } from 'vitest';
import { hosts } from '@/server/db/schema';
import {
  createFreshDatabase,
  expectConstraint,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, against the real database:
// - a host name over 120, a slug over 80, a blank or over-long description, and a time zone over 64 characters are refused by a CHECK
// - the largest values the form accepts are stored

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
}, 120_000);

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
const next = () => (counter += 1);

describe('the database refuses what Zod refuses on a host', () => {
  const insert = (values: Record<string, unknown>) =>
    client.db.insert(hosts).values({
      slug: `db-${String(next())}`,
      name: 'Host',
      timeZone: 'UTC',
      ...values,
    });

  it.each([
    [
      'a name over 120 characters',
      'hosts_name_length',
      { name: 'a'.repeat(121) },
    ],
    [
      'a slug over 80 characters',
      'hosts_slug_length',
      { slug: 'a'.repeat(81) },
    ],
    [
      'a description over 2000 characters',
      'hosts_description_shape',
      { description: 'a'.repeat(2001) },
    ],
    ['a blank description', 'hosts_description_shape', { description: '  ' }],
    [
      'a time zone over 64 characters',
      'hosts_time_zone_length',
      { timeZone: 'A'.repeat(65) },
    ],
  ])('refuses %s', async (_label, constraint, values) => {
    await expectConstraint(insert(values), constraint);
  });

  it('accepts the largest values the form accepts', async () => {
    await insert({
      name: 'a'.repeat(120),
      slug: 'a'.repeat(80),
      description: 'a'.repeat(2000),
    });
  });
});
