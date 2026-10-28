import { describe, expect, it } from 'vitest';
import {
  browseAsOf,
  browseDateHorizonDays,
  browsePageSize,
  browseView,
  browseWindow,
  dateChipLabel,
  durationLabel,
  errorView,
  experienceAddress,
  priceLabel,
  resultsSummary,
  splitPage,
  toBrowsePage,
  withPriceOptions,
  toBrowseCard,
  venueToday,
  type BrowseExperience,
  type BrowsePage,
  type BrowseRead,
} from './browse';
import { noFilters } from './filters';

// Behaviours under test, one per decision, branch or risk:
// - "today" is the New York calendar date, across midnight and both sides of the clock change
// - the cache time is cut to the minute, and the window runs from it to the horizon
// - a page is cut from page size plus one rows: the extra row makes the cursor and is not shown
// - a read becomes a page, and a cursor with no visible row is an outdated page, not an empty one
// - prices are grouped under their experience, lowest first
// - a duration reads as minutes, hours, or half hours
// - a card price is the lowest price, with "From" only when prices differ; no price is a refusal
// - an experience address names the area by status
// - a card carries neighborhood and duration, links a guide entry out, and refuses a guide entry with no link
// - the summary line counts the cards
// - each results state is chosen from the page: outdated cursor, empty (filtered or not), results with or without more, later page, error

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function experience(
  n: number,
  overrides: Partial<BrowseExperience> = {},
): BrowseExperience {
  return {
    id: id(n),
    slug: `thing-${String(n)}`,
    name: `Thing ${String(n)}`,
    status: 'live',
    neighborhoodName: 'DUMBO',
    durationMinutes: 120,
    linkOutUrl: null,
    priceOptions: [{ priceMinor: 8500 }],
    ...overrides,
  };
}

describe('venueToday', () => {
  it.each([
    [
      'just before midnight in summer time',
      '2026-10-26T03:59:59Z',
      '2026-10-25',
    ],
    ['midnight in summer time', '2026-10-26T04:00:00Z', '2026-10-26'],
    [
      'just before midnight in winter time',
      '2026-11-02T04:59:59Z',
      '2026-11-01',
    ],
    ['midnight in winter time', '2026-11-02T05:00:00Z', '2026-11-02'],
    ['the end of a year', '2027-01-01T04:59:59Z', '2026-12-31'],
  ])('is the New York date %s', (_name, now, expected) => {
    expect(venueToday(new Date(now))).toBe(expected);
  });
});

describe('browseAsOf and browseWindow', () => {
  it('cuts the time to the minute', () => {
    expect(browseAsOf(new Date('2026-10-26T14:05:59.999Z'))).toBe(
      '2026-10-26T14:05:00.000Z',
    );
  });

  it('gives one string to every moment in a minute', () => {
    expect(browseAsOf(new Date('2026-10-26T14:05:00.000Z'))).toBe(
      browseAsOf(new Date('2026-10-26T14:05:59.999Z')),
    );
  });

  it('runs from the minute to a day past the horizon', () => {
    const { from, to } = browseWindow('2026-10-26T14:05:00.000Z');
    expect(from.toISOString()).toBe('2026-10-26T14:05:00.000Z');
    expect((to.getTime() - from.getTime()) / 86_400_000).toBe(
      browseDateHorizonDays + 1,
    );
  });

  it('refuses a time it cannot read', () => {
    expect(() => browseWindow('soon')).toThrow(RangeError);
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
});

describe('withPriceOptions', () => {
  it('gives each row its own prices, lowest first, and ignores prices of unlisted rows', () => {
    expect(
      withPriceOptions(
        [{ id: 'a' }, { id: 'b' }, { id: 'c' }],
        [
          { experienceId: 'a', priceMinor: 7000 },
          { experienceId: 'b', priceMinor: 500 },
          { experienceId: 'a', priceMinor: 3500 },
          { experienceId: 'zzz', priceMinor: 1 },
        ],
      ),
    ).toEqual([
      { id: 'a', priceOptions: [{ priceMinor: 3500 }, { priceMinor: 7000 }] },
      { id: 'b', priceOptions: [{ priceMinor: 500 }] },
      { id: 'c', priceOptions: [] },
    ]);
  });

  it('keeps the other fields of a row', () => {
    expect(withPriceOptions([{ id: 'a', name: 'Thing' }], [])).toEqual([
      { id: 'a', name: 'Thing', priceOptions: [] },
    ]);
  });
});

describe('durationLabel', () => {
  it.each([
    [45, '45 min'],
    [59, '59 min'],
    [60, '1 hr'],
    [90, '1.5 hr'],
    [120, '2 hr'],
    [150, '2.5 hr'],
    [135, '2 hr 15 min'],
    [1440, '24 hr'],
  ])('writes %i minutes as %s', (minutes, label) => {
    expect(durationLabel(minutes)).toBe(label);
  });
});

describe('priceLabel', () => {
  it.each([
    ['one price', [8500], '$85'],
    ['the same price twice', [4000, 4000], '$40'],
    ['prices that differ', [6000, 3000], 'From $30'],
    ['a price with cents', [1250], '$12.50'],
    ['a free option beside a paid one', [0, 5000], 'From $0'],
  ])('reads %s', (_name, prices, label) => {
    expect(priceLabel(prices.map((priceMinor) => ({ priceMinor })))).toBe(
      label,
    );
  });

  it('refuses an experience with no price', () => {
    expect(() => priceLabel([])).toThrow(RangeError);
  });
});

describe('experienceAddress', () => {
  it('addresses a live experience by slug and id', () => {
    expect(experienceAddress(experience(7))).toBe(
      `/experiences/thing-7-${id(7)}`,
    );
  });

  it('addresses a guide entry in the guide area', () => {
    expect(experienceAddress(experience(7, { status: 'guide_only' }))).toBe(
      `/guide/thing-7-${id(7)}`,
    );
  });
});

describe('toBrowseCard', () => {
  it('carries the neighborhood, the duration, and the price of a bookable experience', () => {
    expect(toBrowseCard(experience(1))).toEqual({
      id: id(1),
      title: 'Thing 1',
      meta: 'DUMBO · 2 hr',
      href: `/experiences/thing-1-${id(1)}`,
      kind: 'bookable',
      price: '$85',
    });
  });

  it('leaves the duration out when there is none', () => {
    expect(toBrowseCard(experience(1, { durationMinutes: null })).meta).toBe(
      'DUMBO',
    );
  });

  it('links a guide entry out to the host', () => {
    expect(
      toBrowseCard(
        experience(2, {
          status: 'guide_only',
          linkOutUrl: 'https://host.example/class',
          priceOptions: [],
        }),
      ),
    ).toMatchObject({
      kind: 'guide-only',
      hostHref: 'https://host.example/class',
      href: `/guide/thing-2-${id(2)}`,
    });
  });

  it('refuses a guide entry that has nowhere to link', () => {
    expect(() =>
      toBrowseCard(experience(2, { status: 'guide_only', priceOptions: [] })),
    ).toThrow(RangeError);
  });

  it('refuses a bookable experience with no price', () => {
    expect(() => toBrowseCard(experience(3, { priceOptions: [] }))).toThrow(
      RangeError,
    );
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

describe('browseView', () => {
  const cursor = id(99);
  const firstPage = { filters: noFilters, after: null };

  it('says the cursor is outdated and goes back to the first results with the same filters', () => {
    const page: BrowsePage = { ok: false, reason: 'cursor_not_found' };
    expect(
      browseView(
        { filters: { ...noFilters, categories: ['cooking'] }, after: cursor },
        page,
      ),
    ).toEqual({
      state: 'outdated',
      startHref: '/new-york/browse?category=cooking',
    });
  });

  it('is empty and unfiltered when nothing is listed and no filter is on', () => {
    expect(
      browseView(firstPage, { ok: true, items: [], nextCursor: null }),
    ).toEqual({ state: 'empty', filtered: false });
  });

  it('is empty and filtered when a filter is on', () => {
    expect(
      browseView(
        { filters: { ...noFilters, date: '2026-11-07' }, after: null },
        { ok: true, items: [], nextCursor: null },
      ),
    ).toEqual({ state: 'empty', filtered: true });
  });

  it('shows the cards and a Show more that carries the filters and the next cursor', () => {
    const view = browseView(
      { filters: { ...noFilters, categories: ['cooking'] }, after: null },
      { ok: true, items: [experience(1), experience(2)], nextCursor: id(2) },
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

  it('has no Show more on the last page', () => {
    expect(
      browseView(firstPage, {
        ok: true,
        items: [experience(1)],
        nextCursor: null,
      }),
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
      ),
    ).toMatchObject({ startHref: '/new-york/browse?neighborhood=dumbo' });
  });

  it('never shows more than one page of cards from a full read', () => {
    const rows = Array.from({ length: browsePageSize }, (_, i) =>
      experience(i + 1),
    );
    const view = browseView(firstPage, {
      ok: true,
      items: rows,
      nextCursor: rows[rows.length - 1]?.id ?? null,
    });
    expect(view.state === 'results' && view.cards).toHaveLength(browsePageSize);
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
