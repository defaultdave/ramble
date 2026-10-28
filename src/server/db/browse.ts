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
  BrowseExperienceSchema,
  browsePageSize,
  browseWindow,
  maxHandEnteredDayRows,
  maxStoredDayRows,
  splitPage,
  withPriceOptions,
  type BrowseCursorRow,
  type BrowseDayRows,
  type BrowseExperience,
  type BrowseRead,
  type BrowseWindow,
} from '@/lib/browse';
import {
  BrowseFiltersSchema,
  BrowseQuerySchema,
  type BrowseFilters,
  type BrowseQuery,
} from '@/lib/filters';
import { guestVisible } from './catalog';
import { dbRead } from './client';
import {
  categories,
  experiences,
  neighborhoods,
  priceOptions,
  sessions,
} from './schema';

// A bookable experience with no price cannot be shown on a card, so it stays out of browse until it has one.
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
          .where(eq(priceOptions.experienceId, experiences.id)),
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

function scheduledInWindow(window: BrowseWindow): SQL | undefined {
  return and(
    eq(sessions.status, 'scheduled'),
    gte(sessions.startsAt, window.from),
    lt(sessions.startsAt, window.to),
  );
}

function hasSessionOn(date: string | null, window: BrowseWindow) {
  if (date === null) return undefined;
  return exists(
    dbRead
      .select({ one: sql`1` })
      .from(sessions)
      .where(
        and(
          eq(sessions.experienceId, experiences.id),
          scheduledInWindow(window),
          sql`${sessionLocalDate} = ${date}::date`,
        ),
      ),
  );
}

const PriceRowsSchema = z.array(
  z.object({
    experienceId: z.guid(),
    priceMinor: z.int().nonnegative(),
  }),
);

// The status is checked by the parse below, which refuses a row the guest condition let through.
type ExperienceRow = Omit<BrowseExperience, 'priceOptions' | 'status'> & {
  status: string;
};

async function attachPriceOptions(
  rows: readonly ExperienceRow[],
): Promise<BrowseExperience[]> {
  if (rows.length === 0) return [];
  const prices = PriceRowsSchema.parse(
    await dbRead
      .select({
        experienceId: priceOptions.experienceId,
        priceMinor: priceOptions.priceMinor,
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
    BrowseExperienceSchema.parse(row),
  );
}

/**
 * One page of the experiences a guest can see that match the filters, by name and then id, with the
 * row `after` names. A category or neighborhood list matches any of its values, and the date matches
 * an experience with a scheduled session that starts on that day in the window. `after` is the id
 * of the last experience on the previous page: the next page is every row past it in the same order,
 * so a row that appears or goes between pages moves nothing that was already shown. When no visible
 * experience has the `after` id there is no place to start from, so no page is read.
 */
export async function listBrowseExperiences(
  query: BrowseQuery,
  asOf: string,
): Promise<BrowseRead> {
  const { filters, after } = BrowseQuerySchema.parse(query);
  const window = browseWindow(asOf);

  let cursor: BrowseCursorRow | null = null;
  let pastCursor: SQL | undefined;
  if (after !== null) {
    [cursor = null] = await dbRead
      .select({ id: experiences.id, name: experiences.name })
      .from(experiences)
      .where(and(eq(experiences.id, after), shownInBrowse()));
    if (!cursor) return { cursor, items: [], nextCursor: null };
    pastCursor = sql`(${experiences.name}, ${experiences.id}) > (${cursor.name}::text, ${cursor.id}::uuid)`;
  }

  const rows = await dbRead
    .select({
      id: experiences.id,
      slug: experiences.slug,
      name: experiences.name,
      status: experiences.status,
      neighborhoodName: neighborhoods.name,
      durationMinutes: experiences.durationMinutes,
      linkOutUrl: experiences.linkOutUrl,
    })
    .from(experiences)
    .innerJoin(neighborhoods, eq(neighborhoods.id, experiences.neighborhoodId))
    .where(
      and(
        shownInBrowse(),
        inChosenCategories(filters.categories),
        inChosenNeighborhoods(filters.neighborhoods),
        hasSessionOn(filters.date, window),
        pastCursor,
      ),
    )
    .orderBy(asc(experiences.name), asc(experiences.id))
    .limit(browsePageSize + 1);

  const { items, nextCursor } = splitPage(rows, browsePageSize);
  return { cursor, items: await attachPriceOptions(items), nextCursor };
}

/**
 * The stored values the calendar is worked out from, for scheduled sessions in the window of the
 * experiences the category and neighborhood filters leave. The date filter itself is not applied:
 * the calendar must show every day a guest could switch to. No day is decided here: a generated
 * session brings its stored date and a session entered by hand its start and zone, and `browseDays`
 * turns them into days. Each list has a hard cap.
 */
export async function listBrowseDayRows(
  filters: Pick<BrowseFilters, 'categories' | 'neighborhoods'>,
  asOf: string,
): Promise<BrowseDayRows> {
  const { categories: chosenCategories, neighborhoods: chosenNeighborhoods } =
    BrowseFiltersSchema.pick({
      categories: true,
      neighborhoods: true,
    }).parse(filters);
  const window = browseWindow(asOf);
  const shown = and(
    shownInBrowse(),
    inChosenCategories(chosenCategories),
    inChosenNeighborhoods(chosenNeighborhoods),
    scheduledInWindow(window),
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
