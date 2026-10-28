import { describe, expect, it } from 'vitest';
import { curated } from './fixtures';
import {
  assembleSnapshot,
  snapshotFromFixtures,
  type RawSeedRows,
} from './snapshot';

// Behaviours under test:
// - rows from the database are grouped into experiences with their prices, collections with their
//   entries in position order, and a home page in position order
// - a session with no local date is left out; a waiver counts as published only when its document is
// - page copy is complete only when heading, description, intro and body are all present
// - the snapshot of the fixtures lists every fixture experience and plans its sessions at the clock given

const now = new Date('2026-10-28T15:00:00Z');

const experience = {
  slug: 'e',
  hostSlug: 'h',
  categorySlug: 'c',
  neighborhoodSlug: 'n',
  tier: 'flexible',
  status: 'live',
  outdoor: false,
  weatherPolicy: null,
  weatherDecisionHours: null,
  ageRule: 'all_ages',
  minAge: null,
  maxAge: null,
  taxTreatment: 'unknown',
  waiverRequired: true,
  linkOutUrl: null,
  meetingPoint: null,
  accessibilityNotes: null,
  waiverStatus: 'published',
};

const raw: RawSeedRows = {
  categories: [{ slug: 'c' }],
  neighborhoods: [{ slug: 'n' }],
  hosts: [{ slug: 'h', description: null }],
  experiences: [
    experience,
    { ...experience, slug: 'f', waiverStatus: 'draft' },
    { ...experience, slug: 'g', waiverStatus: null },
  ],
  prices: [
    { experienceSlug: 'e', kind: 'adult', priceMinor: 100, usesSpace: true },
    { experienceSlug: 'e', kind: 'child', priceMinor: 50, usesSpace: true },
  ],
  sessions: [
    {
      experienceSlug: 'e',
      localDate: '2026-11-07',
      startsAt: now,
      allocation: 4,
      seatsSold: 1,
      source: 'ramble',
      status: 'scheduled',
    },
    {
      experienceSlug: 'e',
      localDate: null,
      startsAt: now,
      allocation: 4,
      seatsSold: 0,
      source: 'external',
      status: 'scheduled',
    },
  ],
  collections: [{ id: 'c1', kind: 'pick', slug: 'p', status: 'published' }],
  collectionItems: [
    { collectionId: 'c1', experienceSlug: 'f', position: 1 },
    { collectionId: 'c1', experienceSlug: 'e', position: 0 },
  ],
  homeModules: [
    {
      position: 1,
      kind: 'picks',
      enabled: true,
      collectionSlug: 'p',
      body: null,
    },
    {
      position: 0,
      kind: 'hero_search',
      enabled: true,
      collectionSlug: null,
      body: { type: 'doc' },
    },
  ],
  pageCopy: [
    {
      kind: 'category',
      slug: 'c',
      status: 'published',
      heading: 'H',
      metaDescription: 'M',
      intro: {},
      body: {},
    },
    {
      kind: 'category',
      slug: 'd',
      status: 'published',
      heading: 'H',
      metaDescription: null,
      intro: {},
      body: {},
    },
  ],
  legal: [{ doc: 'terms', status: 'published' }],
  settings: { giftsEnabled: true, bookingsPaused: false },
};

describe('assembleSnapshot', () => {
  const snapshot = assembleSnapshot(raw, now);

  it('groups prices under their experience', () => {
    expect(snapshot.experiences[0]?.prices.map((p) => p.kind)).toEqual([
      'adult',
      'child',
    ]);
    expect(snapshot.experiences[1]?.prices).toEqual([]);
  });

  it('counts a waiver as published only when its document is', () => {
    expect(snapshot.experiences.map((e) => e.waiverPublished)).toEqual([
      true,
      false,
      false,
    ]);
  });

  it('orders collection entries and home modules by position', () => {
    expect(snapshot.collections[0]?.items).toEqual(['e', 'f']);
    expect(snapshot.homeModules.map((m) => m.kind)).toEqual([
      'hero_search',
      'picks',
    ]);
    expect(snapshot.homeModules.map((m) => m.hasBody)).toEqual([true, false]);
  });

  it('leaves out a session with no local date', () => {
    expect(snapshot.sessions).toHaveLength(1);
  });

  it('calls page copy complete only when every field is present', () => {
    expect(snapshot.pageCopy.map((c) => c.complete)).toEqual([true, false]);
  });
});

describe('snapshotFromFixtures', () => {
  const snapshot = snapshotFromFixtures(curated, undefined, now);

  it('lists every fixture experience and host', () => {
    expect(snapshot.experiences).toHaveLength(curated.experiences.length);
    expect(snapshot.hosts).toHaveLength(curated.hosts.length);
  });

  it('plans sessions at the clock it is given, all in the future', () => {
    expect(snapshot.sessions.length).toBeGreaterThan(100);
    expect(snapshot.sessions.every((s) => s.startsAt > now)).toBe(true);
  });

  it('marks a waiver published only for a document it holds', () => {
    const kayak = snapshot.experiences.find((e) => e.waiverRequired);
    expect(kayak?.waiverPublished).toBe(true);
  });

  it('includes the scale experiences when given', () => {
    const scale = {
      hosts: [{ slug: 'x', name: 'X', description: 'D' }],
      experiences: [
        {
          ...(curated.experiences[0] as (typeof curated.experiences)[number]),
          slug: 'scaled',
          hostSlug: 'x',
        },
      ],
    };
    const withScale = snapshotFromFixtures(curated, scale, now);
    expect(withScale.experiences).toHaveLength(curated.experiences.length + 1);
  });
});
