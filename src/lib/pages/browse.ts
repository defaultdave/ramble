import { z } from 'zod';
import {
  toExperienceCard,
  type CardExperience,
  type ExperienceCard,
} from '../experienceCards';
import {
  activeFilterCount,
  hrefForFilters,
  toQueryEntries,
  withDate,
  type BrowseFilters,
  type BrowseQuery,
} from '../filters';
import { browsePath } from '../routes';
import { IsoDateSchema, TimeZoneSchema, isKnownTimeZone } from '../sessions';
import { calendarDateFormat } from '../time';

/** A hard page size: the data layer reads one more row than this to learn whether there is a next page. */
export const browsePageSize = 12;

/** How far ahead a guest can pick a date. Sessions are generated a year ahead; browse looks a season out. */
export const browseDateHorizonDays = 120;

/** How long a browse read's window runs: the horizon and the whole last day, so the last pickable date is in it. */
export const browseWindowDays = browseDateHorizonDays + 1;

/**
 * The most distinct stored dates a window can hold. The window is one day longer than the horizon,
 * and host zones from UTC-12 to UTC+14 can put one instant on three dates, so a few days sit at each end.
 */
export const maxStoredDayRows = browseDateHorizonDays + 5;

/** The most hand-entered sessions one calendar read takes. A hand-entered session is rare; a cap keeps a flood from growing the read. */
export const maxHandEnteredDayRows = 1000;

/** What the data layer reads for the calendar: raw stored values, with no day decided. */
export const BrowseDayRowsSchema = z.object({
  /** `local_date` of generated sessions, which the generator already decided. */
  storedDates: z.array(IsoDateSchema).max(maxStoredDayRows),
  /** Sessions entered by hand, which have no stored date. */
  handEntered: z
    .array(z.object({ startsAt: z.date(), timeZone: TimeZoneSchema }))
    .max(maxHandEnteredDayRows),
});
export type BrowseDayRows = z.infer<typeof BrowseDayRowsSchema>;

/**
 * The calendar days a guest can pick, each once and in order. A generated session already carries its
 * date; a session entered by hand is on the day its start falls on in its own time zone. A zone that
 * Intl does not know refuses the whole read: guessing a day would show the guest a date that is wrong.
 */
export function browseDays(rows: BrowseDayRows): string[] {
  const days = new Set(rows.storedDates);
  const formats = new Map<string, Intl.DateTimeFormat>();
  for (const { startsAt, timeZone } of rows.handEntered) {
    let format = formats.get(timeZone);
    if (!format) {
      if (!isKnownTimeZone(timeZone)) {
        throw new RangeError('A session has a time zone that is not known');
      }
      format = calendarDateFormat(timeZone);
      formats.set(timeZone, format);
    }
    days.add(format.format(startsAt));
  }
  return [...days].sort();
}

/**
 * One page from a read that fetched `pageSize + 1` rows. The extra row is not shown; its
 * presence is what says there is more, and the last shown row is where the next page starts.
 */
export function splitPage<T extends { id: string }>(
  rows: readonly T[],
  pageSize: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > pageSize && last ? last.id : null,
  };
}

export type BrowsePage =
  | { ok: true; items: CardExperience[]; nextCursor: string | null }
  | { ok: false; reason: 'cursor_not_found' };

/** The page for filters that match nothing, which needs no read. */
export const emptyBrowsePage: BrowsePage = {
  ok: true,
  items: [],
  nextCursor: null,
};

/** The row a page cursor names, as the data layer found it. */
export type BrowseCursorRow = { id: string; name: string };

/**
 * What the data layer read for one page. `cursor` is the row the request's `after` names, or null
 * when the request had no `after` or no guest-visible experience has that id.
 */
export type BrowseRead = {
  cursor: BrowseCursorRow | null;
  items: CardExperience[];
  nextCursor: string | null;
};

/**
 * The page a guest gets from a read. A cursor that names an experience that is gone, hidden, or never
 * existed is an outdated page rather than an empty one: the guest is sent back to the first results.
 */
export function toBrowsePage(
  after: string | null,
  read: BrowseRead,
): BrowsePage {
  if (after !== null && read.cursor === null) {
    return { ok: false, reason: 'cursor_not_found' };
  }
  return { ok: true, items: read.items, nextCursor: read.nextCursor };
}

const chipDate = new Intl.DateTimeFormat('en-US', {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
  timeZone: 'UTC',
});

/** "Sat, Nov 7", for the date chip. The date is a calendar date, so no time zone moves it. */
export function dateChipLabel(date: string): string {
  return chipDate.format(new Date(`${date}T00:00:00Z`));
}

/** The line above the grid: how many experiences the page shows. */
export function resultsSummary(shown: number, hasMore: boolean): string {
  const count = `${String(shown)} ${shown === 1 ? 'experience' : 'experiences'}`;
  return hasMore ? `Showing ${count}` : count;
}

/**
 * The heading over the results for what the page shows now: the count, or the words of the empty
 * or moved state, for the live region that announces a change of filters. The error state has its
 * own alert and no heading.
 */
export function browseHeading(view: BrowseView): string | null {
  switch (view.state) {
    case 'results':
      return view.summary;
    case 'empty':
      if (view.dated) return `Nothing on ${view.dated.dateLabel}`;
      return view.filtered
        ? 'Nothing matches those filters'
        : 'Nothing to browse yet';
    case 'outdated':
      return 'That page of results has moved';
    case 'error':
      return null;
  }
}

type TitleOption = { slug: string; name: string };

const titleList = new Intl.ListFormat('en-US', {
  style: 'long',
  type: 'conjunction',
});

/**
 * The page title for the filters, so the route announcer reads something new after each change:
 * "Browse Cooking experiences in DUMBO on Sat, Nov 7". Names are the chosen categories and
 * neighborhoods, in the order of the filters, looked up in the options; a slug with no option is
 * left out.
 */
export function browseTitle(
  filters: BrowseFilters,
  options: {
    categories: readonly TitleOption[];
    neighborhoods: readonly TitleOption[];
  },
): string {
  const named = (slugs: readonly string[], rows: readonly TitleOption[]) => {
    const lookup = new Map(rows.map(({ slug, name }) => [slug, name]));
    return slugs.flatMap((slug) => lookup.get(slug) ?? []);
  };
  const categories = named(filters.categories, options.categories);
  const neighborhoods = named(filters.neighborhoods, options.neighborhoods);
  return [
    'Browse',
    categories.length > 0 ? titleList.format(categories) : null,
    'experiences',
    neighborhoods.length > 0 ? `in ${titleList.format(neighborhoods)}` : null,
    filters.date ? `on ${dateChipLabel(filters.date)}` : null,
  ]
    .filter((part) => part !== null)
    .join(' ');
}

/** A GET form that goes to `action` with `fields` in its query, so a button can carry a whole address. */
export type FormTarget = {
  action: string;
  fields: readonly (readonly [name: string, value: string])[];
};

/** The way forward from a chosen day with no results. */
type DatedEmpty = {
  /** The chosen day, as the date chip words it. */
  dateLabel: string;
  /** The next day with experiences for the other filters, or null when the window has none. */
  nextDay: { label: string; href: string } | null;
  /** The same filters with no date. */
  anyDayHref: string;
  /** The line under the heading: where the next experiences are, or that none are later. */
  message: string;
};

/**
 * The first calendar day after `date` that has sessions, from the days `browseDays` worked out for the
 * other filters (so only days inside the browse window). Null when the window has no later day.
 */
export function nextBrowseDay(
  days: readonly string[],
  date: string,
): string | null {
  return days.find((day) => day > date) ?? null;
}

/** What the results area shows: the one state, with the text and addresses it needs. */
export type BrowseView =
  | {
      state: 'results';
      cards: ExperienceCard[];
      summary: string;
      /** Goes to the next page, or null on the last. */
      showMore: FormTarget | null;
      /** Set when the page is not the first, and goes back to the first results with the same filters. */
      startHref: string | null;
    }
  | {
      state: 'empty';
      filtered: boolean;
      /** Set when the browse has a date: a way out of a day with nothing on it. */
      dated: DatedEmpty | null;
    }
  | { state: 'error'; retry: FormTarget }
  | { state: 'outdated'; startHref: string };

function targetFor(query: BrowseQuery): FormTarget {
  return { action: browsePath, fields: toQueryEntries(query) };
}

function datedEmpty(
  filters: BrowseQuery['filters'],
  days: readonly string[],
): DatedEmpty | null {
  if (filters.date === null) return null;
  const next = nextBrowseDay(days, filters.date);
  return {
    dateLabel: dateChipLabel(filters.date),
    nextDay:
      next === null
        ? null
        : {
            label: dateChipLabel(next),
            href: hrefForFilters(withDate(filters, next)),
          },
    anyDayHref: hrefForFilters(withDate(filters, null)),
    message:
      next === null
        ? 'There are no experiences on later days.'
        : `The next day with experiences is ${dateChipLabel(next)}.`,
  };
}

/** `days` are the calendar days for the category and neighborhood filters (`browseDays`), which the empty state looks in for the next day. */
export function browseView(
  query: BrowseQuery,
  page: BrowsePage,
  days: readonly string[],
): BrowseView {
  const { filters, after } = query;
  if (!page.ok) {
    return { state: 'outdated', startHref: hrefForFilters(filters) };
  }
  const cards = page.items.flatMap((item) => toExperienceCard(item) ?? []);
  if (cards.length === 0 && page.nextCursor === null) {
    return {
      state: 'empty',
      filtered: activeFilterCount(filters) > 0,
      dated: datedEmpty(filters, days),
    };
  }
  return {
    state: 'results',
    cards,
    summary: resultsSummary(cards.length, page.nextCursor !== null),
    showMore:
      page.nextCursor === null
        ? null
        : targetFor({ filters, after: page.nextCursor }),
    startHref: after === null ? null : hrefForFilters(filters),
  };
}

/** The same address again: a retry reloads exactly what failed. */
export function errorView(query: BrowseQuery): BrowseView {
  return { state: 'error', retry: targetFor(query) };
}
