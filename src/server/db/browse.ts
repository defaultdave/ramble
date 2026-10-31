import 'server-only';
import {
  and,
  asc,
  eq,
  exists,
  gte,
  inArray,
  isNotNull,
  isNull,
  lt,
  or,
  sql,
  type SQL,
} from 'drizzle-orm';
import { z } from 'zod';
import {
  BrowseDayRowsSchema,
  browsePageSize,
  browseWindowDays,
  maxHandEnteredDayRows,
  maxStoredDayRows,
  splitPage,
  type BrowseCursorRow,
  type BrowseDayRows,
  type BrowseRead,
} from '@/lib/pages/browse';
import {
  CardExperienceSchema,
  CardPriceOptionSchema,
  withPriceOptions,
  type CardExperience,
} from '@/lib/experienceCards';
import {
  BrowseFiltersSchema,
  BrowseQuerySchema,
  type BrowseFilters,
  type BrowseQuery,
} from '@/lib/filters';
import { upcomingWindow, type SessionWindow } from '@/lib/sessionWindow';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import { coverImage, coverSelection, guestCoverOf } from './photos';
import {
  categories,
  experiences,
  neighborhoods,
  priceOptions,
  sessions,
} from './schema';

// A bookable experience with no price option that takes a space cannot be shown on a card, so it stays out of browse until it has one.
// Built per call: the database client is lazy, and building it at import would need a database to import this file.
function shownInBrowse(): SQL | undefined {
  return and(
    guestVisible,
    or(
      eq(experiences.status, 'guide_only'),
      exists(
        dbRead
          .select({ one: sql`1` })
          .from(priceOptions)
          .where(
            and(
              eq(priceOptions.experienceId, experiences.id),
              eq(priceOptions.usesSpace, true),
            ),
          ),
      ),
    ),
  );
}

// The date filter's match, in the WHERE clause only. A session entered by hand has no stored date, so its
// day is the one its start falls on in its own zone, which is what `browseDays` decides for the calendar;
// the database test keeps the two together.
const sessionLocalDate = sql`coalesce(${sessions.localDate}, (${sessions.startsAt} at time zone ${sessions.timeZone})::date)`;

function inChosenCategories(slugs: readonly string[]): SQL | undefined {
  if (slugs.length === 0) return undefined;
  return inArray(
    experiences.categoryId,
    dbRead
      .select({ id: categories.id })
      .from(categories)
      .where(inArray(categories.slug, [...slugs])),
  );
}

function inChosenNeighborhoods(slugs: readonly string[]): SQL | undefined {
  if (slugs.length === 0) return undefined;
  return inArray(
    experiences.neighborhoodId,
    dbRead
      .select({ id: neighborhoods.id })
      .from(neighborhoods)
      .where(inArray(neighborhoods.slug, [...slugs])),
  );
}

function scheduledInWindow(window: SessionWindow): SQL | undefined {
  return and(
    eq(sessions.status, 'scheduled'),
    gte(sessions.startsAt, window.from),
    lt(sessions.startsAt, window.to),
  );
}

// With `scheduledInWindow`, this mirrors `isOpenSession` in `src/lib/sessionWindow.ts` (spaces left above
// zero, and at least the party when one is given), for the session queries only: a day is offered, and an
// experience matches a day or a party, through a session that is open. The database test keeps the two together.
// Browse counts sold seats only, not open holds, so a session whose last spaces are held still matches.
function hasSpaceFor(guests: number | null): SQL {
  return guests === null
    ? sql`${sessions.seatsSold} < ${sessions.allocation}`
    : sql`${sessions.allocation} - ${sessions.seatsSold} >= ${guests}`;
}

// With neither a day nor a party there is nothing to ask of a session, and an experience with none still lists.
function hasOpenSession(
  { date, guests }: Pick<BrowseFilters, 'date' | 'guests'>,
  window: SessionWindow,
) {
  if (date === null && guests === null) return undefined;
  return exists(
    dbRead
      .select({ one: sql`1` })
      .from(sessions)
      .where(
        and(
          eq(sessions.experienceId, experiences.id),
          scheduledInWindow(window),
          hasSpaceFor(guests),
          date === null ? undefined : sql`${sessionLocalDate} = ${date}::date`,
        ),
      ),
  );
}

const PriceRowsSchema = z.array(
  CardPriceOptionSchema.extend({ experienceId: z.guid() }),
);

// The status is checked by the parse below, which refuses a row the guest condition let through.
type ExperienceRow = Omit<CardExperience, 'priceOptions' | 'status'> & {
  status: string;
};

async function attachPriceOptions(
  rows: readonly ExperienceRow[],
): Promise<CardExperience[]> {
  if (rows.length === 0) return [];
  const prices = PriceRowsSchema.parse(
    await dbRead
      .select({
        experienceId: priceOptions.experienceId,
        priceMinor: priceOptions.priceMinor,
        usesSpace: priceOptions.usesSpace,
      })
      .from(priceOptions)
      .where(
        inArray(
          priceOptions.experienceId,
          rows.map((row) => row.id),
        ),
      )
      .orderBy(asc(priceOptions.priceMinor)),
  );
  return withPriceOptions(rows, prices).map((row) =>
    CardExperienceSchema.parse(row),
  );
}

/** The experience an `after` id names, if a guest can see it. Its columns are in the page order, which `pastCursor` compares them by. */
function visibleCursor(after: string) {
  return dbRead
    .select({ name: experiences.name, id: experiences.id })
    .from(experiences)
    .where(and(eq(experiences.id, after), shownInBrowse()));
}

/** Every row past the cursor in the page order. */
function pastCursor(cursor: BrowseCursorRow | null): SQL | undefined {
  if (cursor === null) return undefined;
  return sql`(${experiences.name}, ${experiences.id}) > (${cursor.name}, ${cursor.id})`;
}

/**
 * One page of the experiences a guest can see that match the filters, by name and then id, with the
 * row `after` names. A category or neighborhood list matches any of its values, and the date matches
 * an experience with a scheduled session that starts on that day in the window. Guests match an
 * experience with a scheduled session in the window that has spaces for the whole party, on that day
 * when a date is chosen too. `after` is the id
 * of the last experience on the previous page: the next page is every row past it in the same order,
 * so a row that appears or goes between pages moves nothing that was already shown. When no visible
 * experience has the `after` id, the page is empty and `cursor` is null, and only the cursor is read;
 * `toBrowsePage` decides what that means, this function only reports what it found.
 */
export async function listBrowseExperiences(
  query: BrowseQuery,
  asOf: string,
): Promise<BrowseRead> {
  const { filters, after } = BrowseQuerySchema.parse(query);
  const window = upcomingWindow(asOf, browseWindowDays);

  const [cursor = null] = after === null ? [] : await visibleCursor(after);
  // A cursor nobody can see leaves nothing past it, so the page is not read.
  if (after !== null && cursor === null) {
    return { cursor: null, items: [], nextCursor: null };
  }

  const cover = guestCoverOf(experiences.id);
  const pageRows = dbRead
    .select({
      id: experiences.id,
      slug: experiences.slug,
      name: experiences.name,
      status: experiences.status,
      neighborhoodName: neighborhoods.name,
      durationMinutes: experiences.durationMinutes,
      linkOutUrl: experiences.linkOutUrl,
      cover: coverSelection(cover),
    })
    .from(experiences)
    .innerJoin(neighborhoods, eq(neighborhoods.id, experiences.neighborhoodId))
    .leftJoinLateral(cover, sql`true`)
    .where(
      and(
        shownInBrowse(),
        inChosenCategories(filters.categories),
        inChosenNeighborhoods(filters.neighborhoods),
        hasOpenSession(filters, window),
        pastCursor(cursor),
      ),
    )
    .orderBy(asc(experiences.name), asc(experiences.id))
    .limit(browsePageSize + 1);

  const { items, nextCursor } = splitPage(await pageRows, browsePageSize);
  const withImages = items.map(({ cover: joined, ...row }) => ({
    ...row,
    image: coverImage(joined),
  }));
  return { cursor, items: await attachPriceOptions(withImages), nextCursor };
}

/**
 * The stored values the calendar is worked out from, for scheduled sessions in the window of the
 * experiences the category and neighborhood filters leave, with spaces for the party when guests are
 * chosen. The date filter itself is not applied:
 * the calendar must show every day a guest could switch to. No day is decided here: a generated
 * session brings its stored date and a session entered by hand its start and zone, and `browseDays`
 * turns them into days. Each list has a hard cap.
 */
export async function listBrowseDayRows(
  filters: Pick<BrowseFilters, 'categories' | 'neighborhoods' | 'guests'>,
  asOf: string,
): Promise<BrowseDayRows> {
  const {
    categories: chosenCategories,
    neighborhoods: chosenNeighborhoods,
    guests,
  } = BrowseFiltersSchema.pick({
    categories: true,
    neighborhoods: true,
    guests: true,
  }).parse(filters);
  const window = upcomingWindow(asOf, browseWindowDays);
  const shown = and(
    shownInBrowse(),
    inChosenCategories(chosenCategories),
    inChosenNeighborhoods(chosenNeighborhoods),
    scheduledInWindow(window),
    hasSpaceFor(guests),
  );
  const [storedDates, handEntered] = await Promise.all([
    dbRead
      .selectDistinct({ localDate: sessions.localDate })
      .from(sessions)
      .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
      .where(and(shown, isNotNull(sessions.localDate)))
      .orderBy(asc(sessions.localDate))
      .limit(maxStoredDayRows),
    dbRead
      .selectDistinct({
        startsAt: sessions.startsAt,
        timeZone: sessions.timeZone,
      })
      .from(sessions)
      .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
      .where(and(shown, isNull(sessions.localDate)))
      .orderBy(asc(sessions.startsAt), asc(sessions.timeZone))
      .limit(maxHandEnteredDayRows),
  ]);
  return BrowseDayRowsSchema.parse({
    storedDates: storedDates.map(({ localDate }) => localDate),
    handEntered,
  });
}
