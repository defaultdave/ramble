import { afterEach, describe, expect, it, vi } from 'vitest';

// Behaviours under test:
// - the token is 32 letters, and two tokens differ
// - what is stored is the plugin's prefix and the keyed hash of the token, never the token, with the record the verify step parses
// - the stored link lapses after the sign-in link lifetime, by the clock
// - appOrigin is the origin of APP_URL, without its path

const create = vi.fn();
const now = new Date('2026-11-11T12:00:00Z');

async function load() {
  vi.resetModules();
  create.mockReset();
  vi.doMock('server-only', () => ({}));
  vi.doMock('@/server/env', () => ({
    env: { APP_URL: 'https://ramble.example/some/path' },
  }));
  vi.doMock('@/server/ports/clock', () => ({
    systemClock: { now: () => now },
  }));
  vi.doMock('./auth', () => ({
    getAuth: () => ({
      $context: Promise.resolve({
        internalAdapter: { createVerificationValue: create },
      }),
    }),
  }));
  vi.doMock('./signInToken', () => ({
    hashSignInToken: (token: string) =>
      Promise.resolve(
        'a'.repeat(60).concat(String(token.length)).padEnd(64, 'b'),
      ),
  }));
  return import('./signInLink');
}

afterEach(() => {
  vi.doUnmock('@/server/env');
  vi.doUnmock('@/server/ports/clock');
  vi.doUnmock('./auth');
  vi.doUnmock('./signInToken');
});

describe('createSignInLinkToken', () => {
  it('returns 32 letters, and a different token each time', async () => {
    const { createSignInLinkToken } = await load();

    const first = await createSignInLinkToken('a@example.com');
    const second = await createSignInLinkToken('a@example.com');

    expect(first).toMatch(/^[A-Za-z]{32}$/);
    expect(second).not.toBe(first);
  });

  it('stores the hashed identifier and the verify record, lapsing after five minutes', async () => {
    const { createSignInLinkToken } = await load();

    const token = await createSignInLinkToken('a@example.com');

    const [stored] = create.mock.calls[0] as [
      { identifier: string; value: string; expiresAt: Date },
    ];
    expect(stored.identifier).toMatch(/^magic-link:[0-9a-f]{64}$/);
    expect(stored.identifier).not.toContain(token);
    expect(JSON.parse(stored.value)).toEqual({
      type: 'magic-link',
      email: 'a@example.com',
    });
    expect(stored.expiresAt).toEqual(new Date('2026-11-11T12:05:00Z'));
  });
});

describe('appOrigin', () => {
  it('is the origin of APP_URL', async () => {
    const { appOrigin } = await load();

    expect(appOrigin()).toBe('https://ramble.example');
  });
});
