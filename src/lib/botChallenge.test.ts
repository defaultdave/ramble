import { describe, expect, it } from 'vitest';
import { botProtectedRoutes, shouldLoadBotId } from './botChallenge';

// Behaviours under test:
// - guest pages load the challenge; checkout, gift, manage, orders, host, and ops paths do not
// - the protected routes are POSTs to experience pages and nothing under checkout

describe('shouldLoadBotId', () => {
  it.each([
    ['/', true],
    ['/experiences/sunrise-kayak', true],
    ['/browse', true],
    ['/checkout', false],
    ['/checkout/abc', false],
    ['/gifts/checkout', false],
    ['/manage/token', false],
    ['/orders/1', false],
    ['/ops', false],
    ['/host/sessions', false],
  ])('on %s: %s', (pathname, expected) => {
    expect(shouldLoadBotId(pathname)).toBe(expected);
  });
});

describe('botProtectedRoutes', () => {
  it('signs POSTs to experience pages and nothing under checkout', () => {
    expect(botProtectedRoutes).toEqual([
      { path: '/experiences/*', method: 'POST' },
    ]);
  });
});
