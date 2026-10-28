import { describe, expect, it } from 'vitest';
import { SeedStepError } from './decide';
import { curated } from './fixtures';
import { paragraphs } from './richText';
import type { CuratedFixtures, ExperienceFixture } from './types';
import { assertValidFixtures, fixtureIssues } from './validate';

// Behaviours under test:
// - the curated fixtures are sound, and a sound set reports nothing
// - each kind of unsoundness is reported with the fixture it is in: a repeated slug, a reference to a
//   host, category, neighborhood, waiver, experience or collection that does not exist, a rule the app's
//   experience schema refuses, a slot the template schema refuses, a leave out of range, a repeated
//   slot or price kind, a second gift guide, a home module on the wrong kind of collection, copy the
//   page-copy schema refuses
// - the tone checklist is enforced on every kind of copy: a banned word as a whole word (not inside
//   another word), and an exclamation mark
// - assertValidFixtures throws a safe seed error that lists at most ten problems and counts the rest

const first = curated.experiences[0] as ExperienceFixture;

function withExperience(patch: Partial<ExperienceFixture>): CuratedFixtures {
  return {
    ...curated,
    experiences: [{ ...first, ...patch }, ...curated.experiences.slice(1)],
  };
}

const issuesOf = (fixtures: CuratedFixtures) => fixtureIssues(fixtures);

describe('fixtureIssues', () => {
  it('finds nothing wrong with the curated set', () => {
    expect(fixtureIssues(curated)).toEqual([]);
  });

  it.each([
    [
      'a repeated host slug',
      { ...curated, hosts: [...curated.hosts, ...curated.hosts.slice(0, 1)] },
      'host "hudson-paddle-club" appears twice',
    ],
    [
      'a repeated experience slug',
      {
        ...curated,
        experiences: [...curated.experiences, first],
      },
      `experience "${first.slug}" appears twice`,
    ],
    [
      'an unknown host',
      withExperience({ hostSlug: 'nobody' }),
      'names the host "nobody"',
    ],
    [
      'an unknown category',
      withExperience({ categorySlug: 'nothing' }),
      'names the category "nothing"',
    ],
    [
      'an unknown neighborhood',
      withExperience({ neighborhoodSlug: 'nowhere' }),
      'names the neighborhood "nowhere"',
    ],
    [
      'an unknown waiver',
      withExperience({ waiverDoc: 'waiver-nobody' }),
      'names the waiver "waiver-nobody"',
    ],
    [
      'an outdoor experience with no weather policy',
      withExperience({ outdoor: true, weatherPolicy: null }),
      'An outdoor experience states a weather policy',
    ],
    [
      'a guide-only entry with no link',
      withExperience({ status: 'guide_only', linkOutUrl: null }),
      'A guide-only entry links out',
    ],
    [
      'a link that is not an http address',
      withExperience({ linkOutUrl: 'ftp://example.com' }),
      'linkOutUrl',
    ],
    [
      'a slug that is not a slug',
      withExperience({ slug: 'Not A Slug' }),
      'experience "Not A Slug" is not a slug',
    ],
    [
      'a repeated price kind',
      withExperience({
        prices: [
          { kind: 'adult', priceMinor: 100, usesSpace: true },
          { kind: 'adult', priceMinor: 200, usesSpace: true },
        ],
      }),
      'price kind "adult" appears twice',
    ],
    [
      'a negative price',
      withExperience({
        prices: [{ kind: 'adult', priceMinor: -1, usesSpace: true }],
      }),
      'priceMinor',
    ],
    [
      'a slot on a day that does not exist',
      withExperience({
        slots: [
          {
            weekday: 7,
            startTime: '10:00',
            durationMinutes: 60,
            allocation: 5,
          },
        ],
      }),
      'weekday',
    ],
    [
      'a slot with a start time that is not a time',
      withExperience({
        slots: [
          {
            weekday: 1,
            startTime: '25:00',
            durationMinutes: 60,
            allocation: 5,
          },
        ],
      }),
      'startTime',
    ],
    [
      'a repeated slot',
      withExperience({
        slots: [
          {
            weekday: 1,
            startTime: '10:00',
            durationMinutes: 60,
            allocation: 5,
          },
          {
            weekday: 1,
            startTime: '10:00',
            durationMinutes: 90,
            allocation: 5,
          },
        ],
      }),
      'slot "1@10:00" appears twice',
    ],
    [
      'spaces left above the allocation',
      withExperience({
        slots: [
          {
            weekday: 1,
            startTime: '10:00',
            durationMinutes: 60,
            allocation: 5,
            leaves: [{ occurrence: 1, spacesLeft: 6 }],
          },
        ],
      }),
      'out of range',
    ],
    [
      'an occurrence past the range',
      withExperience({
        slots: [
          {
            weekday: 1,
            startTime: '10:00',
            durationMinutes: 60,
            allocation: 5,
            leaves: [{ occurrence: 10, spacesLeft: 1 }],
          },
        ],
      }),
      'out of range',
    ],
    [
      'a collection entry that is not an experience',
      {
        ...curated,
        collections: curated.collections.map((c, i) =>
          i === 0 ? { ...c, items: [{ slug: 'ghost', note: null }] } : c,
        ),
      },
      'lists "ghost"',
    ],
    [
      'a second gift guide',
      {
        ...curated,
        collections: [
          ...curated.collections,
          {
            kind: 'gift_guide' as const,
            slug: 'gift-guide-two',
            title: 'Two',
            summary: null,
            intro: null,
            status: 'draft' as const,
            items: [],
          },
        ],
      },
      'more than one gift guide',
    ],
    [
      'a home module on a collection that does not exist',
      {
        ...curated,
        homeModules: curated.homeModules.map((m) =>
          m.kind === 'picks' ? { ...m, collectionSlug: 'ghost' } : m,
        ),
      },
      '"ghost", which is not a collection',
    ],
    [
      'a picks module on the gift guide',
      {
        ...curated,
        homeModules: curated.homeModules.map((m) =>
          m.kind === 'picks' ? { ...m, collectionSlug: 'gift-guide' } : m,
        ),
      },
      'wrong kind',
    ],
    [
      'a collection on a module that shows none',
      {
        ...curated,
        homeModules: curated.homeModules.map((m) =>
          m.kind === 'this_week'
            ? { ...m, collectionSlug: 'rainy-day-sorted' }
            : m,
        ),
      },
      'Only a picks or gift_guide module points at a collection',
    ],
    [
      'page copy for a category that does not exist',
      {
        ...curated,
        pageCopy: [
          ...curated.pageCopy,
          {
            ...(curated.pageCopy[0] as CuratedFixtures['pageCopy'][number]),
            slug: 'ghost',
          },
        ],
      },
      'which is not a category',
    ],
    [
      'page copy over the length limit',
      {
        ...curated,
        pageCopy: curated.pageCopy.map((c, i) =>
          i === 0 ? { ...c, heading: 'h'.repeat(121) } : c,
        ),
      },
      'heading',
    ],
    [
      'a legal document with a bad key',
      {
        ...curated,
        legal: [
          ...curated.legal,
          { doc: 'Bad Key', title: 'T', body: paragraphs('x') },
        ],
      },
      'legal Bad Key',
    ],
  ] as [string, CuratedFixtures, string][])(
    'reports %s',
    (_name, fixtures, text) => {
      expect(issuesOf(fixtures).join('\n')).toContain(text);
    },
  );
});

describe('the tone checklist', () => {
  it.each([
    [
      'an experience name',
      withExperience({ name: 'An unforgettable day' }),
      'unforgettable',
    ],
    [
      'a description',
      withExperience({ description: 'Totally seamless.' }),
      'seamless',
    ],
    [
      'access notes',
      withExperience({ accessibilityNotes: 'Oops, stairs.' }),
      'oops',
    ],
    [
      'a phrase with an apostrophe',
      withExperience({ description: "Book now before it's gone." }),
      "book now before it's gone",
    ],
    [
      'a hyphenated phrase',
      withExperience({ included: 'A hassle-free lunch.' }),
      'hassle-free',
    ],
    [
      'a capitalised word',
      withExperience({ meetingPoint: 'UNLOCK the door' }),
      'unlock',
    ],
  ] as [string, CuratedFixtures, string][])(
    'rules out a banned word in %s',
    (_name, fixtures, word) => {
      expect(issuesOf(fixtures).join('\n')).toContain(`"${word}"`);
    },
  );

  it('rules out an exclamation mark', () => {
    expect(
      issuesOf(withExperience({ description: 'Come along!' })).join('\n'),
    ).toContain('exclamation mark');
  });

  it('rules out a banned word in editorial copy and home modules', () => {
    const fixtures: CuratedFixtures = {
      ...curated,
      collections: curated.collections.map((c, i) =>
        i === 0 ? { ...c, intro: paragraphs('A hidden gem!') } : c,
      ),
      homeModules: curated.homeModules.map((m) =>
        m.kind === 'reassurance'
          ? { ...m, body: paragraphs('Limited time only.') }
          : m,
      ),
      pageCopy: curated.pageCopy.map((c, i) =>
        i === 0 ? { ...c, metaDescription: 'A bucket list classic.' } : c,
      ),
    };
    const text = issuesOf(fixtures).join('\n');
    expect(text).toContain('"hidden gem"');
    expect(text).toContain('"limited time"');
    expect(text).toContain('"bucket list"');
  });

  it('does not take a word for a banned word that only contains it', () => {
    expect(
      fixtureIssues(
        withExperience({
          description: 'Slow loops, a successful day, and an unlocked door.',
        }),
      ),
    ).toEqual([]);
  });
});

describe('assertValidFixtures', () => {
  it('accepts the curated set', () => {
    expect(() => {
      assertValidFixtures(curated);
    }).not.toThrow();
  });

  it('throws a safe seed error listing the first ten problems and counting the rest', () => {
    const broken: CuratedFixtures = {
      ...curated,
      experiences: curated.experiences.map((e) => ({
        ...e,
        hostSlug: 'nobody',
      })),
    };
    let caught: unknown;
    try {
      assertValidFixtures(broken);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(SeedStepError);
    const message = (caught as Error).message;
    expect(
      message.split('\n').filter((line) => line.startsWith('  ')).length,
    ).toBe(11);
    expect(message).toMatch(/and \d+ more/);
  });
});
