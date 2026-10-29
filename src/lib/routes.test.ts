import { describe, expect, it } from 'vitest';
import { id, idWithLetters } from './experiencePage.fixtures';
import {
  accessibilityPath,
  browsePath,
  categoryPath,
  checkoutPath,
  contactPath,
  experienceCardPath,
  experiencePath,
  giftCheckoutPath,
  giftGuidePath,
  guidePath,
  helpPath,
  homePicksHref,
  legalPath,
  managePath,
  maxAddressLength,
  neighborhoodPath,
  orderPath,
  parseExperienceAddress,
  picksAnchor,
  picksPath,
  privateSessionPath,
} from './routes';

// Behaviours under test, one per decision, branch or risk:
// - an experience is addressed by slug and id under /experiences, a guide entry under /guide
// - a card picks the experience or the guide address by status
// - an address is a slug, a hyphen, and a uuid; anything else (no hyphen, a bad slug, a bad uuid, too long) is refused, and the ID comes out lower-case
// - every other address keeps its literal value, and the footer's two legal addresses stay distinct

describe('experiencePath and guidePath', () => {
  it('address an experience and a guide entry by slug and id', () => {
    const address = { slug: 'thing-1', id: id(1) };
    expect(experiencePath(address)).toBe(`/experiences/thing-1-${id(1)}`);
    expect(guidePath(address)).toBe(`/guide/thing-1-${id(1)}`);
  });

  it('round-trips with parseExperienceAddress', () => {
    const address = { slug: 'thing-1', id: id(1) };
    const path = experiencePath(address);
    expect(parseExperienceAddress(path.replace('/experiences/', ''))).toEqual(
      address,
    );
  });
});

describe('experienceCardPath', () => {
  it.each([
    ['live', 'experiences'],
    ['guide_only', 'guide'],
  ] as const)('puts a %s entry under /%s', (status, area) => {
    expect(experienceCardPath({ slug: 'thing-1', id: id(1), status })).toBe(
      `/${area}/thing-1-${id(1)}`,
    );
  });
});

describe('parseExperienceAddress', () => {
  it('splits a slug and an ID, and lower-cases the ID', () => {
    expect(
      parseExperienceAddress(`sunset-kayak-${idWithLetters.toUpperCase()}`),
    ).toEqual({ slug: 'sunset-kayak', id: idWithLetters });
  });

  it('takes a one-word slug', () => {
    expect(parseExperienceAddress(`kayak-${id(1)}`)?.slug).toBe('kayak');
  });

  it.each([
    ['sample'],
    [''],
    [id(1)],
    [`-${id(1)}`],
    [`kayak${id(1)}`],
    [`Kayak-${id(1)}`],
    [`kayak--${id(1)}`],
    [`kayak_-${id(1)}`],
    ['kayak-00000000-0000-4000-8000-00000000000g'],
    [`kayak-${id(1)}-extra`],
    [`${'a'.repeat(maxAddressLength)}-${id(1)}`],
  ])('refuses %j', (address) => {
    expect(parseExperienceAddress(address)).toBeNull();
  });

  it('takes an address at the length limit', () => {
    const slug = 'a'.repeat(maxAddressLength - 37);
    expect(parseExperienceAddress(`${slug}-${id(1)}`)?.slug).toBe(slug);
  });
});

describe('paths', () => {
  it('addresses the pages the breadcrumb and entry points go to', () => {
    expect(categoryPath('outdoors')).toBe('/new-york/things-to-do/outdoors');
    expect(neighborhoodPath('tribeca')).toBe('/new-york/neighborhoods/tribeca');
    expect(giftCheckoutPath(id(1))).toBe(`/gifts/checkout/${id(1)}`);
    expect(privateSessionPath).toBe('/contact');
  });
});

describe('literal addresses', () => {
  it.each([
    ['browse', browsePath, '/new-york/browse'],
    ['gift guide', giftGuidePath, '/gifts'],
    ['the home page at Ramble Picks', homePicksHref, '/#picks'],
    ['the Ramble Picks anchor', picksAnchor, 'picks'],
    ['a picks page', picksPath('summer'), '/picks/summer'],
    ['a category', categoryPath('outdoors'), '/new-york/things-to-do/outdoors'],
    [
      'a neighborhood',
      neighborhoodPath('tribeca'),
      '/new-york/neighborhoods/tribeca',
    ],
    ['a gift checkout', giftCheckoutPath(id(1)), `/gifts/checkout/${id(1)}`],
    ['a checkout', checkoutPath(id(1)), `/checkout/${id(1)}`],
    ['an order', orderPath('RMB-ABC123'), '/orders/RMB-ABC123'],
    ['contact', contactPath, '/contact'],
    ['help', helpPath, '/help'],
    ['accessibility', accessibilityPath, '/accessibility'],
    ['the terms', legalPath('terms'), '/legal/terms'],
    ['the privacy policy', legalPath('privacy'), '/legal/privacy'],
    ['a private session', privateSessionPath, '/contact'],
    ['a manage page', managePath('abc'), '/manage/abc'],
  ])('writes %s', (_name, actual, expected) => {
    expect(actual).toBe(expected);
  });

  it('keeps the two legal addresses distinct', () => {
    expect(legalPath('terms')).not.toBe(legalPath('privacy'));
  });
});
