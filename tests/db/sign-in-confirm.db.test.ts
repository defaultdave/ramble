import { sql } from 'drizzle-orm';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createFreshDatabase, type FreshDatabase } from './harness';

// Behaviours under test, against the real database and the real Better Auth, one per decision, branch, or risk:
// - the emailed address is the confirm page with the token and the checked destination, never the verify address, and an unsafe destination became home before the link was made
// - opening the confirm page, as a mail scanner does, any number of times leaves the link unused; only the post uses it
// - the post uses the link exactly once: it sets the session cookie and goes to the destination, and a second post is refused with no cookie
// - a post from another site, or with no Origin, is refused and leaves the link unused
// - a lapsed link and a token never issued are sent to /sign-in with the error and set no cookie
// - sign out ends the session: the cookie is cleared and the old cookie reads as anonymous

const origin = 'http://localhost:3000';

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let forms: typeof import('@/server/auth/forms');
let session: typeof import('@/server/auth/session');
let action: typeof import('@/server/actions/signIn');
let confirmPage: typeof import('@/app/(guest)/sign-in/confirm/ConfirmContent');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  forms = await import('@/server/auth/forms');
  session = await import('@/server/auth/session');
  action = await import('@/server/actions/signIn');
  confirmPage = await import('@/app/(guest)/sign-in/confirm/ConfirmContent');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
const newEmail = () => `confirm${String((counter += 1))}@example.com`;

const form = (fields: Record<string, string>) => {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
};

/** Asks for a link through the sign-in form's action and returns the address in the email. */
async function emailedLink(address: string, next = '/account') {
  const state = await action.requestSignInLink(
    { status: 'idle' },
    form({ email: address, next }),
  );
  expect(state.status).toBe('sent');
  const { rows } = await client.db.execute<{ html: string }>(
    sql`SELECT html FROM messages WHERE recipient = ${address} AND template = 'sign-in-link' ORDER BY created_at DESC, id DESC LIMIT 1`,
  );
  const hrefs = [...(rows[0]?.html ?? '').matchAll(/href="([^"]*)"/g)].map(
    (match) => (match[1] ?? '').replaceAll('&amp;', '&'),
  );
  const url = hrefs.find((candidate) => candidate.includes('token='));
  if (!url) throw new Error('no sign-in link in the email');
  return { url, token: new URL(url).searchParams.get('token') ?? '' };
}

const pendingLinks = async () =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM auth_verifications WHERE identifier LIKE 'magic-link:%'`,
    )
  ).rows[0]?.n ?? 0;

const confirmPost = (
  token: string,
  next = '/account',
  headers: Record<string, string> = { origin },
) =>
  forms.handleConfirmSignIn(
    new Request(`${origin}/api/auth/confirm-sign-in`, {
      method: 'POST',
      headers: {
        'content-type': 'application/x-www-form-urlencoded',
        ...headers,
      },
      body: new URLSearchParams({ token, next }).toString(),
    }),
  );

const sessionCookie = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((header) => header.split(';')[0])
    .find((pair) => pair?.includes('session_token=')) ?? '';

describe('the emailed link', () => {
  it('opens the confirm page with the token and the destination, not the verify address', async () => {
    const { url, token } = await emailedLink(newEmail(), '/account');

    const parsed = new URL(url);
    expect(parsed.origin).toBe(origin);
    expect(parsed.pathname).toBe('/sign-in/confirm');
    expect(parsed.searchParams.get('next')).toBe('/account');
    expect(token).toMatch(/^[A-Za-z]{32}$/);
    expect(url).not.toContain('/api/auth');
  });

  it.each([
    ['a protocol-relative address', '//evil.com'],
    ['an absolute address', 'https://evil.com/account'],
    ['a backslash address', '/\\evil.com'],
    ['a dot segment before a second slash', '/.//evil.com'],
    ['an encoded dot segment before a second slash', '/%2e//evil.com'],
    ['a dot-dot segment before a second slash', '/a/..//evil.com'],
  ])('carries home when the destination is %s', async (_label, next) => {
    const { url } = await emailedLink(newEmail(), next);

    expect(new URL(url).searchParams.get('next')).toBe('/');
  });
});

describe('opening the confirm page', () => {
  it('leaves the link unused however often it is opened, and the post then uses it once', async () => {
    const { token } = await emailedLink(newEmail());
    const before = await pendingLinks();

    for (let scan = 0; scan < 3; scan += 1) {
      const page = renderToStaticMarkup(
        await confirmPage.ConfirmContent({
          searchParams: Promise.resolve({ token, next: '/account' }),
        }),
      );
      expect(page).toContain(`value="${token}"`);
    }
    expect(await pendingLinks()).toBe(before);

    const first = await confirmPost(token);
    expect(first.status).toBe(303);
    expect(first.headers.get('location')).toBe(`${origin}/account`);
    expect(sessionCookie(first)).toContain('session_token=');
    expect(await pendingLinks()).toBe(before - 1);

    const second = await confirmPost(token);
    expect(second.status).toBe(303);
    expect(second.headers.get('location')).toBe(
      `${origin}/sign-in?next=%2Faccount&error=INVALID_TOKEN`,
    );
    expect(sessionCookie(second)).toBe('');
  });

  it('exports no GET handler, so a prefetch of the post address uses nothing', async () => {
    const route = await import('@/app/api/auth/confirm-sign-in/route');

    expect(Object.keys(route)).toEqual(['POST']);
  });
});

describe('the confirm post', () => {
  it.each([
    ['another site', { origin: 'https://evil.com' }],
    ['no Origin', {}],
  ])(
    'from %s is refused and leaves the link unused',
    async (_label, headers) => {
      const { token } = await emailedLink(newEmail());
      const before = await pendingLinks();

      const response = await confirmPost(token, '/account', headers);

      expect(response.status).toBe(403);
      expect(sessionCookie(response)).toBe('');
      expect(await pendingLinks()).toBe(before);
    },
  );

  it('sends a lapsed link to /sign-in with the error and sets no cookie', async () => {
    const { token } = await emailedLink(newEmail());
    await client.db.execute(
      sql`UPDATE auth_verifications SET expires_at = now() - interval '1 second' WHERE identifier LIKE 'magic-link:%'`,
    );

    const response = await confirmPost(token);

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toContain('error=INVALID_TOKEN');
    expect(sessionCookie(response)).toBe('');
  });

  it('sends a token that was never issued to /sign-in with the error', async () => {
    const response = await confirmPost('x'.repeat(32));

    expect(response.headers.get('location')).toBe(
      `${origin}/sign-in?next=%2Faccount&error=INVALID_TOKEN`,
    );
    expect(sessionCookie(response)).toBe('');
  });

  it('turns an unsafe destination into home after a good link', async () => {
    const { token } = await emailedLink(newEmail());

    const response = await confirmPost(token, '//evil.com');

    expect(response.headers.get('location')).toBe(`${origin}/`);
  });
});

describe('signing out', () => {
  it('ends the session: the cookie is cleared and the old cookie reads as anonymous', async () => {
    const { token } = await emailedLink(newEmail());
    const cookie = sessionCookie(await confirmPost(token));
    const signedIn = await session.readSession(new Headers({ cookie }));
    expect(signedIn).not.toBeNull();

    const response = await forms.handleEndSession(
      new Request(`${origin}/api/auth/end-session`, {
        method: 'POST',
        headers: { origin, cookie },
      }),
    );

    expect(response.status).toBe(303);
    expect(response.headers.get('location')).toBe('/');
    expect(response.headers.getSetCookie().join(';')).toMatch(
      /session_token=;|Max-Age=0/,
    );
    expect(await session.readSession(new Headers({ cookie }))).toBeNull();
  });

  it('is refused from another site and leaves the session alive', async () => {
    const { token } = await emailedLink(newEmail());
    const cookie = sessionCookie(await confirmPost(token));

    const response = await forms.handleEndSession(
      new Request(`${origin}/api/auth/end-session`, {
        method: 'POST',
        headers: { origin: 'https://evil.com', cookie },
      }),
    );

    expect(response.status).toBe(403);
    expect(await session.readSession(new Headers({ cookie }))).not.toBeNull();
  });
});
