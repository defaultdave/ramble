import { describe, expect, it } from 'vitest';
import {
  ConfirmSignInSchema,
  isOwnOrigin,
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
    ['a dot segment, resolved', '/a/../b', '/b'],
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
});
