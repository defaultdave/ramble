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

// Behaviours under test, against the real database and the real Better Auth, one per decision, branch, or risk:
// - in sink mode a guest address (new or already an account) is answered with the confirm page's path, and that link signs in once, makes the account, and lapses after 5 minutes like the emailed one
// - in sink mode an address holding any role grant is answered exactly as in a mode that emails: the same two fields, no link, and its link goes to the mailbox only
// - spellings of a role holder's address (case, surrounding spaces) are still the role holder
// - in a mode other than sink nothing is shown on the page, whoever asks
// - an on-screen link is never answered for the API address, which has no way to ask for it
// - the on-screen answer is no-store

const origin = 'http://localhost:3000';
const mode = vi.hoisted(() => ({ value: 'sink' }));

vi.mock('@/server/ports/email/config', async (importOriginal) => {
  const real =
    await importOriginal<typeof import('@/server/ports/email/config')>();
  return {
    ...real,
    getEmailConfig: () => ({ ...real.getEmailConfig(), mode: mode.value }),
  };
});

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let action: typeof import('@/server/actions/signIn');
let forms: typeof import('@/server/auth/forms');
let handler: typeof import('@/server/auth/handler');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  action = await import('@/server/actions/signIn');
  forms = await import('@/server/auth/forms');
  handler = await import('@/server/auth/handler');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  mode.value = 'sink';
});

let counter = 0;
const newEmail = () => `onscreen${String((counter += 1))}@example.com`;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

const ask = (email: string, next = '/account') =>
  action.requestSignInLink({ status: 'idle' }, form({ email, next }));

async function addAccount(email: string, role?: 'ops' | 'host_owner') {
  const { rows } = await client.db.execute<{ id: string }>(
    sql`INSERT INTO auth_users (email, email_verified) VALUES (${email}, true) RETURNING id`,
  );
  const userId = rows[0]?.id ?? '';
  if (role === 'ops') {
    await client.db.execute(
      sql`INSERT INTO role_grants (user_id, role) VALUES (${userId}, 'ops')`,
    );
  } else if (role === 'host_owner') {
    const host = await client.db.execute<{ id: string }>(
      sql`INSERT INTO hosts (slug, name, time_zone) VALUES (${`host-${String(counter)}`}, 'Host', 'America/New_York') RETURNING id`,
    );
    await client.db.execute(
      sql`INSERT INTO role_grants (user_id, role, host_id) VALUES (${userId}, 'host_owner', ${host.rows[0]?.id ?? ''})`,
    );
  }
}

const mailTo = async (address: string) =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM messages WHERE recipient = ${address} AND template = 'sign-in-link'`,
    )
  ).rows[0]?.n ?? 0;

const accountCount = async (address: string) =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_users WHERE email = ${address}`,
    )
  ).rows[0]?.n ?? 0;

const confirmPost = (token: string, next = '/account') =>
  forms.handleConfirmSignIn(
    new Request(`${origin}/api/auth/confirm-sign-in`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        origin,
      },
      body: new URLSearchParams({ token, next }).toString(),
    }),
  );

const tokenOf = (href: string) =>
  new URL(href, origin).searchParams.get('token') ?? '';

describe('a guest address in sink mode', () => {
  it('gets the link on the page, and the link signs in once and makes the account', async () => {
    const address = newEmail();
    expect(await accountCount(address)).toBe(0);

    const state = await ask(address, '/account');

    if (state.status !== 'link') throw new Error(`got ${state.status}`);
    const href = new URL(state.href, origin);
    expect(href.pathname).toBe('/sign-in/confirm');
    expect(href.searchParams.get('next')).toBe('/account');
    expect(tokenOf(state.href)).toMatch(/^[A-Za-z]{32}$/);
    expect(await accountCount(address)).toBe(0);

    const first = await confirmPost(tokenOf(state.href));
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`${origin}/account`);
    expect(first.headers.getSetCookie().join(';')).toContain('session_token=');
    expect(await accountCount(address)).toBe(1);

    const second = await confirmPost(tokenOf(state.href));
    expect(second.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(second.headers.getSetCookie().join(';')).not.toContain(
      'session_token=',
    );
  });

  it('gets the link on the page for an existing account with no grant, and it lapses after 5 minutes', async () => {
    const address = newEmail();
    await addAccount(address);

    const state = await ask(address);

    if (state.status !== 'link') throw new Error(`got ${state.status}`);
    const { rows } = await client.db.execute<{ seconds: number }>(
      sql`SELECT extract(epoch FROM (expires_at - now()))::float AS seconds FROM auth_verifications WHERE identifier LIKE 'magic-link:%' ORDER BY expires_at DESC LIMIT 1`,
    );
    expect(rows[0]?.seconds).toBeGreaterThan(280);
    expect(rows[0]?.seconds).toBeLessThanOrEqual(300);
    await client.db.execute(
      sql`UPDATE auth_verifications SET expires_at = now() - interval '1 second' WHERE identifier LIKE 'magic-link:%'`,
    );
    const lapsed = await confirmPost(tokenOf(state.href));
    expect(lapsed.headers.get('location')).toContain('error=INVALID_TOKEN');
  });
});

describe('an address holding a role grant in sink mode', () => {
  it.each([['ops' as const], ['host_owner' as const]])(
    'with %s is answered as a mode that emails answers, and its link goes to the mailbox only',
    async (role) => {
      const address = newEmail();
      await addAccount(address, role);

      const state = await ask(address);

      expect(state).toEqual({ status: 'sent', email: address });
      expect(Object.keys(state).sort()).toEqual(['email', 'status']);
      expect(await mailTo(address)).toBe(1);
    },
  );

  it.each([
    ['upper case', (address: string) => address.toUpperCase()],
    [
      'mixed case',
      (address: string) =>
        address.replace(/^o/, 'O').replace('@example', '@Example'),
    ],
    ['surrounding spaces', (address: string) => `  ${address}  `],
  ])('is still a role holder when typed in %s', async (_label, spell) => {
    const address = newEmail();
    await addAccount(address, 'ops');

    const state = await ask(spell(address));

    expect(state).toEqual({ status: 'sent', email: address });
    expect(await mailTo(address)).toBe(1);
  });

  it('gets the same reply as a guest does in a mode that emails', async () => {
    const holder = newEmail();
    const guest = newEmail();
    await addAccount(holder, 'ops');
    const holderState = await ask(holder);
    mode.value = 'allowlist';

    const guestState = await ask(guest);

    expect(Object.keys(holderState).sort()).toEqual(
      Object.keys(guestState).sort(),
    );
    expect(holderState.status).toBe(guestState.status);
  });
});

describe('a mode other than sink', () => {
  it.each([['allowlist'], ['live']])(
    'shows no link on the page in %s mode, for a guest or a role holder',
    async (value) => {
      mode.value = value;
      const guest = newEmail();
      const holder = newEmail();
      await addAccount(holder, 'ops');

      expect(await ask(guest)).toEqual({ status: 'sent', email: guest });
      expect(await ask(holder)).toEqual({ status: 'sent', email: holder });
    },
  );
});

describe('the link on the page', () => {
  it('is never answered to the API address, which has no way to ask for it', async () => {
    const response = await handler.handleAuthRequest(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ email: newEmail(), callbackURL: '/' }),
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: true });
  });

  it('is sent no-store', async () => {
    const response = await handler.handleSignInFormRequest(
      new Request(`${origin}/api/auth/sign-in/magic-link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin },
        body: JSON.stringify({ email: newEmail(), callbackURL: '/' }),
      }),
    );

    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toMatchObject({ status: true });
  });
});
