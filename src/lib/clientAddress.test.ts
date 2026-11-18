import { describe, expect, it } from 'vitest';
import { clientAddress } from './clientAddress';

// Behaviours under test, one per branch:
// - the first x-forwarded-for entry is the address, trimmed and lower-cased
// - IPv4 passes unchanged; IPv4-mapped IPv6 keeps its ::ffff: dotted form, in either spelling
// - IPv6 keys by its /64: one canonical prefix for every spelling and every address inside it
// - malformed IPv6 collapses to "unknown"
// - an absent, empty, over-long, or non-address value collapses to one shared "unknown"

describe('clientAddress', () => {
  it.each([
    ['203.0.113.7', '203.0.113.7'],
    ['203.0.113.7, 10.0.0.1, 10.0.0.2', '203.0.113.7'],
    ['  203.0.113.7  ', '203.0.113.7'],
    ['::ffff:203.0.113.7', '::ffff:203.0.113.7'],
    ['::FFFF:cb00:7107', '::ffff:203.0.113.7'],
  ])('reads %j as %s', (header, expected) => {
    expect(clientAddress(header)).toBe(expected);
  });

  it.each([
    ['2001:DB8::1', '2001:db8:0:0::/64'],
    ['2001:db8::', '2001:db8:0:0::/64'],
    ['2001:DB8:0:0:1:2:3:4', '2001:db8:0:0::/64'],
    ['2001:0db8:0000:0000:0001:0002:0003:0004', '2001:db8:0:0::/64'],
    ['2001:db8::1:2:3:4', '2001:db8:0:0::/64'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2::/64'],
    ['::1', '0:0:0:0::/64'],
    ['2001:db8::1.2.3.4', '2001:db8:0:0::/64'],
  ])('keys the IPv6 address %s by its /64, %s', (header, expected) => {
    expect(clientAddress(header)).toBe(expected);
  });

  it('gives two addresses in one /64 the same key', () => {
    expect(clientAddress('2001:db8:aaaa:bbbb::1')).toBe(
      clientAddress('2001:db8:aaaa:bbbb:ffff:ffff:ffff:ffff'),
    );
  });

  it.each([
    ['2001:db8:0:1::1', '2001:db8:0:2::1'],
    ['2001:db8:0:ffff::1', '2001:db8:1:0::1'],
  ])('gives adjacent /64s %s and %s different keys', (a, b) => {
    expect(clientAddress(a)).not.toBe(clientAddress(b));
  });

  it.each([
    ['too many groups', '1:2:3:4:5:6:7:8:9'],
    ['too few groups without ::', '1:2:3:4:5:6:7'],
    ['two ::', '1::2::3'],
    ['three colons', '1:::2'],
    ['three colons before a dotted tail', ':::1.2.3.4'],
    ['three colons after a group before a dotted tail', '1:::1.2.3.4'],
    ['a leading zero in a dotted octet', '::01.2.3.4'],
    ['a group over 4 digits', '2001:db8:12345::1'],
    ['a bare colon', ':'],
    ['a leading single colon', ':1:2:3:4:5:6:7'],
    [':: with eight groups', '1:2:3:4::5:6:7:8'],
    ['a short dotted tail', '::1.2.3'],
    ['an out-of-range dotted tail', '::1.2.3.256'],
    ['a dotted tail not last', '::1.2.3.4:5'],
  ])('collapses malformed IPv6 (%s) to unknown', (_label, header) => {
    expect(clientAddress(header)).toBe('unknown');
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
