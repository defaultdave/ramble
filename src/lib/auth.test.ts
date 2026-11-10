import { describe, expect, it } from 'vitest';
import {
  initialSessionExpiry,
  isSessionLive,
  isSignInLinkRequest,
  pickAuthSecret,
  sessionIdleSeconds,
  sessionMaxAgeSeconds,
  SignInLinkRequestSchema,
  signInLinkTtlSeconds,
  touchedSessionExpiry,
} from './auth';

// Behaviours under test, one per decision, branch, or risk:
// - the numbers: a link lasts 5 minutes, a session 8 hours, idle 30 minutes
// - a session is live before its deadline and before the ceiling, and not at either
// - a request moves the deadline to the idle window from now, never past the ceiling, and writes nothing inside one touch interval
// - only POST to the sign-in link path is a sign-in link request
// - the sign-in body's address is folded to lower case, and a bad one is refused rather than repaired
// - each secret is the configured one; a stand-in outside production, distinct per secret; none in production

const minute = 60_000;
const created = new Date('2026-11-10T09:00:00.000Z');
const at = (minutes: number) => new Date(created.getTime() + minutes * minute);

describe('the sign-in numbers', () => {
  it('are 5 minutes for a link, 8 hours for a session, and 30 minutes idle', () => {
    expect([
      signInLinkTtlSeconds,
      sessionMaxAgeSeconds,
      sessionIdleSeconds,
    ]).toEqual([300, 28_800, 1800]);
  });
});

describe('initialSessionExpiry', () => {
  it('is the idle window from the first moment', () => {
    expect(initialSessionExpiry(created)).toEqual(at(30));
  });
});

describe('isSessionLive', () => {
  it.each([
    ['live inside both', at(29), at(30), true],
    ['past its deadline', at(31), at(30), false],
    ['exactly at its deadline', at(30), at(30), false],
    ['past the ceiling with a later deadline', at(481), at(500), false],
    ['exactly at the ceiling', at(480), at(500), false],
    ['just before the ceiling', at(479), at(500), true],
  ])('%s', (_name, now, expiresAt, live) => {
    expect(isSessionLive({ createdAt: created, expiresAt }, now)).toBe(live);
  });
});

describe('touchedSessionExpiry', () => {
  it.each([
    ['moves the deadline a full idle window on', at(10), at(25), at(40)],
    ['moves it when the touch interval has passed', at(10), at(39), at(40)],
    ['writes nothing inside one touch interval', at(10), at(39.5), null],
    ['writes nothing when the deadline is already later', at(10), at(60), null],
    ['stops at the ceiling', at(470), at(475), at(480)],
    ['writes nothing once the deadline is the ceiling', at(475), at(480), null],
  ])('%s', (_name, now, expiresAt, expected) => {
    expect(
      touchedSessionExpiry({ createdAt: created, expiresAt }, now),
    ).toEqual(expected);
  });
});

describe('isSignInLinkRequest', () => {
  it.each([
    ['POST', '/api/auth/sign-in/magic-link', true],
    ['GET', '/api/auth/sign-in/magic-link', false],
    ['POST', '/api/auth/sign-in/magic-link/', false],
    ['POST', '/api/auth/sign-in/email', false],
    ['GET', '/api/auth/magic-link/verify', false],
  ])('%s %s is %s', (method, pathname, expected) => {
    expect(isSignInLinkRequest(method, pathname)).toBe(expected);
  });
});

describe('SignInLinkRequestSchema', () => {
  it('folds the address to lower case and keeps the other keys for Better Auth', () => {
    expect(
      SignInLinkRequestSchema.parse({
        email: 'Sam@Example.COM',
        callbackURL: '/account',
      }),
    ).toEqual({ email: 'sam@example.com', callbackURL: '/account' });
  });

  it.each([
    ['no address', {}],
    ['a number', { email: 5 }],
    ['no at sign', { email: 'sam' }],
    ['a display name', { email: 'Sam <sam@example.com>' }],
    ['two addresses', { email: 'a@example.com,b@example.com' }],
    ['a line break', { email: 'sam@example.com\nbcc: x@example.com' }],
    ['over 254 characters', { email: `${'a'.repeat(250)}@example.com` }],
  ])('refuses %s', (_name, body) => {
    expect(SignInLinkRequestSchema.safeParse(body).success).toBe(false);
  });
});

describe('pickAuthSecret', () => {
  it.each(['development', 'test', 'production'] as const)(
    'uses the configured secret in %s',
    (nodeEnv) => {
      expect(pickAuthSecret('betterAuth', 'x'.repeat(40), nodeEnv)).toBe(
        'x'.repeat(40),
      );
    },
  );

  it.each(['development', 'test'] as const)(
    'stands in with a fixed, different secret per kind in %s',
    (nodeEnv) => {
      const session = pickAuthSecret('betterAuth', undefined, nodeEnv);
      const link = pickAuthSecret('signInLink', undefined, nodeEnv);

      expect(session).not.toBeNull();
      expect(link).not.toBeNull();
      expect(session).not.toBe(link);
    },
  );

  it.each(['betterAuth', 'signInLink'] as const)(
    'gives none for %s in production, so the caller throws',
    (kind) => {
      expect(pickAuthSecret(kind, undefined, 'production')).toBeNull();
    },
  );
});
