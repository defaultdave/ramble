import { describe, expect, it } from 'vitest';
import { clientAddress } from './clientAddress';

// Behaviours under test, one per branch:
// - the first x-forwarded-for entry is the address, trimmed and lower-cased
// - IPv4, IPv6 and IPv4-mapped IPv6 pass
// - an absent, empty, over-long, or non-address value collapses to one shared "unknown"

describe('clientAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['203.0.113.7, 10.0.0.1, 10.0.0.2', '203.0.113.7'],
    ['  203.0.113.7  ', '203.0.113.7'],
    ['2001:DB8::1', '2001:db8::1'],
    ['::ffff:203.0.113.7', '::ffff:203.0.113.7'],
  ])('reads %j as %s', (header, expected) => {
    expect(clientAddress(header)).toBe(expected);
  });

  it.each([
    ['absent', null],
    ['empty', ''],
    ['only a comma', ','],
    ['words', 'not an address'],
    ['a script', '<script>'],
    ['over 45 characters', 'a'.repeat(46)],
  ])('collapses %s to unknown', (_label, header) => {
    expect(clientAddress(header)).toBe('unknown');
  });
});
