import type {
  SeedSnapshot,
  SnapshotCollection,
  SnapshotExperience,
  SnapshotHomeModule,
  SnapshotPageCopy,
} from './coverage';
import { planSessions } from './plan';
import type { CuratedFixtures, ScaleFixtures } from './types';

// Two ways to build what the coverage probes read: from rows the database holds (the real check)
// and from the fixtures and the session plan (what the seed intends to write). A test holds the
// two together.

type Present = unknown;

/** Rows as the seed's reads return them, flat, so this file can do the grouping. */
export type RawSeedRows = {
  categories: { slug: string }[];
  neighborhoods: { slug: string }[];
  hosts: { slug: string; description: string | null }[];
  experiences: (Omit<SnapshotExperience, 'prices' | 'waiverPublished'> & {
    /** Status of the legal document the experience points at, or null when it points at none. */
    waiverStatus: string | null;
  })[];
  prices: {
    experienceSlug: string;
    kind: string;
    priceMinor: number;
    usesSpace: boolean;
  }[];
  sessions: {
    experienceSlug: string;
    localDate: string | null;
    startsAt: Date;
    allocation: number;
    seatsSold: number;
    source: string;
    status: string;
  }[];
  collections: { id: string; kind: string; slug: string; status: string }[];
  collectionItems: {
    collectionId: string;
    experienceSlug: string;
    position: number;
  }[];
  homeModules: {
    position: number;
    kind: string;
    enabled: boolean;
    collectionSlug: string | null;
    body: Present;
  }[];
  pageCopy: {
    kind: string;
    slug: string;
    status: string;
    heading: string | null;
    metaDescription: string | null;
    intro: Present;
    body: Present;
  }[];
  legal: { doc: string; status: string }[];
  settings: { giftsEnabled: boolean; bookingsPaused: boolean };
};

const present = (value: Present) => value !== null && value !== undefined;

export function assembleSnapshot(raw: RawSeedRows, now: Date): SeedSnapshot {
  const pricesBySlug = new Map<string, SnapshotExperience['prices']>();
  for (const price of raw.prices) {
    const list = pricesBySlug.get(price.experienceSlug) ?? [];
    list.push({
      kind: price.kind,
      priceMinor: price.priceMinor,
      usesSpace: price.usesSpace,
    });
    pricesBySlug.set(price.experienceSlug, list);
  }
  const itemsByCollection = new Map<string, string[]>();
  const orderedItems = [...raw.collectionItems].sort(
    (a, b) => a.position - b.position,
  );
  for (const item of orderedItems) {
    const list = itemsByCollection.get(item.collectionId) ?? [];
    list.push(item.experienceSlug);
    itemsByCollection.set(item.collectionId, list);
  }
  const orderedModules = [...raw.homeModules].sort(
    (a, b) => a.position - b.position,
  );
  return {
    now,
    categories: raw.categories.map((c) => c.slug),
    neighborhoods: raw.neighborhoods.map((n) => n.slug),
    hosts: raw.hosts,
    experiences: raw.experiences.map(({ waiverStatus, ...experience }) => ({
      ...experience,
      waiverPublished: waiverStatus === 'published',
      prices: pricesBySlug.get(experience.slug) ?? [],
    })),
    sessions: raw.sessions.flatMap((session) =>
      session.localDate === null
        ? []
        : [{ ...session, localDate: session.localDate }],
    ),
    collections: raw.collections.map(
      ({ id, ...collection }): SnapshotCollection => ({
        ...collection,
        items: itemsByCollection.get(id) ?? [],
      }),
    ),
    homeModules: orderedModules.map((module): SnapshotHomeModule => ({
      kind: module.kind,
      enabled: module.enabled,
      collectionSlug: module.collectionSlug,
      hasBody: present(module.body),
    })),
    pageCopy: raw.pageCopy.map((copy): SnapshotPageCopy => ({
      kind: copy.kind,
      slug: copy.slug,
      status: copy.status,
      complete:
        present(copy.heading) &&
        present(copy.metaDescription) &&
        present(copy.intro) &&
        present(copy.body),
    })),
    legal: raw.legal,
    settings: raw.settings,
  };
}

/** What the seed intends to leave in the database at `now`, from the fixtures alone. */
export function snapshotFromFixtures(
  curated: CuratedFixtures,
  scale: ScaleFixtures | undefined,
  now: Date,
): SeedSnapshot {
  const hosts = [...curated.hosts, ...(scale?.hosts ?? [])];
  const fixtures = [...curated.experiences, ...(scale?.experiences ?? [])];
  const legalDocs = new Set(curated.legal.map((l) => l.doc));
  return {
    now,
    categories: curated.categories.map((c) => c.slug),
    neighborhoods: curated.neighborhoods.map((n) => n.slug),
    hosts: hosts.map(({ slug, description }) => ({ slug, description })),
    experiences: fixtures.map((e) => ({
      slug: e.slug,
      hostSlug: e.hostSlug,
      categorySlug: e.categorySlug,
      neighborhoodSlug: e.neighborhoodSlug,
      tier: e.tier,
      status: e.status,
      outdoor: e.outdoor,
      weatherPolicy: e.weatherPolicy,
      weatherDecisionHours: e.weatherDecisionHours,
      ageRule: e.ageRule,
      minAge: e.minAge,
      maxAge: e.maxAge,
      taxTreatment: e.taxTreatment,
      waiverRequired: e.waiverDoc !== null,
      waiverPublished: e.waiverDoc !== null && legalDocs.has(e.waiverDoc),
      linkOutUrl: e.linkOutUrl,
      meetingPoint: e.meetingPoint,
      accessibilityNotes: e.accessibilityNotes,
      prices: e.prices,
    })),
    sessions: planSessions(hosts, fixtures, now).map((s) => ({
      experienceSlug: s.experienceSlug,
      localDate: s.localDate,
      startsAt: s.startsAt,
      allocation: s.allocation,
      seatsSold: s.seatsSold,
      source: s.source,
      status: 'scheduled',
    })),
    collections: curated.collections.map((c) => ({
      kind: c.kind,
      slug: c.slug,
      status: c.status,
      items: c.items.map((item) => item.slug),
    })),
    homeModules: curated.homeModules.map((m) => ({
      kind: m.kind,
      enabled: m.enabled,
      collectionSlug: m.collectionSlug,
      hasBody: m.body !== null,
    })),
    pageCopy: curated.pageCopy.map((c) => ({
      kind: c.kind,
      slug: c.slug,
      status: 'published',
      complete: true,
    })),
    legal: curated.legal.map((l) => ({ doc: l.doc, status: 'published' })),
    settings: { giftsEnabled: true, bookingsPaused: false },
  };
}
