import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  cacheEntryTagCounts,
  cacheTagBudget,
} from '@/lib/pages/cacheTagBudget';
import { tagsForChange, type CacheChange } from '@/lib/cacheTags';
import { editorialLimits } from '@/lib/editorial';
import { homeLimits } from '@/lib/pages/home';
import { upcomingWindow } from '@/lib/sessionWindow';
import { getHomeContent, getThisWeek } from './home';

// Behaviours under test, one per decision, branch or risk:
// - the home read uses the editorial profile and tags the home, the names of categories and neighborhoods, and each experience a Pick names, shown or not; it does not tag the catalog
// - the home read gets the categories and neighborhoods through getFilterOptions, once
// - every write that changes what the home page shows publishes a tag the home entry carries, and a listing change of an experience the page does not name publishes none
// - the home read asks for the Picks its modules name, once each, and for no other
// - the home read asks for the experiences its modules might show, and only those
// - the this-week read uses the browse profile, reads the window of its key, and tags the catalog and each listed experience
// - the this-week read looks up only the experiences with an open session, soonest first, and asks for their covers; the Picks experiences are read without covers
// - the this-week read refuses a key that is not an ISO instant before asking the database anything, and asks for the candidate limit's worth
// - a failed read throws only the kind of the failure, never the query or its values

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({
  cacheLife: cache.life,
  cacheTag: cache.tag,
}));

const db = vi.hoisted(() => ({
  modules: vi.fn(),
  picks: vi.fn(),
  giftGuide: vi.fn(),
  categories: vi.fn(),
  neighborhoods: vi.fn(),
  experiences: vi.fn(),
  sessions: vi.fn(),
}));
vi.mock('@/server/db/editorial', () => ({
  listHomeModules: db.modules,
  listHomePicks: db.picks,
  getPublishedGiftGuide: db.giftGuide,
}));
vi.mock('@/server/db/catalog', () => ({
  listCategories: db.categories,
  listNeighborhoods: db.neighborhoods,
}));
vi.mock('@/server/db/home', () => ({
  listHomeExperiences: db.experiences,
  listThisWeekSessions: db.sessions,
}));

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const asOf = '2026-11-02T15:00:00.000Z';

const driverError = new Error(
  'Failed query: select ... where id in ($1)\nparams: secret-id',
);

beforeEach(() => {
  vi.clearAllMocks();
  db.modules.mockResolvedValue([
    { id: id(900), kind: 'picks', collectionId: id(800) },
    { id: id(901), kind: 'reassurance', collectionId: null },
  ]);
  db.picks.mockResolvedValue([
    { id: id(800), itemCount: 2, experienceIds: [id(1), id(2)] },
  ]);
  db.giftGuide.mockResolvedValue({ id: id(802), items: [] });
  db.categories.mockResolvedValue([]);
  db.neighborhoods.mockResolvedValue([]);
  db.experiences.mockImplementation((ids: string[]) =>
    Promise.resolve(ids.map((experienceId) => ({ id: experienceId }))),
  );
});

describe('getHomeContent', () => {
  // The mocked cacheTag sees the tags of the nested getFilterOptions too, as Next hands an inner
  // entry's tags to the outer one.
  const homeEntryTags = async () => {
    cache.tag.mockClear();
    await getHomeContent();
    return (cache.tag.mock.calls as string[][]).flat();
  };

  it('uses the editorial profile and tags the home, the names, and each experience a Pick names, but not the catalog', async () => {
    const entryTags = await homeEntryTags();

    expect(cache.life).toHaveBeenCalledWith('editorial');
    expect(entryTags.toSorted()).toEqual(
      [
        'home',
        'taxonomy',
        `experience:${id(1)}`,
        `experience:${id(2)}`,
      ].toSorted(),
    );
    expect(entryTags).not.toContain('catalog');
  });

  it('carries no more tags than the budget when every module names more candidates than it can look up', async () => {
    const moduleCount = editorialLimits.homeModules;
    const collection = (m: number) => id(800 + m);
    db.modules.mockResolvedValue(
      Array.from({ length: moduleCount }, (_, m) => ({
        id: id(900 + m),
        kind: 'picks',
        collectionId: collection(m),
      })),
    );
    db.picks.mockResolvedValue(
      Array.from({ length: moduleCount }, (_, m) => ({
        id: collection(m),
        itemCount: 1000,
        experienceIds: Array.from({ length: 1000 }, (_, e) =>
          id(10_000 * (m + 1) + e),
        ),
      })),
    );

    const entryTags = await homeEntryTags();

    expect(entryTags).toHaveLength(cacheEntryTagCounts.home);
    expect(entryTags.length).toBeLessThanOrEqual(cacheTagBudget);
  });

  it('tags a Pick experience that guests cannot see yet, so publishing it reaches the page', async () => {
    db.experiences.mockResolvedValue([{ id: id(1) }]);

    expect(await homeEntryTags()).toContain(`experience:${id(2)}`);
  });

  it('reads the categories and neighborhoods once, through the shared read', async () => {
    await getHomeContent();

    expect(db.categories).toHaveBeenCalledOnce();
    expect(db.neighborhoods).toHaveBeenCalledOnce();
  });

  describe('a write reaches the home entry', () => {
    const hidden = id(2);
    const unrelated = id(77);
    const listing = (experienceId: string): CacheChange => ({
      kind: 'listing',
      id: experienceId,
      categorySlugs: ['kayaking'],
      neighborhoodSlug: 'red-hook',
    });

    it.each<[string, CacheChange]>([
      [
        'the name, price, status, or cover of a card experience',
        listing(id(1)),
      ],
      ['the publication of a Pick experience that was hidden', listing(hidden)],
      ['a home module edit', { kind: 'homeModules' }],
      ['a Pick edit', { kind: 'pick', slug: 'summer' }],
      ['a gift guide edit', { kind: 'giftGuide' }],
      ['a category or neighborhood rename', { kind: 'taxonomy' }],
    ])('%s', async (_name, change) => {
      const entryTags = await homeEntryTags();

      expect(tagsForChange(change).some((tag) => entryTags.includes(tag))).toBe(
        true,
      );
    });

    it.each<[string, CacheChange]>([
      ['a listing change of an experience no module names', listing(unrelated)],
      ['category page copy', { kind: 'categoryCopy', slug: 'kayaking' }],
      ['a booking', { kind: 'spaces', sessionId: id(500) }],
    ])('%s leaves it alone', async (_name, change) => {
      const entryTags = await homeEntryTags();

      expect(tagsForChange(change).some((tag) => entryTags.includes(tag))).toBe(
        false,
      );
    });
  });

  it('hands over the published gift guide', async () => {
    const content = await getHomeContent();

    expect(content.giftGuide).toEqual({ id: id(802), items: [] });
  });

  it('reads the Picks its Picks modules name, once each, and not the gift guide collection', async () => {
    db.modules.mockResolvedValue([
      { id: id(900), kind: 'picks', collectionId: id(800) },
      { id: id(901), kind: 'picks', collectionId: id(803) },
      { id: id(902), kind: 'picks', collectionId: id(800) },
      { id: id(903), kind: 'gift_guide', collectionId: id(802) },
      { id: id(904), kind: 'picks', collectionId: null },
    ]);

    await getHomeContent();

    expect(db.picks).toHaveBeenCalledExactlyOnceWith([id(800), id(803)]);
  });

  it('looks up the experiences the Picks modules might show, and no others', async () => {
    const content = await getHomeContent();

    expect(db.experiences).toHaveBeenCalledExactlyOnceWith([id(1), id(2)], {
      covers: false,
    });
    expect(content.experiences).toEqual([{ id: id(1) }, { id: id(2) }]);
  });

  it('throws only the kind of a failed read', async () => {
    db.picks.mockRejectedValue(driverError);

    const failure = await getHomeContent().catch((error: unknown) => error);

    expect(failure).toMatchObject({ message: 'Home read failed: Error' });
    expect(JSON.stringify(failure)).not.toContain('secret-id');
  });
});

describe('getThisWeek', () => {
  const session = (n: number, minutes: number, seatsSold = 0) => ({
    experienceId: id(n),
    experienceStatus: 'live',
    startsAt: new Date(Date.parse(asOf) + minutes * 60_000),
    allocation: 10,
    seatsSold,
  });

  it('uses the browse profile and tags the catalog and each listed experience', async () => {
    db.sessions.mockResolvedValue([session(1, 60), session(2, 30)]);

    const content = await getThisWeek(asOf);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('browse');
    expect(cache.tag.mock.calls.flat()).toEqual([
      'catalog',
      `experience:${id(2)}`,
      `experience:${id(1)}`,
    ]);
    expect(content.experienceIds).toEqual([id(2), id(1)]);
  });

  it('reads the week that starts at its key', async () => {
    db.sessions.mockResolvedValue([]);

    await getThisWeek(asOf);

    expect(db.sessions).toHaveBeenCalledExactlyOnceWith(
      upcomingWindow(asOf, homeLimits.thisWeekDays),
    );
  });

  it('looks up only the experiences with an open session', async () => {
    db.sessions.mockResolvedValue([session(1, 60, 10), session(2, 30)]);

    await getThisWeek(asOf);

    expect(db.experiences).toHaveBeenCalledExactlyOnceWith([id(2)], {
      covers: true,
    });
  });

  it.each(['not a date', '2026-11-02', ''])(
    'refuses the key %j before asking the database anything',
    async (key) => {
      const failure = await getThisWeek(key).catch((error: unknown) => error);

      expect(failure).toMatchObject({
        message: 'This week read failed: ZodError',
      });
      expect(db.sessions).not.toHaveBeenCalled();
      expect(db.experiences).not.toHaveBeenCalled();
    },
  );

  it('looks up as many candidates as the limit names', async () => {
    db.sessions.mockResolvedValue(
      Array.from({ length: homeLimits.thisWeekCandidates + 5 }, (_, n) =>
        session(n + 1, n + 1),
      ),
    );

    await getThisWeek(asOf);

    expect(db.experiences.mock.calls[0]?.[0]).toHaveLength(
      homeLimits.thisWeekCandidates,
    );
  });

  it('throws only the kind of a failed read', async () => {
    db.sessions.mockRejectedValue(driverError);

    const failure = await getThisWeek(asOf).catch((error: unknown) => error);

    expect(failure).toMatchObject({ message: 'This week read failed: Error' });
    expect(JSON.stringify(failure)).not.toContain('secret-id');
  });
});
