import { describe, expect, it } from 'vitest';
import {
  coverage,
  coverageGaps,
  evaluateCoverage,
  probes,
  renderCoverageMatrix,
  requirements,
  type ProbeKey,
  type SeedSnapshot,
  type SnapshotExperience,
  type SnapshotSession,
} from './coverage';
import { curated } from './fixtures';
import { generateScaleFixtures } from './scale';
import { snapshotFromFixtures } from './snapshot';

// Behaviours under test:
// - the matrix has one entry for every screen and state in the Figma file, listed here from the file
//   itself (mobile 01 to 08 with variants, States S1 to S10), each with its node id
// - every probe is used by a state or a requirement, and every entry names probes that exist
// - the fixtures, planned at a fixed clock, satisfy every probe; the scale probe is skipped without
//   the scale fixture and satisfied with it
// - each probe fails when the rows it describes are taken away (a mutation check, one per probe)
// - the committed document equals the rendered matrix

const now = new Date('2026-10-28T15:00:00Z');

const figmaStates: [id: string, node: string][] = [
  ['01', '44:10'],
  ['02', '45:190'],
  ['02b', '45:413'],
  ['03', '46:678'],
  ['03b', '46:897'],
  ['04', '47:890'],
  ['04b', '47:1132'],
  ['04c', '47:1350'],
  ['05', '48:1397'],
  ['05b', '48:1517'],
  ['06', '49:1548'],
  ['06b', '49:1688'],
  ['07', '49:1784'],
  ['08', '49:1888'],
  ['S1', '53:7'],
  ['S2', '53:117'],
  ['S3', '53:249'],
  ['S4', '54:188'],
  ['S5', '54:287'],
  ['S6', '55:300'],
  ['S7', '55:360'],
  ['S8', '55:414'],
  ['S9', '55:467'],
  ['S10', '55:516'],
];

const base = snapshotFromFixtures(curated, undefined, now);
const withScale = snapshotFromFixtures(
  curated,
  generateScaleFixtures({ experiences: 400, seed: 1 }),
  now,
);

describe('the matrix', () => {
  it('has an entry, with its Figma node, for every screen and state in the file', () => {
    expect(coverage.map((e) => [e.id, e.node])).toEqual(figmaStates);
  });

  it('gives every entry at least one probe and a way to reach the state', () => {
    for (const entry of coverage) {
      expect(entry.probes.length).toBeGreaterThan(0);
      expect(entry.trigger.length).toBeGreaterThan(0);
    }
  });

  it('names only probes that exist, and leaves none unused', () => {
    const named = new Set<string>([
      ...coverage.flatMap((e) => e.probes),
      ...requirements.flatMap((r) => r.probes),
    ]);
    for (const key of named) expect(Object.keys(probes)).toContain(key);
    for (const key of Object.keys(probes)) expect(named).toContain(key);
  });

  it('matches the committed document', async () => {
    await expect(renderCoverageMatrix()).toMatchFileSnapshot(
      '../../../docs/seed/coverage-matrix.md',
    );
  });
});

describe('the fixtures against the probes', () => {
  it('satisfy every probe except the scale one, which is skipped', () => {
    const results = evaluateCoverage(base, { scale: false });
    expect(coverageGaps(results)).toEqual([]);
    expect(results.filter((r) => r.skipped).map((r) => r.key)).toEqual([
      'many-results',
    ]);
  });

  it('fail the scale probe when the scale fixture was meant to load and did not', () => {
    expect(coverageGaps(evaluateCoverage(base, { scale: true }))).toEqual([
      'many-results',
    ]);
  });

  it('satisfy every probe with the 400-experience fixture', () => {
    const results = evaluateCoverage(withScale, { scale: true });
    expect(coverageGaps(results)).toEqual([]);
    expect(results.some((r) => r.skipped)).toBe(false);
  });

  it('hold at another clock, a Saturday evening, as well', () => {
    const saturdayNight = new Date('2026-11-14T03:30:00Z');
    const snapshot = snapshotFromFixtures(curated, undefined, saturdayNight);
    expect(coverageGaps(evaluateCoverage(snapshot, { scale: false }))).toEqual(
      [],
    );
  });
});

function editExperiences(
  snapshot: SeedSnapshot,
  match: (e: SnapshotExperience) => boolean,
  patch: Partial<SnapshotExperience>,
): SeedSnapshot {
  return {
    ...snapshot,
    experiences: snapshot.experiences.map((e) =>
      match(e) ? { ...e, ...patch } : e,
    ),
  };
}

function editSessions(
  snapshot: SeedSnapshot,
  match: (s: SnapshotSession) => boolean,
  patch: Partial<SnapshotSession>,
): SeedSnapshot {
  return {
    ...snapshot,
    sessions: snapshot.sessions.map((s) => (match(s) ? { ...s, ...patch } : s)),
  };
}

const slug = (value: string) => (e: SnapshotExperience) => e.slug === value;
const kayak = 'sunset-kayak-on-the-hudson';

const breakers: Record<
  Exclude<ProbeKey, 'many-results'>,
  (s: SeedSnapshot) => SeedSnapshot
> = {
  'categories-eight': (s) =>
    editExperiences(s, (e) => e.categorySlug === 'cooking', {
      status: 'paused',
    }),
  'neighborhoods-six': (s) =>
    editExperiences(s, (e) => e.neighborhoodSlug === 'tribeca', {
      status: 'paused',
    }),
  'cooking-page': (s) =>
    editExperiences(s, slug('hand-rolled-pasta-in-carroll-gardens'), {
      status: 'paused',
    }),
  'filter-variety': (s) => editExperiences(s, () => true, { outdoor: false }),
  'home-modules': (s) => ({
    ...s,
    homeModules: s.homeModules.filter((m) => m.kind !== 'this_week'),
  }),
  'this-week': (s) => ({
    ...s,
    sessions: s.sessions.filter(
      (x) => x.startsAt.getTime() > s.now.getTime() + 8 * 86_400_000,
    ),
  }),
  'picks-published': (s) => ({
    ...s,
    collections: s.collections.map((c) =>
      c.slug === 'golden-hour' ? { ...c, status: 'draft' } : c,
    ),
  }),
  'pick-visibility': (s) => ({
    ...s,
    collections: s.collections.filter((c) => c.status !== 'draft'),
  }),
  'gift-guide': (s) => ({
    ...s,
    settings: { ...s.settings, giftsEnabled: false },
  }),
  'gift-dates': (s) => ({
    ...s,
    sessions: s.sessions.filter((x) => x.experienceSlug !== kayak),
  }),
  'page-copy': (s) => ({
    ...s,
    pageCopy: s.pageCopy.map((c, i) =>
      i === 0 ? { ...c, complete: false } : c,
    ),
  }),
  'kayak-page': (s) => editExperiences(s, slug(kayak), { outdoor: false }),
  'kayak-session-states': (s) =>
    editSessions(s, (x) => x.seatsSold >= x.allocation, { seatsSold: 0 }),
  'kayak-full-day': (s) =>
    editSessions(s, (x) => x.experienceSlug === kayak, { seatsSold: 0 }),
  'kayak-other-dates': (s) => ({
    ...s,
    sessions: s.sessions.filter((x) => x.experienceSlug !== kayak),
  }),
  'bookable-party': (s) =>
    editSessions(s, () => true, { seatsSold: 1000, allocation: 1000 }),
  'guide-only': (s) => ({
    ...s,
    sessions: [
      ...s.sessions,
      {
        experienceSlug: 'sourdough-mornings-at-rise-bakery',
        localDate: '2026-11-07',
        startsAt: new Date('2026-11-07T15:00:00Z'),
        allocation: 4,
        seatsSold: 0,
        source: 'ramble',
        status: 'scheduled',
      },
    ],
  }),
  'kids-booking': (s) =>
    editExperiences(s, slug('kids-wheel-class'), {
      prices: [{ kind: 'adult', priceMinor: 0, usesSpace: false }],
    }),
  'twenty-one-plus': (s) =>
    editExperiences(s, slug('natural-wine-explained'), { ageRule: 'all_ages' }),
  waiver: (s) => editExperiences(s, slug(kayak), { waiverPublished: false }),
  'legal-published': (s) => ({
    ...s,
    legal: s.legal.filter((l) => l.doc !== 'terms'),
  }),
  'tax-treatments': (s) =>
    editExperiences(s, (e) => e.taxTreatment === 'unknown', {
      taxTreatment: 'taxable',
    }),
  neighbors: (s) =>
    editExperiences(s, slug('cast-iron-and-cobblestones'), {
      status: 'paused',
    }),
  'kids-zero-results': (s) => ({
    ...s,
    sessions: [
      ...s.sessions,
      {
        experienceSlug: 'kids-wheel-class',
        localDate: '2026-11-03',
        startsAt: new Date('2026-11-03T23:00:00Z'),
        allocation: 8,
        seatsSold: 0,
        source: 'ramble',
        status: 'scheduled',
      },
    ],
  }),
  'hidden-statuses': (s) =>
    editExperiences(s, (e) => e.status === 'paused', { status: 'live' }),
  'tiers-all': (s) =>
    editExperiences(s, (e) => e.tier === 'strict', { tier: 'flexible' }),
  'weather-both': (s) =>
    editExperiences(s, slug('cast-iron-and-cobblestones'), {
      weatherPolicy: 'decided_before_start',
    }),
  'allocation-host': (s) => editSessions(s, () => true, { source: 'ramble' }),
};

describe('each probe fails when its rows are taken away', () => {
  it.each(Object.keys(breakers) as (keyof typeof breakers)[])('%s', (key) => {
    expect(probes[key].check(base)).toBe(true);
    expect(probes[key].check(breakers[key](base))).toBe(false);
  });

  it('many-results fails on the curated set alone', () => {
    expect(probes['many-results'].check(base)).toBe(false);
    expect(probes['many-results'].check(withScale)).toBe(true);
  });

  it('has a breaker for every probe', () => {
    expect(Object.keys(breakers).sort()).toEqual(
      Object.keys(probes)
        .filter((key) => key !== 'many-results')
        .sort(),
    );
  });
});

describe('the probes read the same way the guest reads do', () => {
  it('treats a home module on a draft collection as hidden', () => {
    const hidden: SeedSnapshot = {
      ...base,
      collections: base.collections.map((c) =>
        c.slug === 'rainy-day-sorted' ? { ...c, status: 'draft' } : c,
      ),
    };
    expect(probes['home-modules'].check(hidden)).toBe(false);
  });

  it('treats a disabled home module as hidden', () => {
    const hidden: SeedSnapshot = {
      ...base,
      homeModules: base.homeModules.map((m) =>
        m.kind === 'reassurance' ? { ...m, enabled: false } : m,
      ),
    };
    expect(probes['home-modules'].check(hidden)).toBe(false);
  });

  it('does not count a cancelled session or one that has started', () => {
    const cancelled = editSessions(base, () => true, { status: 'cancelled' });
    expect(probes['bookable-party'].check(cancelled)).toBe(false);
    const started = editSessions(base, () => true, {
      startsAt: new Date(now.getTime() - 1000),
    });
    expect(probes['bookable-party'].check(started)).toBe(false);
  });
});
