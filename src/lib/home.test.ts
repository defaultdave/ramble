import { describe, expect, it } from 'vitest';
import { ZodError } from 'zod';
import type { Collection, HomeModule } from './editorial';
import type { CardExperience } from './experienceCards';
import {
  buildHomePage,
  homeCopy,
  homeCardIds,
  homeExperienceIds,
  HomeExperienceIdsSchema,
  homeLimits,
  thisWeekExperienceIds,
  thisWeekWindow,
  withHomeCovers,
  type HomeInput,
  type HomeModuleView,
  type ThisWeekSession,
} from './home';
import { paragraphs } from './richText/paragraphs';
import { minuteAsOf } from './time';

// Behaviours under test, one per decision, branch or risk:
// - the cache key is the minute; the week window runs a week from it; a key that is not the ISO instant minuteAsOf writes is refused
// - the browse address writes only the parameters that are set, escaped, in the grammar order
// - "On this week" lists bookable experiences with an open session in the window, soonest first, once each
//   (a started, late, full, or guide-only session does not count; the edges of the window are exact)
// - the experiences a Picks module may show are looked up once, bounded per collection and in all
// - each module shows its own copy or the default, and is left out whole when it has nothing to show
// - the first Picks module alone carries the anchor
// - the page is empty when no module shows, and needs its own title when there is no hero
// - a card starts with no photo; the page's card IDs are those of its Picks and this-week cards, each once, and none for an empty page
// - a cover is set on the cards of Picks and this-week modules only, and a card with no cover keeps none
// - the banner is its trimmed text, or nothing when there is none

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function experience(
  n: number,
  overrides: Partial<CardExperience> = {},
): CardExperience {
  return {
    id: id(n),
    slug: `thing-${String(n)}`,
    name: `Thing ${String(n)}`,
    status: 'live',
    neighborhoodName: 'Greenpoint',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 7000, usesSpace: true }],
    ...overrides,
  };
}

const date = new Date('2026-11-02T15:00:00.000Z');

function session(
  n: number,
  minutesFromNow: number,
  overrides: Partial<ThisWeekSession> = {},
): ThisWeekSession {
  return {
    experienceId: id(n),
    experienceStatus: 'live',
    startsAt: new Date(date.getTime() + minutesFromNow * 60_000),
    allocation: 10,
    seatsSold: 0,
    ...overrides,
  };
}

const window = thisWeekWindow(date.toISOString());

describe('thisWeekWindow', () => {
  it('runs the window from the key to seven days later', () => {
    expect(window.from.toISOString()).toBe('2026-11-02T15:00:00.000Z');
    expect(window.to.toISOString()).toBe('2026-11-09T15:00:00.000Z');
  });

  it.each([
    ['text', 'not a date'],
    ['a date with no time', '2026-11-02'],
    ['a time with an offset', '2026-11-02T15:00:00.000+02:00'],
    ['an empty key', ''],
    ['a month that does not exist', '2026-13-02T15:00:00.000Z'],
  ])('refuses a key that is %s', (_name, key) => {
    expect(() => thisWeekWindow(key)).toThrow(ZodError);
  });

  it('accepts the key minuteAsOf writes', () => {
    expect(() =>
      thisWeekWindow(minuteAsOf(new Date('2026-11-02T15:00:59.999Z'))),
    ).not.toThrow();
  });
});

describe('HomeExperienceIdsSchema', () => {
  it('accepts up to the limit of IDs', () => {
    const ids = Array.from({ length: homeLimits.maxCardIds }, (_, n) => id(n));
    expect(HomeExperienceIdsSchema.parse(ids)).toEqual(ids);
  });

  it.each([
    [
      'one past the limit',
      Array.from({ length: homeLimits.maxCardIds + 1 }, (_, n) => id(n)),
    ],
    ['an ID that is not a uuid', ['not-a-uuid']],
    ['an empty ID', ['']],
  ])('refuses %s', (_name, ids) => {
    expect(() => HomeExperienceIdsSchema.parse(ids)).toThrow(ZodError);
  });
});

describe('homeLimits', () => {
  it('looks up more candidates for "On this week" than it shows', () => {
    expect(homeLimits.thisWeekCandidates).toBeGreaterThan(
      homeLimits.thisWeekShown,
    );
  });
});

describe('thisWeekExperienceIds', () => {
  it('lists the soonest session first, each experience once', () => {
    const sessions = [
      session(2, 600),
      session(1, 300),
      session(2, 100),
      session(3, 400),
    ];
    expect(thisWeekExperienceIds(sessions, window, 10)).toEqual([
      id(2),
      id(1),
      id(3),
    ]);
  });

  it('breaks a tie on the start by experience ID', () => {
    expect(
      thisWeekExperienceIds([session(2, 60), session(1, 60)], window, 10),
    ).toEqual([id(1), id(2)]);
  });

  it.each([
    ['one that has started', session(1, -1)],
    ['one that starts exactly now', session(1, 0)],
    ['one past the end of the week', session(1, 7 * 24 * 60 + 1)],
    ['one with no space left', session(1, 60, { seatsSold: 10 })],
    ['one oversold', session(1, 60, { seatsSold: 12 })],
    [
      'one of a guide entry',
      session(1, 60, { experienceStatus: 'guide_only' }),
    ],
  ])('does not count %s', (_name, excluded) => {
    expect(thisWeekExperienceIds([excluded], window, 10)).toEqual([]);
  });

  it.each([
    ['one a minute from now', session(1, 1)],
    ['one that starts exactly at the end of the week', session(1, 7 * 24 * 60)],
    ['one with a single space left', session(1, 60, { seatsSold: 9 })],
  ])('counts %s', (_name, included) => {
    expect(thisWeekExperienceIds([included], window, 10)).toEqual([id(1)]);
  });

  it('counts an experience with one open session among full ones', () => {
    const sessions = [session(1, 60, { seatsSold: 10 }), session(1, 120)];
    expect(thisWeekExperienceIds(sessions, window, 10)).toEqual([id(1)]);
  });

  it('stops at the limit', () => {
    const sessions = [session(1, 10), session(2, 20), session(3, 30)];
    expect(thisWeekExperienceIds(sessions, window, 2)).toEqual([id(1), id(2)]);
  });
});

function module(
  n: number,
  kind: HomeModule['kind'],
  overrides: Partial<HomeModule> = {},
): HomeModule {
  return {
    id: id(900 + n),
    position: n,
    kind,
    enabled: true,
    heading: null,
    collectionId: null,
    body: null,
    ...overrides,
  };
}

function collection(
  n: number,
  experienceNumbers: number[],
  overrides: Partial<Collection> = {},
): Collection {
  return {
    id: id(800 + n),
    kind: 'pick',
    slug: `pick-${String(n)}`,
    title: `Pick ${String(n)}`,
    summary: `About pick ${String(n)}`,
    status: 'published',
    intro: null,
    publishedAt: null,
    updatedAt: date,
    items: experienceNumbers.map((e) => ({
      experienceId: id(e),
      note: null,
    })),
    ...overrides,
  };
}

const baseInput: HomeInput = {
  modules: [],
  picks: [],
  categories: [
    { id: id(700), slug: 'cooking', name: 'Cooking' },
    { id: id(701), slug: 'wine', name: 'Wine and cocktails' },
  ],
  neighborhoods: [{ id: id(600), slug: 'dumbo', name: 'DUMBO' }],
  experiences: [],
  thisWeek: { experienceIds: [], experiences: [] },
  settings: { giftsEnabled: true },
};

function modulesOf(input: Partial<HomeInput>): HomeModuleView[] {
  const page = buildHomePage({ ...baseInput, ...input });
  return page.kind === 'modules' ? page.modules : [];
}

describe('homeExperienceIds', () => {
  it('collects the entries of each Picks module once', () => {
    const picks = [collection(1, [1, 2]), collection(2, [2, 3])];
    const modules = [
      module(1, 'picks', { collectionId: picks[0]?.id ?? null }),
      module(2, 'picks', { collectionId: picks[1]?.id ?? null }),
    ];
    expect(homeExperienceIds(modules, picks)).toEqual([id(1), id(2), id(3)]);
  });

  it('looks only at the first entries of a long collection', () => {
    const many = Array.from({ length: 30 }, (_, i) => i + 1);
    const picks = [collection(1, many)];
    const modules = [module(1, 'picks', { collectionId: id(801) })];
    expect(homeExperienceIds(modules, picks)).toHaveLength(
      homeLimits.picksCandidates,
    );
  });

  it('is bounded in all, whatever the modules and collections hold', () => {
    const picks = Array.from({ length: 20 }, (_, c) =>
      collection(
        c + 1,
        Array.from({ length: 12 }, (_, e) => c * 12 + e + 1),
      ),
    );
    const modules = picks.map((pick, i) =>
      module(i + 1, 'picks', { collectionId: pick.id }),
    );
    expect(homeExperienceIds(modules, picks).length).toBeLessThanOrEqual(
      homeLimits.maxCardIds,
    );
  });

  it.each([
    ['a module of another kind', module(1, 'this_week')],
    ['a Picks module with no collection', module(1, 'picks')],
    [
      'a Picks module whose collection is not published',
      module(1, 'picks', { collectionId: id(899) }),
    ],
  ])('ignores %s', (_name, ignored) => {
    expect(homeExperienceIds([ignored], [collection(1, [1])])).toEqual([]);
  });
});

describe('buildHomePage hero', () => {
  it('shows the default copy for a hero with none, with the neighborhoods to search', () => {
    const [hero] = modulesOf({ modules: [module(1, 'hero_search')] });
    expect(hero).toEqual({
      kind: 'hero_search',
      id: id(901),
      eyebrow: homeCopy.heroEyebrow,
      heading: homeCopy.heroHeading,
      body: paragraphs(homeCopy.heroBody),
      neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
    });
  });

  it('shows the heading and body staff wrote', () => {
    const body = paragraphs('Pasta, mostly.');
    const [hero] = modulesOf({
      modules: [module(1, 'hero_search', { heading: 'Eat more', body })],
    });
    expect(hero).toMatchObject({ heading: 'Eat more', body });
  });

  it('falls back to the default body when the written one is empty', () => {
    const [hero] = modulesOf({
      modules: [
        module(1, 'hero_search', { body: { type: 'doc', content: [] } }),
      ],
    });
    expect(hero).toMatchObject({ body: paragraphs(homeCopy.heroBody) });
  });
});

describe('buildHomePage category rail', () => {
  it('links each category to the browse page filtered by it', () => {
    const [rail] = modulesOf({ modules: [module(1, 'category_rail')] });
    expect(rail).toMatchObject({
      heading: homeCopy.categoryHeading,
      categories: [
        {
          slug: 'cooking',
          name: 'Cooking',
          href: '/new-york/browse?category=cooking',
        },
        {
          slug: 'wine',
          name: 'Wine and cocktails',
          href: '/new-york/browse?category=wine',
        },
      ],
    });
  });

  it('is left out when there is no category', () => {
    expect(
      modulesOf({ modules: [module(1, 'category_rail')], categories: [] }),
    ).toEqual([]);
  });
});

describe('buildHomePage picks', () => {
  const experiences = [1, 2, 3, 4, 5].map((n) => experience(n));

  it('shows the Pick under its own title, summary, and see-all link', () => {
    const picks = [collection(1, [1, 2, 3, 4, 5])];
    const [view] = modulesOf({
      modules: [module(1, 'picks', { collectionId: id(801) })],
      picks,
      experiences,
    });
    expect(view).toMatchObject({
      kind: 'picks',
      eyebrow: homeCopy.picksEyebrow,
      heading: 'Pick 1',
      summary: 'About pick 1',
      seeAll: { href: '/picks/pick-1', label: 'See all 5 picks' },
    });
  });

  it('prefers the heading staff gave the module', () => {
    const [view] = modulesOf({
      modules: [
        module(1, 'picks', { collectionId: id(801), heading: 'Rainy day' }),
      ],
      picks: [collection(1, [1])],
      experiences,
    });
    expect(view).toMatchObject({ heading: 'Rainy day' });
  });

  it('shows at most three cards, in the Pick order', () => {
    const [view] = modulesOf({
      modules: [module(1, 'picks', { collectionId: id(801) })],
      picks: [collection(1, [5, 4, 3, 2, 1])],
      experiences,
    });
    expect(view?.kind === 'picks' && view.cards.map((c) => c.id)).toEqual([
      id(5),
      id(4),
      id(3),
    ]);
  });

  it('takes the next entry when one cannot be a card', () => {
    const [view] = modulesOf({
      modules: [module(1, 'picks', { collectionId: id(801) })],
      picks: [collection(1, [6, 1, 2, 3])],
      experiences: [...experiences, experience(6, { priceOptions: [] })],
    });
    expect(view?.kind === 'picks' && view.cards.map((c) => c.id)).toEqual([
      id(1),
      id(2),
      id(3),
    ]);
  });

  it.each([
    ['a module with no collection', module(1, 'picks'), [collection(1, [1])]],
    [
      'a collection that is not published',
      module(1, 'picks', { collectionId: id(801) }),
      [],
    ],
    [
      'a collection none of whose entries can be a card',
      module(1, 'picks', { collectionId: id(801) }),
      [collection(1, [9])],
    ],
  ])('is left out for %s', (_name, picksModule, picks) => {
    expect(modulesOf({ modules: [picksModule], picks, experiences })).toEqual(
      [],
    );
  });

  it('puts the anchor on the first Picks module only', () => {
    const views = modulesOf({
      modules: [
        module(1, 'picks', { collectionId: id(801) }),
        module(2, 'picks', { collectionId: id(802) }),
      ],
      picks: [collection(1, [1]), collection(2, [2])],
      experiences,
    });
    expect(views.map((v) => v.kind === 'picks' && v.anchor)).toEqual([
      'picks',
      undefined,
    ]);
  });

  it('puts the anchor on the first Picks module that shows, not the first configured', () => {
    const views = modulesOf({
      modules: [
        module(1, 'picks', { collectionId: id(801) }),
        module(2, 'picks', { collectionId: id(802) }),
      ],
      picks: [collection(2, [2])],
      experiences,
    });
    expect(views).toHaveLength(1);
    expect(views[0]).toMatchObject({ anchor: 'picks' });
  });
});

describe('buildHomePage gift guide', () => {
  it('shows the sponsor line and a link to the gift guide', () => {
    const [view] = modulesOf({ modules: [module(1, 'gift_guide')] });
    expect(view).toEqual({
      kind: 'gift_guide',
      id: id(901),
      eyebrow: homeCopy.giftGuideEyebrow,
      heading: homeCopy.giftGuideHeading,
      body: null,
      action: { href: '/gifts', label: homeCopy.giftGuideAction },
      sponsor: homeCopy.giftGuideSponsor,
    });
  });

  it('shows the heading and body staff wrote', () => {
    const body = paragraphs('Give a Saturday.');
    const [view] = modulesOf({
      modules: [module(1, 'gift_guide', { heading: 'Not a sweater', body })],
    });
    expect(view).toMatchObject({ heading: 'Not a sweater', body });
  });

  it('is left out while gifts are switched off', () => {
    expect(
      modulesOf({
        modules: [module(1, 'gift_guide')],
        settings: { giftsEnabled: false },
      }),
    ).toEqual([]);
  });
});

describe('buildHomePage this week', () => {
  const thisWeek = {
    experienceIds: [id(2), id(9), id(1), id(3), id(4), id(5)],
    experiences: [1, 2, 3, 4, 5].map((n) => experience(n)),
  };

  it('shows at most four cards, soonest first, skipping an ID with no experience', () => {
    const [view] = modulesOf({ modules: [module(1, 'this_week')], thisWeek });
    expect(view?.kind === 'this_week' && view.cards.map((c) => c.id)).toEqual([
      id(2),
      id(1),
      id(3),
      id(4),
    ]);
    expect(view).toMatchObject({ heading: homeCopy.thisWeekHeading });
  });

  it('is left out when no session is open', () => {
    expect(modulesOf({ modules: [module(1, 'this_week')] })).toEqual([]);
  });
});

describe('buildHomePage page', () => {
  it('lists the reassurance facts', () => {
    const [view] = modulesOf({ modules: [module(1, 'reassurance')] });
    expect(view).toEqual({
      kind: 'reassurance',
      id: id(901),
      facts: homeCopy.reassurance,
    });
  });

  it('keeps the order staff arranged', () => {
    const views = modulesOf({
      modules: [
        module(1, 'reassurance'),
        module(2, 'hero_search'),
        module(3, 'category_rail'),
      ],
    });
    expect(views.map((v) => v.kind)).toEqual([
      'reassurance',
      'hero_search',
      'category_rail',
    ]);
  });

  it('is empty when no module is switched on', () => {
    expect(buildHomePage(baseInput)).toEqual({ kind: 'empty' });
  });

  it('is empty when every module has nothing to show', () => {
    expect(
      buildHomePage({
        ...baseInput,
        modules: [module(1, 'this_week'), module(2, 'picks')],
      }),
    ).toEqual({ kind: 'empty' });
  });

  it.each([
    ['carries its own title', [module(1, 'hero_search')], false],
    ['needs a title when there is no hero', [module(1, 'reassurance')], true],
  ])('a page that %s', (_name, modules, needsTitle) => {
    expect(buildHomePage({ ...baseInput, modules })).toMatchObject({
      needsTitle,
    });
  });
});

describe('covers on the home page', () => {
  const cover = {
    src: 'https://store.example/a.jpg',
    width: 1600,
    height: 1000,
    alt: 'A kayak at dusk',
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  };
  const picks = [collection(1, [1, 2])];
  const input: Partial<HomeInput> = {
    modules: [
      module(1, 'picks', { collectionId: picks[0]?.id ?? null }),
      module(2, 'this_week'),
      module(3, 'reassurance'),
    ],
    picks,
    experiences: [experience(1), experience(2)],
    thisWeek: {
      experienceIds: [id(2), id(3)],
      experiences: [experience(2), experience(3)],
    },
  };
  const page = buildHomePage({ ...baseInput, ...input });

  it('lists each card experience once, across the Picks and this-week modules', () => {
    expect(homeCardIds(page)).toEqual([id(1), id(2), id(3)]);
  });

  it('lists none for an empty page', () => {
    expect(homeCardIds({ kind: 'empty' })).toEqual([]);
  });

  it('sets the cover of each card that has one and leaves the others without', () => {
    const covered = withHomeCovers(page, new Map([[id(2), cover]]));

    const cards =
      covered.kind === 'modules'
        ? covered.modules.flatMap((view) =>
            view.kind === 'picks' || view.kind === 'this_week'
              ? view.cards
              : [],
          )
        : [];
    expect(cards.map((card) => [card.id, card.image?.alt ?? null])).toEqual([
      [id(1), null],
      [id(2), 'A kayak at dusk'],
      [id(2), 'A kayak at dusk'],
      [id(3), null],
    ]);
  });

  it('returns an empty page as it is', () => {
    expect(withHomeCovers({ kind: 'empty' }, new Map())).toEqual({
      kind: 'empty',
    });
  });

  it('keeps the modules that have no cards', () => {
    const covered = withHomeCovers(page, new Map());
    expect(covered.kind === 'modules' && covered.modules.at(-1)?.kind).toBe(
      'reassurance',
    );
  });
});
