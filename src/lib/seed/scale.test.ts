import { describe, expect, it } from 'vitest';
import { HostExperienceSchema } from '@/lib/catalog';
import { maxScaleExperiences } from './args';
import { curated } from './fixtures';
import { maxSeedValue } from './ids';
import { generateScaleFixtures } from './scale';
import { fixtureIssues } from './validate';

// Behaviours under test:
// - the same options give the same fixtures; another seed gives different ones
// - 400 experiences come from 150 hosts, every host has experiences, every slug and host is unique
// - the count is bounded: 1 and the maximum work, 0 and one past the maximum throw, as does a bad seed
// - the fixtures pass the validation the curated set passes, together with the curated set
// - the mix is plausible: mostly live, some guide-only, hidden statuses, every category and
//   neighborhood used, outdoor with a weather policy, kids with a child price, guide-only with a link
//   and no sessions, draft and in-review with no sessions

const options = { experiences: 400, seed: 1 };

describe('generateScaleFixtures', () => {
  const scale = generateScaleFixtures(options);

  it('repeats exactly for the same options', () => {
    expect(generateScaleFixtures(options)).toEqual(scale);
  });

  it('differs for another seed', () => {
    const other = generateScaleFixtures({ ...options, seed: 2 });
    expect(other.experiences.map((e) => e.name)).not.toEqual(
      scale.experiences.map((e) => e.name),
    );
  });

  it('makes 400 experiences from 150 hosts, each host used', () => {
    expect(scale.experiences).toHaveLength(400);
    expect(scale.hosts).toHaveLength(150);
    const used = new Set(scale.experiences.map((e) => e.hostSlug));
    expect(used.size).toBe(150);
  });

  it('gives every experience and host a unique slug', () => {
    expect(new Set(scale.experiences.map((e) => e.slug)).size).toBe(400);
    expect(new Set(scale.hosts.map((h) => h.slug)).size).toBe(150);
  });

  it.each([
    [1, 1],
    [maxScaleExperiences, maxScaleExperiences],
  ])('accepts %i experiences', (count, expected) => {
    const result = generateScaleFixtures({ experiences: count, seed: 0 });
    expect(result.experiences).toHaveLength(expected);
    expect(result.hosts.length).toBeGreaterThanOrEqual(1);
  });

  it.each([0, -1, maxScaleExperiences + 1, 2.5, Number.NaN])(
    'refuses %s experiences',
    (count) => {
      expect(() =>
        generateScaleFixtures({ experiences: count, seed: 1 }),
      ).toThrow(RangeError);
    },
  );

  it.each([-1, maxSeedValue + 1, 1.5])('refuses the seed %s', (seed) => {
    expect(() => generateScaleFixtures({ experiences: 5, seed })).toThrow(
      RangeError,
    );
  });

  it('passes the fixture validation together with the curated set', () => {
    expect(fixtureIssues(curated, scale)).toEqual([]);
  });

  it('reads back through the same schema the app uses', () => {
    for (const e of scale.experiences) {
      expect(
        HostExperienceSchema.safeParse({
          id: '00000000-0000-4000-8000-000000000001',
          hostId: '00000000-0000-4000-8000-000000000002',
          categoryId: '00000000-0000-4000-8000-000000000003',
          neighborhoodId: '00000000-0000-4000-8000-000000000004',
          cancellationTierId: '00000000-0000-4000-8000-000000000005',
          ...e,
          waiverRequired: false,
          waiverDocumentId: null,
          createdAt: new Date(0),
          priceOptions: [],
          cancellationTier: {
            id: '00000000-0000-4000-8000-000000000005',
            key: 'flexible',
            name: 'Flexible',
            fullRefundHoursBefore: 24,
            isDefault: true,
          },
        }).success,
      ).toBe(true);
    }
  });

  describe('the mix', () => {
    const count = (
      predicate: (e: (typeof scale.experiences)[number]) => boolean,
    ) => scale.experiences.filter(predicate).length;

    it('is mostly live with some of every other status', () => {
      expect(count((e) => e.status === 'live')).toBeGreaterThan(320);
      for (const status of ['guide_only', 'paused', 'draft', 'in_review']) {
        expect(count((e) => e.status === status)).toBeGreaterThan(0);
      }
    });

    it('uses every category and neighborhood', () => {
      expect(new Set(scale.experiences.map((e) => e.categorySlug)).size).toBe(
        8,
      );
      expect(
        new Set(scale.experiences.map((e) => e.neighborhoodSlug)).size,
      ).toBe(6);
    });

    it('gives outdoor experiences a weather policy and kids a child price', () => {
      for (const e of scale.experiences) {
        if (e.outdoor) expect(e.weatherPolicy).not.toBeNull();
        if (e.categorySlug === 'kids' && e.status !== 'guide_only') {
          expect(e.prices.map((p) => p.kind)).toEqual(['adult', 'child']);
        }
      }
    });

    it('sells sessions only for live and paused experiences, and links guide-only entries out', () => {
      for (const e of scale.experiences) {
        const sells = e.status === 'live' || e.status === 'paused';
        expect(e.slots.length > 0).toBe(sells);
        if (e.status === 'guide_only') {
          expect(e.linkOutUrl).not.toBeNull();
          expect(e.prices).toEqual([]);
        }
      }
    });

    it('runs kids classes on weekends only, so a weeknight search in a kids neighborhood stays empty', () => {
      for (const e of scale.experiences) {
        if (e.categorySlug !== 'kids') continue;
        expect(e.slots.every((s) => s.weekday === 0 || s.weekday === 6)).toBe(
          true,
        );
      }
    });

    it('keeps each slot unique within an experience and at most three', () => {
      for (const e of scale.experiences) {
        const keys = e.slots.map((s) => `${String(s.weekday)}@${s.startTime}`);
        expect(new Set(keys).size).toBe(keys.length);
        expect(keys.length).toBeLessThanOrEqual(3);
      }
    });
  });
});
