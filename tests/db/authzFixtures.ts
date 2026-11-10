import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, expect, vi } from 'vitest';
import type { Caller } from '@/server/auth/caller';
import { personaKeys, personas, type PersonaKey } from '@/lib/seed/personas';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

const origin = 'http://localhost:3000';

export const subjects = ['anonymous', ...personaKeys] as const;
export type Subject = (typeof subjects)[number];

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
export let client: typeof import('@/server/db/client');
export let personaSeed: typeof import('@/server/db/seed/personas');
let handle: typeof import('@/server/auth/handler').handleAuthRequest;
let callers: typeof import('@/server/auth/caller');

/** The seed's clock: far from the real one, so what the seed writes does not depend on when the suite runs. */
export const seedNow = new Date('2026-10-28T15:00:00Z');

/**
 * Opens a fresh database for the file that calls it, runs the seed with its personas, and loads
 * the modules that read DATABASE_URL. The file mocks `next/cache` itself.
 */
export function setupAuthzDatabase() {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    stopHttp = await serveNeonHttp(fresh.url);
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    handle = (await import('@/server/auth/handler')).handleAuthRequest;
    callers = await import('@/server/auth/caller');
    personaSeed = await import('@/server/db/seed/personas');
    const { seedCaller } = await import('@/server/db/seed/caller');
    await (
      await import('@/server/db/seed/run')
    ).runSeed({ caller: seedCaller, now: seedNow });
    await personaSeed.seedPersonas(seedCaller);
  }, 120_000);

  afterAll(async () => {
    await client.db.$client.end();
    await stopHttp();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });
}

/** Asks for a sign-in link the way the form does, and returns the address the email carries. */
async function linkFor(address: string) {
  const response = await handle(
    new Request(`${origin}/api/auth/sign-in/magic-link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin },
      body: JSON.stringify({ email: address, callbackURL: '/' }),
    }),
  );
  expect(response.status).toBe(200);
  const { rows } = await client.db.execute<{ html: string }>(
    sql`SELECT html FROM messages WHERE recipient = ${address} AND template = 'sign-in-link' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const href = /href="([^"]*sign-in\/confirm[^"]*)"/.exec(
    rows[0]?.html ?? '',
  )?.[1];
  if (!href) throw new Error('no sign-in link in the email');
  const token =
    new URL(href.replaceAll('&amp;', '&')).searchParams.get('token') ?? '';
  // The email opens the confirm page; these tests are about who the session is, so they use the verify address it posts to.
  return `${origin}/api/auth/magic-link/verify?token=${token}&callbackURL=%2F`;
}

/** Follows the link and returns the session cookie it sets. */
async function signInCookie(address: string): Promise<string> {
  const response = await handle(
    new Request(await linkFor(address), {
      headers: {
        'user-agent': 'Mozilla/5.0 (test)',
        'x-forwarded-for': '203.0.113.7',
      },
    }),
  );
  expect(response.status).toBe(302);
  const cookie = response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .find((pair) => pair?.includes('session_token'));
  if (!cookie) throw new Error('the link set no session cookie');
  return cookie;
}

/** What a request with this cookie is: the caller the data layer will see. */
const callerForCookie = (cookie: string): Promise<Caller> =>
  callers.callerForHeaders(new Headers({ cookie }));

/** Every subject as the caller a real sign-in by link gives: nobody for anonymous, the seeded person otherwise. */
export async function signInEverySubject(): Promise<Record<Subject, Caller>> {
  const signedIn = await Promise.all(
    personaKeys.map(
      async (key) =>
        [
          key,
          await callerForCookie(await signInCookie(personas[key].email)),
        ] as const,
    ),
  );
  return {
    anonymous: callers.anonymousCaller,
    ...(Object.fromEntries(signedIn) as Record<PersonaKey, Caller>),
  };
}
