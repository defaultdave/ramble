import { describe, expect, it } from 'vitest';
import { isWebUrl, safeLinkHref } from './href';

describe('safeLinkHref', () => {
  it.each([
    'https://example.com/a?b=c#d',
    'http://example.com',
    'mailto:help@example.com',
    'tel:+15555550123',
    '/help/refunds',
    '/',
    '#cancellation',
  ])('keeps %s', (href) => {
    expect(safeLinkHref(href)).toBe(href);
  });

  it('trims the value it keeps', () => {
    expect(safeLinkHref('  /help  ')).toBe('/help');
  });

  it.each([
    ['a script URL', 'javascript:alert(1)'],
    ['a script URL in mixed case', 'JaVaScRiPt:alert(1)'],
    ['a script URL with a tab inside the scheme', 'java\tscript:alert(1)'],
    ['a script URL with a newline inside the scheme', 'java\nscript:alert(1)'],
    ['a script URL led by a control character', '\u0001javascript:alert(1)'],
    ['a data URL', 'data:text/html;base64,PHNjcmlwdD4='],
    ['a file URL', 'file:///etc/passwd'],
    ['a protocol-relative URL', '//example.com/a'],
    ['a backslash path that browsers read as another host', '/\\example.com'],
    ['a relative path without a leading slash', 'help/refunds'],
    ['a query with no path', '?a=b'],
    ['an empty string', ''],
    ['only whitespace', '   '],
    ['an address with a space', 'https://example.com/a b'],
    [
      'an address over 2048 characters',
      `https://example.com/${'a'.repeat(2048)}`,
    ],
  ])('rejects %s', (_label, href) => {
    expect(safeLinkHref(href)).toBeNull();
  });

  it.each([undefined, null, 42, {}, ['/help']])(
    'rejects a non-string (%j)',
    (value) => {
      expect(safeLinkHref(value)).toBeNull();
    },
  );
});

describe('isWebUrl', () => {
  it.each([
    ['https://example.com', true],
    ['HTTP://example.com', true],
    ['mailto:a@example.com', false],
    ['/help', false],
    ['#top', false],
  ])('%s is %s', (href, expected) => {
    expect(isWebUrl(href)).toBe(expected);
  });
});
