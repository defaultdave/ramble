import { describe, expect, it } from 'vitest';
import {
  ConfirmSignInSchema,
  endSessionStatus,
  isOwnOrigin,
  rateLimitBody,
  signInFailureUrl,
  signInProblemCopy,
  signInSentBody,
  verifyErrorCallbackPath,
  verifyOutcome,
  safeNextPath,
  signInConfirmUrl,
  signInHref,
  signInProblemFor,
  signInStateFor,
} from './signIn';

// Behaviours under test, one per decision, branch or risk:
// - safeNextPath keeps a path on this site (with its query) and sends everything else home: absolute and protocol-relative addresses, backslash and control-character tricks, percent-encoded and double-encoded forms, a bad escape, an empty or too long value, and a value that is not a string
// - the emailed address is the confirm page, carries the token and the checked destination, and never the verify API
// - signInHref names the destination only when it is not home
// - the confirm post accepts a token of letters and digits and refuses an empty, long, or odd one
// - a failed link maps to a state: INVALID_TOKEN covers a used, lapsed, or unknown link; any other error is a failure; no error is no problem
// - the form's state follows the answer: 200 sent, 429 rate limited with a wait in whole minutes (at least one, at most a day), 400 invalid, anything else failed
// - a post is from this site only when its Origin is the app's origin

describe('safeNextPath', () => {
  it.each([
    ['a path', '/account', '/account'],
    ['a nested path', '/new-york/browse', '/new-york/browse'],
    [
      'a path with a query',
      '/new-york/browse?q=a%20b&page=2',
      '/new-york/browse?q=a%20b&page=2',
    ],
    ['the home page', '/', '/'],
    ['a path with a fragment, which a server never sees', '/a#frag', '/a'],
    ['a dot segment', '/a/../b', '/'],
    ['a leading dot segment before a second slash', '/.//evil.com', '/'],
    ['a dot-dot segment before a second slash', '/a/..//evil.com', '/'],
    ['a leading dot-dot before a second slash', '/..//evil.com', '/'],
    ['an encoded dot before a second slash', '/%2e//evil.com', '/'],
    ['an upper-case encoded dot before a second slash', '/%2E//evil.com', '/'],
    ['a single dot segment', '/./', '/'],
    ['encoded dot-dot segments', '/%2e%2e/', '/'],
    ['a dot, dot-dot, and a second slash', '/a/./..//x', '/'],
    ['a double-encoded dot before a second slash', '/%252e//evil.com', '/'],
    [
      'a dot segment after the query starts, which is data',
      '/a?b=/../c',
      '/a?b=/../c',
    ],
    ['a name that only contains dots', '/a/..b/c.d', '/a/..b/c.d'],
    ['an https address', 'https://evil.com', '/'],
    ['a protocol-relative address', '//evil.com', '/'],
    ['a protocol-relative address with a path', '//evil.com/account', '/'],
    ['a backslash after the slash', '/\\evil.com', '/'],
    ['two backslashes', '\\\\evil.com', '/'],
    ['a backslash inside a path', '/a\\b', '/'],
    ['a javascript address', 'javascript:alert(1)', '/'],
    ['a data address', 'data:text/html,hi', '/'],
    ['a tab inside the slashes', '/\t/evil.com', '/'],
    ['a newline before the path', '\n/evil.com', '/'],
    ['a carriage return in the path', '/a\r\nSet-Cookie: x=1', '/'],
    ['an encoded protocol-relative address', '%2F%2Fevil.com', '/'],
    ['an encoded second slash', '/%2Fevil.com', '/'],
    ['an encoded backslash', '/%5Cevil.com', '/'],
    ['an encoded tab', '/%09/evil.com', '/'],
    ['a double-encoded second slash', '/%252Fevil.com', '/'],
    ['a triple-encoded second slash', '/%25252Fevil.com', '/'],
    ['a fourth layer of encoding', '/%2525252Fevil.com', '/'],
    ['a bad escape', '/%E0%A4%A', '/'],
    ['no leading slash', 'account', '/'],
    ['an empty string', '', '/'],
    ['a string past the limit', `/${'a'.repeat(512)}`, '/'],
    ['undefined', undefined, '/'],
    ['null', null, '/'],
    ['a number', 5, '/'],
    ['a list', ['/a'], '/'],
  ])('given %s gives %s', (_label, input, expected) => {
    expect(safeNextPath(input)).toBe(expected);
  });

  it('keeps a path of exactly the limit', () => {
    const path = `/${'a'.repeat(511)}`;
    expect(safeNextPath(path)).toBe(path);
  });
});

describe('signInConfirmUrl', () => {
  it('points at the confirm page with the token and the checked destination', () => {
    expect(
      signInConfirmUrl('https://ramble.example', 'AbC123', '/account?tab=1'),
    ).toBe(
      'https://ramble.example/sign-in/confirm?token=AbC123&next=%2Faccount%3Ftab%3D1',
    );
  });

  it('never carries the verify address, and falls back home for an unsafe destination', () => {
    const url = signInConfirmUrl(
      'https://ramble.example',
      'AbC123',
      '//evil.com',
    );
    expect(url).not.toContain('/api/auth');
    expect(new URL(url).searchParams.get('next')).toBe('/');
  });
});

describe('signInHref', () => {
  it.each([
    ['the home page', '/', '/sign-in'],
    ['no destination', undefined, '/sign-in'],
    ['an unsafe destination', '//evil.com', '/sign-in'],
    ['a path', '/account', '/sign-in?next=%2Faccount'],
    ['a path with a query', '/a?b=c', '/sign-in?next=%2Fa%3Fb%3Dc'],
  ])('for %s gives %s', (_label, next, expected) => {
    expect(signInHref(next)).toBe(expected);
  });
});

describe('ConfirmSignInSchema', () => {
  it.each([
    [
      'a Better Auth token',
      { token: 'AbCdEfGhIjKlMnOpQrStUvWxYzAbCdEf' },
      true,
    ],
    ['a token with a destination', { token: 'abc123', next: '/a' }, true],
    ['an empty token', { token: '' }, false],
    ['a token with a symbol', { token: 'abc-123' }, false],
    ['a token with a space', { token: 'abc 123' }, false],
    ['a token of 128 characters', { token: 'a'.repeat(128) }, true],
    ['a token of 129 characters', { token: 'a'.repeat(129) }, false],
    [
      'a destination past the limit',
      { token: 'abc', next: 'a'.repeat(513) },
      false,
    ],
    ['no token', {}, false],
  ])('for %s: accepted is %s', (_label, input, accepted) => {
    expect(ConfirmSignInSchema.safeParse(input).success).toBe(accepted);
  });
});

describe('signInProblemFor', () => {
  it.each([
    ['no error', undefined, null],
    ['an empty error', '', null],
    ['INVALID_TOKEN', 'INVALID_TOKEN', 'link_invalid'],
    ['a failed session', 'failed_to_create_session', 'failed'],
    ['an unknown code', 'anything', 'failed'],
  ])('for %s gives %s', (_label, error, expected) => {
    expect(signInProblemFor(error)).toBe(expected);
  });
});

describe('signInStateFor', () => {
  const email = 'sam@example.com';

  it.each([
    ['200', 200, null, { status: 'sent', email }],
    ['400', 400, null, { status: 'invalid', email }],
    ['413', 413, null, { status: 'failed', email }],
    ['500', 500, null, { status: 'failed', email }],
    ['503', 503, null, { status: 'failed', email }],
  ])('maps %s', (_label, status, retryAfter, expected) => {
    expect(signInStateFor(email, status, retryAfter)).toEqual(expected);
  });

  it.each([
    ['an hour', '3600', 60],
    ['90 seconds, rounded up', '90', 2],
    ['one second, at least a minute', '1', 1],
    ['zero, at least a minute', '0', 1],
    ['no header, at least a minute', null, 1],
    ['text, at least a minute', 'soon', 1],
    ['a negative number, at least a minute', '-5', 1],
    ['a week, held to a day', '604800', 1440],
    ['a number of 8 digits, treated as unreadable', '99999999', 1],
  ])('names the wait for %s', (_label, header, minutes) => {
    expect(signInStateFor(email, 429, header)).toEqual({
      status: 'rate_limited',
      email,
      retryAfterMinutes: minutes,
    });
  });
});

describe('isOwnOrigin', () => {
  it.each([
    ['the same origin', 'http://localhost:3000', true],
    ['another origin', 'https://evil.com', false],
    ['the same host on another port', 'http://localhost:3001', false],
    ['the string null a sandboxed page sends', 'null', false],
    ['no Origin', null, false],
  ])('for %s: %s', (_label, origin, expected) => {
    expect(isOwnOrigin(origin, 'http://localhost:3000')).toBe(expected);
  });

  it.each([
    [
      'null Origin with same-origin Sec-Fetch-Site',
      'null',
      'same-origin',
      true,
    ],
    ['no Origin with same-origin Sec-Fetch-Site', null, 'same-origin', true],
    ['null Origin with same-site Sec-Fetch-Site', 'null', 'same-site', false],
    ['null Origin with cross-site Sec-Fetch-Site', 'null', 'cross-site', false],
    ['null Origin with no Sec-Fetch-Site', 'null', null, false],
    ['no Origin with no Sec-Fetch-Site', null, null, false],
    [
      'a foreign Origin even with same-origin Sec-Fetch-Site',
      'https://evil.com',
      'same-origin',
      false,
    ],
    [
      'the right Origin with cross-site Sec-Fetch-Site',
      'http://localhost:3000',
      'cross-site',
      true,
    ],
  ])('for %s: %s', (_label, origin, fetchSite, expected) => {
    expect(isOwnOrigin(origin, 'http://localhost:3000', fetchSite)).toBe(
      expected,
    );
  });
});

describe('the notice texts', () => {
  it('names the address in the sent notice without saying it has an account', () => {
    expect(signInSentBody('sam@example.com')).toBe(
      'If sam@example.com can sign in, a link is on its way. It works once and lasts 5 minutes.',
    );
  });

  it.each([
    [1, 'Try again in about 1 minute.'],
    [2, 'Try again in about 2 minutes.'],
    [60, 'Try again in about 60 minutes.'],
  ])('names a wait of %s minutes', (minutes, text) => {
    expect(rateLimitBody(minutes)).toContain(text);
  });

  it.each([
    ['link_invalid', 'warning', 'expired or was already used'],
    ['failed', 'danger', 'We could not sign you in'],
  ] as const)('gives %s a %s notice', (problem, tone, text) => {
    const copy = signInProblemCopy(problem);
    expect(copy.tone).toBe(tone);
    expect(copy.title).toContain(text);
    expect(copy.body).not.toBe('');
  });
});

describe('the confirm post addresses', () => {
  it('sends a refused link back to /sign-in with the destination', () => {
    expect(verifyErrorCallbackPath('/a?b=1')).toBe(
      '/sign-in?next=%2Fa%3Fb%3D1',
    );
  });

  it('adds the error to the failure address', () => {
    expect(signInFailureUrl('https://ramble.example', '/account')).toBe(
      'https://ramble.example/sign-in?next=%2Faccount&error=INVALID_TOKEN',
    );
  });
});

describe('verifyOutcome', () => {
  it.each([
    [
      'a 302 with a place to go',
      302,
      '/account',
      { kind: 'redirect', location: '/account' },
    ],
    [
      'a 303 with a place to go',
      303,
      '/x',
      { kind: 'redirect', location: '/x' },
    ],
    [
      'a redirect with no place to go',
      302,
      null,
      { kind: 'refused', unexpectedStatus: 302 },
    ],
    ['a 400', 400, null, { kind: 'refused', unexpectedStatus: null }],
    ['a 429', 429, null, { kind: 'refused', unexpectedStatus: null }],
    ['a 200', 200, null, { kind: 'refused', unexpectedStatus: 200 }],
    ['a 500', 500, null, { kind: 'refused', unexpectedStatus: 500 }],
    [
      'a 399 edge with a place to go',
      399,
      '/x',
      { kind: 'redirect', location: '/x' },
    ],
    [
      'a 300 edge with a place to go',
      300,
      '/x',
      { kind: 'redirect', location: '/x' },
    ],
    ['a 499 edge', 499, null, { kind: 'refused', unexpectedStatus: null }],
    [
      'a 400 edge with a location',
      400,
      '/x',
      { kind: 'refused', unexpectedStatus: null },
    ],
  ])('reads %s', (_label, status, location, expected) => {
    expect(verifyOutcome(status, location)).toEqual(expected);
  });
});

describe('endSessionStatus', () => {
  it.each([
    ['ended', true, 303],
    ['refused', false, 502],
  ])(
    'is the post status when Better Auth %s the session',
    (_label, ok, status) => {
      expect(endSessionStatus(ok)).toBe(status);
    },
  );
});
