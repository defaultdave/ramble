import { describe, expect, it } from 'vitest';
import {
  BrowseDayRowsSchema,
  browseCardIds,
  browseDays,
  browseDateHorizonDays,
  browseHeading,
  browseTitle,
  browsePageSize,
  browseView,
  browseWindowDays,
  dateChipLabel,
  errorView,
  maxHandEnteredDayRows,
  maxStoredDayRows,
  resultsSummary,
  nextBrowseDay,
  splitPage,
  toBrowsePage,
  withBrowseCovers,
  type BrowsePage,
  type BrowseView,
  type BrowseRead,
} from './browse';
import type { CardExperience } from './experienceCards';
import { noFilters, type BrowseFilters } from './filters';

// Behaviours under test, one per decision, branch or risk:
// - the window runs from the cache time to the horizon
// - a page is cut from page size plus one rows: the extra row makes the cursor and is not shown
// - a read becomes a page, and a cursor with no visible row is an outdated page, not an empty one
// - the calendar days: a generated session keeps its stored date, a hand-entered one is on the day its start falls on in its own zone
//   (east of UTC, west of UTC, a clock-change day), days are merged, de-duplicated, and sorted, and an unknown zone refuses the read
// - the raw calendar rows are bounded: too many stored dates or hand-entered sessions, a bad date, or a bad zone is refused
// - the summary line counts the cards
// - the experiences of a page are its items, and none for an outdated page
// - a cover is set on the cards of a results view, and any other view is returned as it is
// - each results state is chosen from the page: outdated cursor, empty (filtered or not), results with or without more, later page, error
// - a dated empty page offers the next day with sessions (other filters kept) and any day; when the window has none it offers only any day
// - the next day is the first listed day after the chosen one: the day after, a gap, none left, today whose sessions have all started (not listed), a date before every listed day, an empty list

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
    neighborhoodName: 'DUMBO',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 8500, usesSpace: true }],
    ...overrides,
  };
}

describe('browseWindowDays', () => {
  it('covers the horizon and the whole last day', () => {
    expect(browseWindowDays).toBe(browseDateHorizonDays + 1);
  });
});

describe('splitPage', () => {
  const rows = (count: number) =>
    Array.from({ length: count }, (_, i) => ({ id: id(i + 1) }));

  it('has no next page when there are fewer rows than a page', () => {
    expect(splitPage(rows(3), 5)).toEqual({ items: rows(3), nextCursor: null });
  });

  it('has no next page when the rows fill a page exactly', () => {
    expect(splitPage(rows(5), 5).nextCursor).toBeNull();
  });

  it('shows a page and starts the next after its last row when one more is read', () => {
    const page = splitPage(rows(6), 5);
    expect(page.items).toEqual(rows(5));
    expect(page.nextCursor).toBe(id(5));
  });

  it('handles no rows', () => {
    expect(splitPage([], 5)).toEqual({ items: [], nextCursor: null });
  });
});

describe('toBrowsePage', () => {
  const items = [experience(1), experience(2)];
  const read = (overrides: Partial<BrowseRead> = {}): BrowseRead => ({
    cursor: null,
    items,
    nextCursor: null,
    ...overrides,
  });

  it('is the items and next cursor of a first page, which has no cursor row', () => {
    expect(toBrowsePage(null, read({ nextCursor: id(2) }))).toEqual({
      ok: true,
      items,
      nextCursor: id(2),
    });
  });

  it('is the page after a cursor whose row was found', () => {
    expect(
      toBrowsePage(id(9), read({ cursor: { id: id(9), name: 'Thing 9' } })),
    ).toEqual({ ok: true, items, nextCursor: null });
  });

  it('is an empty page, not an outdated one, when a first page has no items', () => {
    expect(toBrowsePage(null, read({ items: [] }))).toEqual({
      ok: true,
      items: [],
      nextCursor: null,
    });
  });

  it('is outdated when the cursor names no visible experience, even with items', () => {
    expect(toBrowsePage(id(9), read())).toEqual({
      ok: false,
      reason: 'cursor_not_found',
    });
  });

  it('is outdated, not empty, for the read the data layer gives a cursor it cannot find', () => {
    // No row, no items, no next page: what listBrowseExperiences answers for a hidden or unknown `after`.
    const notFound = read({ cursor: null, items: [], nextCursor: null });
    expect(toBrowsePage(id(9), notFound)).toEqual({
      ok: false,
      reason: 'cursor_not_found',
    });
  });
});

describe('resultsSummary', () => {
  it.each([
    [1, false, '1 experience'],
    [12, false, '12 experiences'],
    [12, true, 'Showing 12 experiences'],
    [1, true, 'Showing 1 experience'],
  ])('writes %i shown, more=%s', (shown, hasMore, text) => {
    expect(resultsSummary(shown, hasMore)).toBe(text);
  });
});

describe('dateChipLabel', () => {
  it.each([
    ['2026-11-07', 'Sat, Nov 7'],
    ['2026-12-31', 'Thu, Dec 31'],
    ['2027-01-01', 'Fri, Jan 1'],
  ])('writes %s as %s', (date, label) => {
    expect(dateChipLabel(date)).toBe(label);
  });
});

describe('nextBrowseDay', () => {
  const days = ['2026-10-29', '2026-11-02', '2026-11-03'];

  it.each([
    ['the day after', '2026-10-29', '2026-11-02'],
    ['across a gap', '2026-10-31', '2026-11-02'],
    [
      'today with every session already started, so it is not listed',
      '2026-10-28',
      '2026-10-29',
    ],
    ['a day before every listed day', '2026-01-01', '2026-10-29'],
    ['the last listed day', '2026-11-03', null],
    ['a day past the window', '2027-03-01', null],
  ])('%s', (_name, date, expected) => {
    expect(nextBrowseDay(days, date)).toBe(expected);
  });

  it('is null when no day is listed', () => {
    expect(nextBrowseDay([], '2026-10-28')).toBeNull();
  });
});

describe('browseView', () => {
  const cursor = id(99);
  const firstPage = { filters: noFilters, after: null };

  it('says the cursor is outdated and goes back to the first results with the same filters', () => {
    const page: BrowsePage = { ok: false, reason: 'cursor_not_found' };
    expect(
      browseView(
        { filters: { ...noFilters, categories: ['cooking'] }, after: cursor },
        page,
        [],
      ),
    ).toEqual({
      state: 'outdated',
      startHref: '/new-york/browse?category=cooking',
    });
  });

  it('is empty and unfiltered when nothing is listed and no filter is on', () => {
    expect(
      browseView(firstPage, { ok: true, items: [], nextCursor: null }, []),
    ).toEqual({ state: 'empty', filtered: false, dated: null });
  });

  it('is empty and filtered, with no way forward by day, when a category is on and no date', () => {
    expect(
      browseView(
        { filters: { ...noFilters, categories: ['cooking'] }, after: null },
        { ok: true, items: [], nextCursor: null },
        ['2026-11-09'],
      ),
    ).toEqual({ state: 'empty', filtered: true, dated: null });
  });

  describe('a dated empty page', () => {
    const empty: BrowsePage = { ok: true, items: [], nextCursor: null };
    const days = ['2026-11-05', '2026-11-09', '2026-11-12'];

    it('offers the next day with sessions and any day, keeping the other filters', () => {
      expect(
        browseView(
          {
            filters: {
              categories: ['cooking'],
              neighborhoods: ['dumbo'],
              date: '2026-11-07',
            },
            after: null,
          },
          empty,
          days,
        ),
      ).toEqual({
        state: 'empty',
        filtered: true,
        dated: {
          dateLabel: 'Sat, Nov 7',
          nextDay: {
            label: 'Mon, Nov 9',
            href: '/new-york/browse?category=cooking&neighborhood=dumbo&date=2026-11-09',
          },
          anyDayHref: '/new-york/browse?category=cooking&neighborhood=dumbo',
          message: 'The next day with experiences is Mon, Nov 9.',
        },
      });
    });

    it('offers only any day, and says no later day has experiences, when the window has none', () => {
      expect(
        browseView(
          { filters: { ...noFilters, date: '2026-11-12' }, after: null },
          empty,
          days,
        ),
      ).toEqual({
        state: 'empty',
        filtered: true,
        dated: {
          dateLabel: 'Thu, Nov 12',
          nextDay: null,
          anyDayHref: '/new-york/browse',
          message: 'There are no experiences on later days.',
        },
      });
    });
  });

  it('shows the cards and a Show more that carries the filters and the next cursor', () => {
    const view = browseView(
      { filters: { ...noFilters, categories: ['cooking'] }, after: null },
      { ok: true, items: [experience(1), experience(2)], nextCursor: id(2) },
      [],
    );
    expect(view).toMatchObject({
      state: 'results',
      summary: 'Showing 2 experiences',
      startHref: null,
      showMore: {
        action: '/new-york/browse',
        fields: [
          ['category', 'cooking'],
          ['after', id(2)],
        ],
      },
    });
    expect(view.state === 'results' && view.cards).toHaveLength(2);
  });

  it('leaves out a card that cannot be built and counts only the ones shown', () => {
    const view = browseView(
      firstPage,
      {
        ok: true,
        items: [
          experience(1),
          experience(2, { priceOptions: [] }),
          experience(3),
        ],
        nextCursor: null,
      },
      [],
    );
    expect(view).toMatchObject({ state: 'results', summary: '2 experiences' });
    expect(view.state === 'results' && view.cards.map((c) => c.id)).toEqual([
      id(1),
      id(3),
    ]);
  });

  it('is empty when no card on the last page can be built', () => {
    expect(
      browseView(
        firstPage,
        {
          ok: true,
          items: [experience(2, { priceOptions: [] })],
          nextCursor: null,
        },
        [],
      ),
    ).toEqual({ state: 'empty', filtered: false, dated: null });
  });

  it('keeps Show more when a full page has no buildable card but another page follows', () => {
    const view = browseView(
      firstPage,
      {
        ok: true,
        items: [experience(2, { priceOptions: [] })],
        nextCursor: id(2),
      },
      [],
    );
    expect(view).toMatchObject({ state: 'results', cards: [] });
    expect(view.state === 'results' && view.showMore).not.toBeNull();
  });

  it('has no Show more on the last page', () => {
    expect(
      browseView(
        firstPage,
        {
          ok: true,
          items: [experience(1)],
          nextCursor: null,
        },
        [],
      ),
    ).toMatchObject({
      state: 'results',
      summary: '1 experience',
      showMore: null,
    });
  });

  it('offers the first results again on a later page', () => {
    expect(
      browseView(
        { filters: { ...noFilters, neighborhoods: ['dumbo'] }, after: cursor },
        { ok: true, items: [experience(1)], nextCursor: null },
        [],
      ),
    ).toMatchObject({ startHref: '/new-york/browse?neighborhood=dumbo' });
  });

  it('never shows more than one page of cards from a full read', () => {
    const rows = Array.from({ length: browsePageSize }, (_, i) =>
      experience(i + 1),
    );
    const view = browseView(
      firstPage,
      {
        ok: true,
        items: rows,
        nextCursor: rows[rows.length - 1]?.id ?? null,
      },
      [],
    );
    expect(view.state === 'results' && view.cards).toHaveLength(browsePageSize);
  });
});

describe('covers on browse results', () => {
  const cover = {
    src: 'https://store.example/a.jpg',
    width: 1600,
    height: 1000,
    alt: 'A kayak at dusk',
    blurDataUrl: 'data:image/jpeg;base64,/9j/4AAQ',
  };
  const page: BrowsePage = {
    ok: true,
    items: [experience(1), experience(2)],
    nextCursor: null,
  };

  it('lists the experiences of a page, and none for an outdated one', () => {
    expect(browseCardIds(page)).toEqual([id(1), id(2)]);
    expect(browseCardIds({ ok: false, reason: 'cursor_not_found' })).toEqual(
      [],
    );
  });

  it('sets the cover of each card that has one', () => {
    const view = withBrowseCovers(
      browseView({ filters: noFilters, after: null }, page, []),
      new Map([[id(2), cover]]),
    );

    expect(view.state === 'results' && view.cards.map((c) => c.image)).toEqual([
      null,
      cover,
    ]);
  });

  it.each([
    [{ state: 'empty', filtered: false, dated: null } as const],
    [{ state: 'outdated', startHref: '/new-york/browse' } as const],
  ])('returns %j as it is', (view) => {
    expect(withBrowseCovers(view, new Map([[id(1), cover]]))).toBe(view);
  });
});

describe('errorView', () => {
  it('retries the same address, cursor included', () => {
    expect(
      errorView({
        filters: { ...noFilters, date: '2026-11-07' },
        after: id(5),
      }),
    ).toEqual({
      state: 'error',
      retry: {
        action: '/new-york/browse',
        fields: [
          ['date', '2026-11-07'],
          ['after', id(5)],
        ],
      },
    });
  });
});

describe('browseDays', () => {
  const at = (startsAt: string, timeZone: string) => ({
    startsAt: new Date(startsAt),
    timeZone,
  });

  it('has no days when there are no rows', () => {
    expect(browseDays({ storedDates: [], handEntered: [] })).toEqual([]);
  });

  it.each([
    // 16:00 UTC on 7 November is 01:00 on the 8th in Tokyo (UTC+9).
    [
      'east of UTC, after midnight there',
      '2026-11-07T16:00:00Z',
      'Asia/Tokyo',
      '2026-11-08',
    ],
    [
      'east of UTC, the minute before midnight there',
      '2026-11-07T14:59:00Z',
      'Asia/Tokyo',
      '2026-11-07',
    ],
    [
      'far east of UTC (UTC+14)',
      '2026-11-07T10:00:00Z',
      'Pacific/Kiritimati',
      '2026-11-08',
    ],
    // 03:00 UTC on 8 November is 19:00 on the 7th in Los Angeles (UTC-8).
    [
      'west of UTC, before midnight there',
      '2026-11-08T03:00:00Z',
      'America/Los_Angeles',
      '2026-11-07',
    ],
    [
      'west of UTC, the minute after midnight there',
      '2026-11-08T08:00:00Z',
      'America/Los_Angeles',
      '2026-11-08',
    ],
    ['UTC itself', '2026-11-08T00:00:00Z', 'UTC', '2026-11-08'],
    // New York goes back an hour on 1 November 2026: midnight is 04:00 UTC before the change and 05:00 UTC after.
    [
      'the clock-change day, still summer time',
      '2026-11-01T04:00:00Z',
      'America/New_York',
      '2026-11-01',
    ],
    [
      'the day before the clock change',
      '2026-11-01T03:59:00Z',
      'America/New_York',
      '2026-10-31',
    ],
    [
      'the end of the 25-hour clock-change day',
      '2026-11-02T04:59:00Z',
      'America/New_York',
      '2026-11-01',
    ],
    [
      'the start of the day after the clock change',
      '2026-11-02T05:00:00Z',
      'America/New_York',
      '2026-11-02',
    ],
    // New York goes forward on 8 March 2026: midnight is 05:00 UTC before the change; the day is 23 hours long.
    [
      'the end of the 23-hour clock-change day',
      '2026-03-09T03:59:00Z',
      'America/New_York',
      '2026-03-08',
    ],
    [
      'the start of the day after the short day',
      '2026-03-09T04:00:00Z',
      'America/New_York',
      '2026-03-09',
    ],
  ])(
    'puts a hand-entered session %s on its own calendar day',
    (_name, startsAt, zone, day) => {
      expect(
        browseDays({ storedDates: [], handEntered: [at(startsAt, zone)] }),
      ).toEqual([day]);
    },
  );

  it('keeps a stored date as it is, whatever the zone says', () => {
    expect(
      browseDays({ storedDates: ['2026-11-09'], handEntered: [] }),
    ).toEqual(['2026-11-09']);
  });

  it('merges both kinds, lists each day once, and sorts the days', () => {
    expect(
      browseDays({
        storedDates: ['2026-11-12', '2026-11-08', '2026-11-12'],
        handEntered: [
          at('2026-11-07T16:00:00Z', 'Asia/Tokyo'),
          at('2026-11-08T15:00:00Z', 'America/New_York'),
          at('2026-11-08T15:00:00Z', 'America/New_York'),
          at('2026-11-10T15:00:00Z', 'America/New_York'),
        ],
      }),
    ).toEqual(['2026-11-08', '2026-11-10', '2026-11-12']);
  });

  it.each([
    ['a name Intl does not know', 'Mars/Olympus_Mons'],
    ['an area with no such place', 'Europe/Atlantis'],
  ])('refuses %s without naming it', (_name, zone) => {
    const refusal = (() => {
      try {
        browseDays({
          storedDates: ['2026-11-08'],
          handEntered: [at('2026-11-07T16:00:00Z', zone)],
        });
      } catch (error) {
        return error;
      }
      return null;
    })();

    expect(refusal).toBeInstanceOf(RangeError);
    expect((refusal as RangeError).message).not.toContain(zone);
  });
});

describe('BrowseDayRowsSchema', () => {
  const valid = {
    storedDates: ['2026-11-07'],
    handEntered: [
      { startsAt: new Date('2026-11-07T16:00:00Z'), timeZone: 'Asia/Tokyo' },
    ],
  };

  it('accepts what the data layer reads', () => {
    expect(BrowseDayRowsSchema.parse(valid)).toEqual(valid);
  });

  it.each([
    [
      'too many stored dates',
      {
        ...valid,
        storedDates: Array.from(
          { length: maxStoredDayRows + 1 },
          () => '2026-11-07',
        ),
      },
    ],
    [
      'too many hand-entered sessions',
      {
        ...valid,
        handEntered: Array.from(
          { length: maxHandEnteredDayRows + 1 },
          () => valid.handEntered[0],
        ),
      },
    ],
    [
      'a stored date that is not a day',
      { ...valid, storedDates: ['2026-02-30'] },
    ],
    ['a stored date that is missing', { ...valid, storedDates: [null] }],
    [
      'a zone that is not well formed',
      {
        ...valid,
        handEntered: [{ ...valid.handEntered[0], timeZone: 'Tokyo' }],
      },
    ],
  ])('refuses %s', (_name, rows) => {
    expect(BrowseDayRowsSchema.safeParse(rows).success).toBe(false);
  });
});

describe('browseHeading', () => {
  const dated = {
    dateLabel: 'Sat, Nov 7',
    nextDay: null,
    anyDayHref: '/new-york/browse',
    message: '',
  };
  it.each([
    [
      'the count on results',
      {
        state: 'results',
        cards: [],
        summary: 'Showing 12 experiences',
        showMore: null,
        startHref: null,
      },
      'Showing 12 experiences',
    ],
    [
      'the day on an empty chosen day',
      { state: 'empty', filtered: true, dated },
      'Nothing on Sat, Nov 7',
    ],
    [
      'filters on an empty filtered page',
      { state: 'empty', filtered: true, dated: null },
      'Nothing matches those filters',
    ],
    [
      'an empty catalog',
      { state: 'empty', filtered: false, dated: null },
      'Nothing to browse yet',
    ],
    [
      'a moved page',
      { state: 'outdated', startHref: '/new-york/browse' },
      'That page of results has moved',
    ],
    [
      'nothing on error, which has its own alert',
      { state: 'error', retry: { action: '/new-york/browse', fields: [] } },
      null,
    ],
  ] as const)('says %s', (_name, view, text) => {
    expect(browseHeading(view as unknown as BrowseView)).toBe(text);
  });
});

describe('browseTitle', () => {
  const names = {
    categories: [
      { slug: 'cooking', name: 'Cooking' },
      { slug: 'wine', name: 'Wine' },
      { slug: 'tours', name: 'Tours' },
    ],
    neighborhoods: [{ slug: 'dumbo', name: 'DUMBO' }],
  };
  const empty = { categories: [], neighborhoods: [] };
  const filters = (over: Partial<BrowseFilters>): BrowseFilters => ({
    ...noFilters,
    ...over,
  });
  it.each([
    ['no filters', {}, 'Browse experiences'],
    ['a day', { date: '2026-10-31' }, 'Browse experiences on Sat, Oct 31'],
    ['a category', { categories: ['cooking'] }, 'Browse Cooking experiences'],
    [
      'two categories',
      { categories: ['cooking', 'wine'] },
      'Browse Cooking and Wine experiences',
    ],
    [
      'three categories',
      { categories: ['cooking', 'tours', 'wine'] },
      'Browse Cooking, Tours, and Wine experiences',
    ],
    [
      'everything',
      { categories: ['cooking'], neighborhoods: ['dumbo'], date: '2026-11-07' },
      'Browse Cooking experiences in DUMBO on Sat, Nov 7',
    ],
    [
      'a slug with no name',
      { categories: ['unknown'], neighborhoods: ['gone'] },
      'Browse experiences',
    ],
    ['no options at all', { categories: ['cooking'] }, 'Browse experiences'],
  ])('words %s', (name, over, title) => {
    const options = name === 'no options at all' ? empty : names;
    expect(browseTitle(filters(over), options)).toBe(title);
  });
});
