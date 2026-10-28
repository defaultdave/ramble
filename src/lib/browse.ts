import { z } from 'zod';
import { EntityIdSchema, SlugSchema, guestVisibleStatuses } from './catalog';
import {
  activeFilterCount,
  browsePath,
  hrefForFilters,
  toQueryEntries,
  type BrowseQuery,
} from './filters';
import { formatPrice } from './money';

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

const BrowsePriceOptionSchema = z.object({
  priceMinor: z.int().nonnegative(),
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

export type PriceRow = { experienceId: string; priceMinor: number };

/** Each experience with the prices that belong to it, lowest first. A price for an experience that is not listed is ignored. */
export function withPriceOptions<T extends { id: string }>(
  rows: readonly T[],
  prices: readonly PriceRow[],
): (T & { priceOptions: BrowsePriceOption[] })[] {
  return rows.map((row) => ({
    ...row,
    priceOptions: prices
      .filter((price) => price.experienceId === row.id)
      .map(({ priceMinor }) => ({ priceMinor }))
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

/**
 * The per-person price a card shows: the lowest of the experience's prices. "From" only when the
 * prices differ (an adult and a child price), so a single price reads as that price.
 */
export function priceLabel(options: readonly BrowsePriceOption[]): string {
  if (options.length === 0) {
    throw new RangeError('A bookable experience has at least one price option');
  }
  const prices = options.map((option) => option.priceMinor);
  const lowest = Math.min(...prices);
  const label = formatPrice(lowest);
  return prices.some((price) => price !== lowest) ? `From ${label}` : label;
}

/** The address of an experience page (`/experiences/[slug]-[id]`) or a guide entry (`/guide/[slug]-[id]`). */
export function experienceAddress(
  experience: Pick<BrowseExperience, 'id' | 'slug' | 'status'>,
): string {
  const area = experience.status === 'guide_only' ? 'guide' : 'experiences';
  return `/${area}/${experience.slug}-${experience.id}`;
}

export type BrowseCard = {
  id: string;
  title: string;
  meta: string;
  href: string;
} & (
  { kind: 'bookable'; price: string } | { kind: 'guide-only'; hostHref: string }
);

/** What a card says about an experience. A guide entry with no link out cannot be shown as one. */
export function toBrowseCard(experience: BrowseExperience): BrowseCard {
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
    href: experienceAddress(experience),
  };
  if (experience.status === 'guide_only') {
    if (experience.linkOutUrl === null) {
      throw new RangeError('A guide-only entry links out');
    }
    return { ...base, kind: 'guide-only', hostHref: experience.linkOutUrl };
  }
  return {
    ...base,
    kind: 'bookable',
    price: priceLabel(experience.priceOptions),
  };
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
  | { state: 'empty'; filtered: boolean }
  | { state: 'error'; retry: FormTarget }
  | { state: 'outdated'; startHref: string };

function targetFor(query: BrowseQuery): FormTarget {
  return { action: browsePath, fields: toQueryEntries(query) };
}

export function browseView(query: BrowseQuery, page: BrowsePage): BrowseView {
  const { filters, after } = query;
  if (!page.ok) {
    return { state: 'outdated', startHref: hrefForFilters(filters) };
  }
  if (page.items.length === 0) {
    return { state: 'empty', filtered: activeFilterCount(filters) > 0 };
  }
  return {
    state: 'results',
    cards: page.items.map(toBrowseCard),
    summary: resultsSummary(page.items.length, page.nextCursor !== null),
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
