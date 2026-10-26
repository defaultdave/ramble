import { describe, expect, it } from 'vitest';
import {
  EmailAddressSchema,
  EmailAllowlistSchema,
  EmailSenderSchema,
  isAllowlisted,
  normalizeEmailAddress,
} from './address';

// Behaviours under test, one per decision or risk:
// - a plain lower-case address passes; anything that could carry a second header or a display name is refused
// - an address over 254 characters is refused
// - normalizing folds case and nothing else, so a padded address still fails validation
// - a sender is a bare address or "Name <address>", and a name with angle brackets or quotes is refused
// - an allowlist is addresses and @domain entries, lower-cased, capped at 50 entries
// - an @domain entry matches that domain only: not a subdomain, not a longer name that ends the same way

describe('EmailAddressSchema', () => {
  it.each(['guest@example.com', 'a.b+tag@sub.example.co.uk', 'x_y%z@a-b.io'])(
    'accepts %s',
    (address) => {
      expect(EmailAddressSchema.safeParse(address).success).toBe(true);
    },
  );

  it.each([
    ['upper case', 'Guest@example.com'],
    ['no at sign', 'guest.example.com'],
    ['no dot in the domain', 'guest@localhost'],
    ['a space', 'gu est@example.com'],
    ['leading whitespace', ' guest@example.com'],
    ['a line break and a second header', 'a@example.com\r\nBcc: b@example.com'],
    ['a display name', 'Guest <guest@example.com>'],
    ['two addresses', 'a@example.com,b@example.com'],
    ['a leading hyphen in a label', 'a@-example.com'],
    ['a trailing hyphen in a label', 'a@example-.com'],
    ['an empty label', 'a@example..com'],
    ['a non-ASCII letter', 'gü@example.com'],
    ['empty', ''],
  ])('refuses %s', (_label, address) => {
    expect(EmailAddressSchema.safeParse(address).success).toBe(false);
  });

  it('refuses an address over 254 characters', () => {
    const long = `${'a'.repeat(64)}@${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com`;

    expect(long.length).toBeGreaterThan(254);
    expect(EmailAddressSchema.safeParse(long).success).toBe(false);
  });
});

describe('normalizeEmailAddress', () => {
  it('folds case and keeps everything else, so padding still fails validation', () => {
    expect(normalizeEmailAddress('Guest@Example.COM')).toBe(
      'guest@example.com',
    );
    expect(
      EmailAddressSchema.safeParse(normalizeEmailAddress(' Guest@Example.COM'))
        .success,
    ).toBe(false);
  });
});

describe('EmailSenderSchema', () => {
  it.each(['hello@example.com', 'Ramble <hello@example.com>'])(
    'accepts %s',
    (sender) => {
      expect(EmailSenderSchema.safeParse(sender).success).toBe(true);
    },
  );

  it.each([
    'Ramble <>',
    'Ra"mble <hello@example.com>',
    'Ramble <hello@example.com> <b@example.com>',
    '<Ramble> <hello@example.com>',
    'Ramble <hello@localhost>',
    'Ramble\r\nBcc: x@example.com <hello@example.com>',
  ])('refuses %j', (sender) => {
    expect(EmailSenderSchema.safeParse(sender).success).toBe(false);
  });
});

describe('EmailAllowlistSchema', () => {
  it('reads an empty string as no entries', () => {
    expect(EmailAllowlistSchema.parse('')).toEqual([]);
  });

  it('splits on commas, trims, and lower-cases', () => {
    expect(
      EmailAllowlistSchema.parse(' Dave@Example.com , @team.example.org '),
    ).toEqual(['dave@example.com', '@team.example.org']);
  });

  it.each([
    'not-an-address',
    '@localhost',
    'a@example.com,,b@example.com',
    'a@example.com, trailing,',
  ])('refuses %j', (raw) => {
    expect(EmailAllowlistSchema.safeParse(raw).success).toBe(false);
  });

  it('refuses more than 50 entries', () => {
    const fifty = Array.from({ length: 50 }, (_, n) => `a${String(n)}@x.io`);

    expect(EmailAllowlistSchema.safeParse(fifty.join(',')).success).toBe(true);
    expect(
      EmailAllowlistSchema.safeParse([...fifty, 'extra@x.io'].join(','))
        .success,
    ).toBe(false);
  });
});

describe('isAllowlisted', () => {
  const entries = ['dave@example.com', '@team.example.org'];

  it.each([
    ['an exact address', 'dave@example.com'],
    ['anyone at a listed domain', 'sam@team.example.org'],
  ])('allows %s', (_label, address) => {
    expect(isAllowlisted(address, entries)).toBe(true);
  });

  it.each([
    ['another address at an address entry’s domain', 'sam@example.com'],
    ['a subdomain of a listed domain', 'sam@sub.team.example.org'],
    ['a longer name ending the same way', 'sam@evilteam.example.org'],
    [
      'a look-alike with the domain in the local part',
      'team.example.org@evil.io',
    ],
  ])('refuses %s', (_label, address) => {
    expect(isAllowlisted(address, entries)).toBe(false);
  });

  it('allows nobody when the list is empty', () => {
    expect(isAllowlisted('dave@example.com', [])).toBe(false);
  });
});
