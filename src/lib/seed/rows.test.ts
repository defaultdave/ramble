import { describe, expect, it } from 'vitest';
import { EmailAddressSchema } from '@/lib/email/address';
import { maxScaleExperiences } from './args';
import { curated } from './fixtures';
import { seedId } from './ids';
import {
  collectionInput,
  experienceId,
  experienceRow,
  homeModulesInput,
  hostId,
  hostNotificationEmail,
  hostRow,
  pageCopyInput,
  priceRows,
  taxonomyRow,
  templateInput,
  type RefMaps,
} from './rows';
import { generateScaleFixtures } from './scale';
import type { ExperienceFixture } from './types';

// Behaviours under test:
// - ids come from slugs, so a host, experience, category and neighborhood with one slug differ and repeat across runs
// - a host defaults to New York
// - a host's notification address is bookings@<slug>.example, on the reserved .example domain, and
//   every curated host and every host of the largest scale fixture gets one the address schema accepts
// - a slug that would make an address the schema refuses stops the seed, naming the host
// - an experience row resolves its references, requires a waiver exactly when it names one, and a
//   missing reference stops with a message naming it
// - price rows carry the experience id; template input carries the slot and defaults to a Ramble source
// - a collection input replaces by stored id, creates when new, refuses another kind, and turns slugs into experience ids
// - the home page input resolves collection slugs to saved ids and refuses an unsaved one
// - page copy resolves its category or neighborhood and is always published

const refs: RefMaps = {
  categories: new Map([['outdoors', 'cat-id']]),
  neighborhoods: new Map([['tribeca', 'nbhd-id']]),
  tiers: new Map([['flexible', 'tier-id']]),
  waivers: new Map([['waiver-hudson-paddle-club', 'waiver-id']]),
};

const kayak = curated.experiences.find(
  (e) => e.slug === 'sunset-kayak-on-the-hudson',
) as ExperienceFixture;

describe('ids', () => {
  it('keep a host and an experience of one slug apart, and repeat', () => {
    expect(hostId('x')).not.toBe(experienceId('x'));
    expect(experienceId('x')).toBe(experienceId('x'));
    expect(taxonomyRow('category', { slug: 'a', name: 'A' }).id).not.toBe(
      taxonomyRow('neighborhood', { slug: 'a', name: 'A' }).id,
    );
    expect(taxonomyRow('category', { slug: 'a', name: 'A' }).id).toBe(
      seedId('category', 'a'),
    );
  });
});

describe('hostRow', () => {
  it('defaults to New York and keeps an explicit zone', () => {
    const host = { slug: 'h', name: 'H', description: 'D' };
    expect(hostRow(host).timeZone).toBe('America/New_York');
    expect(hostRow({ ...host, timeZone: 'America/Chicago' }).timeZone).toBe(
      'America/Chicago',
    );
  });
});

describe('hostNotificationEmail', () => {
  it('derives the address from the slug on the reserved .example domain', () => {
    expect(hostNotificationEmail('hudson-paddle-club')).toBe(
      'bookings@hudson-paddle-club.example',
    );
    expect(
      hostRow({ slug: 'h', name: 'H', description: 'D' }).notificationEmail,
    ).toBe('bookings@h.example');
  });

  it('gives every curated host and every host of the largest scale fixture a valid address', () => {
    const scale = generateScaleFixtures({
      experiences: maxScaleExperiences,
      seed: 1,
    });
    const hosts = [...curated.hosts, ...scale.hosts];
    expect(hosts.length).toBeGreaterThan(curated.hosts.length);
    for (const host of hosts) {
      const address = hostRow(host).notificationEmail;
      expect(EmailAddressSchema.safeParse(address).success).toBe(true);
    }
  });

  it.each([
    ['upper case', 'Hudson'],
    ['a space', 'hudson club'],
    ['empty', ''],
    ['an address too long', 'a'.repeat(250)],
  ])('refuses a slug that is %s', (_why, slug) => {
    expect(() => hostNotificationEmail(slug)).toThrow(
      /cannot have a notification address/,
    );
  });
});

describe('experienceRow', () => {
  it('resolves its references and requires the waiver it names', () => {
    expect(experienceRow(kayak, refs)).toMatchObject({
      id: experienceId(kayak.slug),
      hostId: hostId('hudson-paddle-club'),
      categoryId: 'cat-id',
      neighborhoodId: 'nbhd-id',
      cancellationTierId: 'tier-id',
      waiverRequired: true,
      waiverDocumentId: 'waiver-id',
    });
  });

  it('asks for no waiver when none is named', () => {
    expect(experienceRow({ ...kayak, waiverDoc: null }, refs)).toMatchObject({
      waiverRequired: false,
      waiverDocumentId: null,
    });
  });

  it('leaves out createdAt, so a rerun keeps the first insert time', () => {
    expect(experienceRow(kayak, refs)).not.toHaveProperty('createdAt');
  });

  it.each([
    ['category', { ...refs, categories: new Map<string, string>() }],
    ['neighborhood', { ...refs, neighborhoods: new Map<string, string>() }],
    ['cancellation tier', { ...refs, tiers: new Map<string, string>() }],
    ['published waiver', { ...refs, waivers: new Map<string, string>() }],
  ])('stops when the %s is missing', (what, missing) => {
    expect(() => experienceRow(kayak, missing)).toThrow(`Seed has no ${what}`);
  });
});

describe('priceRows and templateInput', () => {
  it('carry the experience id and the price fields', () => {
    expect(priceRows([kayak])).toEqual([
      {
        experienceId: experienceId(kayak.slug),
        kind: 'adult',
        priceMinor: 6500,
        usesSpace: true,
      },
    ]);
  });

  it('turns a slot into template input, from a Ramble source unless it says allocation', () => {
    const slot = {
      weekday: 6,
      startTime: '17:30',
      durationMinutes: 120,
      allocation: 12,
    };
    expect(templateInput(kayak.slug, slot)).toEqual({
      experienceId: experienceId(kayak.slug),
      ...slot,
      source: 'ramble',
    });
    expect(
      templateInput(kayak.slug, { ...slot, source: 'allocation' }).source,
    ).toBe('allocation');
  });
});

describe('collectionInput', () => {
  const pick = curated.collections[0] as (typeof curated.collections)[number];

  it('creates a collection with no id and turns slugs into experience ids', () => {
    const input = collectionInput(pick, []);
    expect(input).not.toHaveProperty('id');
    expect(input.items[0]).toEqual({
      experienceId: experienceId(pick.items[0]?.slug ?? ''),
      note: pick.items[0]?.note,
    });
  });

  it('replaces the stored collection of the same slug and kind', () => {
    expect(
      collectionInput(pick, [{ id: 'stored', slug: pick.slug, kind: 'pick' }])
        .id,
    ).toBe('stored');
  });

  it('refuses to replace a collection of another kind', () => {
    expect(() =>
      collectionInput(pick, [
        { id: 'stored', slug: pick.slug, kind: 'gift_guide' },
      ]),
    ).toThrow('already exists as another kind');
  });
});

describe('homeModulesInput', () => {
  it('resolves collection slugs to saved ids and leaves the others null', () => {
    const input = homeModulesInput(
      curated.homeModules,
      new Map([
        ['rainy-day-sorted', 'pick-id'],
        ['gift-guide', 'gift-id'],
      ]),
    );
    expect(input.map((m) => [m.kind, m.collectionId])).toEqual([
      ['hero_search', null],
      ['category_rail', null],
      ['picks', 'pick-id'],
      ['gift_guide', 'gift-id'],
      ['this_week', null],
      ['reassurance', null],
    ]);
  });

  it('stops on a collection that was not saved', () => {
    expect(() => homeModulesInput(curated.homeModules, new Map())).toThrow(
      'Seed has no saved collection',
    );
  });
});

describe('pageCopyInput', () => {
  const categoryCopy = curated.pageCopy.find(
    (c) => c.kind === 'category',
  ) as (typeof curated.pageCopy)[number];
  const neighborhoodCopy = curated.pageCopy.find(
    (c) => c.kind === 'neighborhood',
  ) as (typeof curated.pageCopy)[number];
  const maps = {
    categories: new Map([[categoryCopy.slug, 'cat']]),
    neighborhoods: new Map([[neighborhoodCopy.slug, 'nbhd']]),
  };

  it('points at the category or the neighborhood and is published', () => {
    expect(pageCopyInput(categoryCopy, maps)).toMatchObject({
      kind: 'category',
      targetId: 'cat',
      status: 'published',
    });
    expect(pageCopyInput(neighborhoodCopy, maps)).toMatchObject({
      kind: 'neighborhood',
      targetId: 'nbhd',
    });
  });

  it('stops when the target is missing', () => {
    expect(() =>
      pageCopyInput(categoryCopy, { ...maps, categories: new Map() }),
    ).toThrow('Seed has no category');
  });
});
