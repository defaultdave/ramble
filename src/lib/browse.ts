import { z } from 'zod';
import { EntityIdSchema, SlugSchema, guestVisibleStatuses } from './catalog';
import {
  activeFilterCount,
  hrefForFilters,
  toQueryEntries,
  withDate,
  type BrowseQuery,
} from './filters';
import { withCovers, type PhotoView } from './photoViews';
import { cardPriceLabel } from './pricing';
import { browsePath, experienceCardPath } from './routes';
import { IsoDateSchema, TimeZoneSchema, isKnownTimeZone } from './sessions';

/** A hard page size: the data layer reads one more row than this to learn whether there is a next page. */
export const browsePageSize = 12;

/** How far ahead a guest can pick a date. Sessions are generated a year ahead; browse looks a season out. */
export const browseDateHorizonDays = 120;

/** Every host is in New York today, and "today" on a browse page means a New York calendar date. */
const venueTimeZone = 'America/New_York';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 86_400_000;

const venueDate = new Intl.DateTimeFormat('en-CA', {
  timeZone: venueTimeZone,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/** The calendar date in New York at `now`, as YYYY-MM-DD. */
export function venueToday(now: Date): string {
  return venueDate.format(now);
}

/**
 * `now` cut down to the minute, as an ISO string. A cached read takes it as an argument, so two
 * guests inside the same minute share one cache entry instead of each making their own.
 */
export function browseAsOf(now: Date): string {
  const cut = Math.floor(now.getTime() / MS_PER_MINUTE) * MS_PER_MINUTE;
  return new Date(cut).toISOString();
}

export type BrowseWindow = { from: Date; to: Date };

/** The sessions a browse read looks at: those that start from `asOf` up to the horizon. */
export function browseWindow(asOf: string): BrowseWindow {
  const from = new Date(asOf);
  if (Number.isNaN(from.getTime())) {
    throw new RangeError('asOf must be an ISO date and time');
  }
  return {
    from,
    to: new Date(from.getTime() + (browseDateHorizonDays + 1) * MS_PER_DAY),
  };
}

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

function dayInZone(zone: string): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: zone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
}

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
      format = dayInZone(timeZone);
      formats.set(timeZone, format);
    }
    days.add(format.format(startsAt));
  }
  return [...days].sort();
}

const BrowsePriceOptionSchema = z.object({
  priceMinor: z.int().nonnegative(),
  usesSpace: z.boolean(),
});
export type BrowsePriceOption = z.infer<typeof BrowsePriceOptionSchema>;

/** The part of an experience a browse card shows, with nothing a guest may not see. */
export const BrowseExperienceSchema = z.object({
  id: EntityIdSchema,
  slug: SlugSchema,
  name: z.string().min(1),
  status: z.enum(guestVisibleStatuses),
  neighborhoodName: z.string().min(1),
  durationMinutes: z.int().positive().nullable(),
  linkOutUrl: z.string().nullable(),
  priceOptions: z.array(BrowsePriceOptionSchema),
});
export type BrowseExperience = z.infer<typeof BrowseExperienceSchema>;

export type PriceRow = {
  experienceId: string;
  priceMinor: number;
  usesSpace: boolean;
};

/** Each experience with the prices that belong to it, lowest first. A price for an experience that is not listed is ignored. */
export function withPriceOptions<T extends { id: string }>(
  rows: readonly T[],
  prices: readonly PriceRow[],
): (T & { priceOptions: BrowsePriceOption[] })[] {
  return rows.map((row) => ({
    ...row,
    priceOptions: prices
      .filter((price) => price.experienceId === row.id)
      .map(({ priceMinor, usesSpace }) => ({ priceMinor, usesSpace }))
      .sort((a, b) => a.priceMinor - b.priceMinor),
  }));
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
  | { ok: true; items: BrowseExperience[]; nextCursor: string | null }
  | { ok: false; reason: 'cursor_not_found' };

/** The row a page cursor names, as the data layer found it. */
export type BrowseCursorRow = { id: string; name: string };

/**
 * What the data layer read for one page. `cursor` is the row the request's `after` names, or null
 * when the request had no `after` or no guest-visible experience has that id.
 */
export type BrowseRead = {
  cursor: BrowseCursorRow | null;
  items: BrowseExperience[];
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

/** "2 hr", "2.5 hr", "45 min", "2 hr 15 min". */
export function durationLabel(minutes: number): string {
  if (minutes < 60) return `${String(minutes)} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest === 0) return `${String(hours)} hr`;
  if (rest === 30) return `${String(hours)}.5 hr`;
  return `${String(hours)} hr ${String(rest)} min`;
}

export type BrowseCard = {
  id: string;
  title: string;
  meta: string;
  href: string;
  /** The experience's cover photo; null shows the card's missing-image state. */
  image: PhotoView | null;
} & (
  { kind: 'bookable'; price: string } | { kind: 'guide-only'; hostHref: string }
);

/**
 * What a card says about an experience, or null when it cannot be shown as one: a bookable experience
 * with no price option that takes a space, or a guide entry with no link out. A card is left out, never
 * repaired. The read keeps both out already, but prices are read after the experiences, so a host who
 * removes the last price between the two reads would otherwise take the whole page down.
 */
export function toBrowseCard(experience: BrowseExperience): BrowseCard | null {
  const meta = [
    experience.neighborhoodName,
    experience.durationMinutes === null
      ? null
      : durationLabel(experience.durationMinutes),
  ]
    .filter((part) => part !== null)
    .join(' · ');
  const base = {
    id: experience.id,
    title: experience.name,
    meta,
    href: experienceCardPath(experience),
    image: null,
  };
  if (experience.status === 'guide_only') {
    if (experience.linkOutUrl === null) return null;
    return { ...base, kind: 'guide-only', hostHref: experience.linkOutUrl };
  }
  const price = cardPriceLabel(experience.priceOptions);
  return price === null ? null : { ...base, kind: 'bookable', price };
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
      cards: BrowseCard[];
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
  const cards = page.items.flatMap((item) => toBrowseCard(item) ?? []);
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

/** The experiences on a page of results, for one read of their cover photos. */
export function browseCardIds(page: BrowsePage): string[] {
  return page.ok ? page.items.map((item) => item.id) : [];
}

/** The view with each card's cover photo set; a view with no cards is returned as it is. */
export function withBrowseCovers(
  view: BrowseView,
  covers: ReadonlyMap<string, PhotoView>,
): BrowseView {
  return view.state === 'results'
    ? { ...view, cards: withCovers(view.cards, covers) }
    : view;
}

/** The same address again: a retry reloads exactly what failed. */
export function errorView(query: BrowseQuery): BrowseView {
  return { state: 'error', retry: targetFor(query) };
}
