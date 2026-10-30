import { z } from 'zod';
import { EntityIdSchema, SlugSchema } from './catalog';
import { browsePath } from './routes';
import { IsoDateSchema } from './sessions';

/** A list parameter with more values than this is refused whole, never cut to fit. */
export const maxFilterValues = 8;
const maxSlugLength = 64;
const maxCursorLength = 36;

/** The one place the browse URL grammar lives: `category`, `neighborhood`, `date`, and `after`. */
export const browseParamNames = {
  categories: 'category',
  neighborhoods: 'neighborhood',
  date: 'date',
  after: 'after',
} as const;

export type FilterListKey = 'categories' | 'neighborhoods';

const FilterSlugSchema = z.string().max(maxSlugLength).pipe(SlugSchema);
// Postgres returns uuids in lower case, and the cursor is compared against stored ids.
const CursorSchema = z
  .string()
  .max(maxCursorLength)
  .pipe(EntityIdSchema)
  .transform((value) => value.toLowerCase());

/** What the data layer accepts. The parse below only ever builds values this schema takes. */
export const BrowseFiltersSchema = z.object({
  categories: z.array(FilterSlugSchema).max(maxFilterValues),
  neighborhoods: z.array(FilterSlugSchema).max(maxFilterValues),
  date: IsoDateSchema.nullable(),
});
export type BrowseFilters = z.infer<typeof BrowseFiltersSchema>;

export const BrowseQuerySchema = z.object({
  filters: BrowseFiltersSchema,
  after: CursorSchema.nullable(),
});
export type BrowseQuery = z.infer<typeof BrowseQuerySchema>;

export type RawSearchParams = Readonly<
  Record<string, string | readonly string[] | undefined>
>;

export const noFilters: BrowseFilters = {
  categories: [],
  neighborhoods: [],
  date: null,
};

function valuesOf(raw: string | readonly string[] | undefined) {
  if (raw === undefined) return [];
  return typeof raw === 'string' ? [raw] : raw;
}

function parseSlugList(raw: string | readonly string[] | undefined) {
  const values = valuesOf(raw);
  if (values.length > maxFilterValues) return [];
  const slugs = new Set<string>();
  for (const value of values) {
    const slug = FilterSlugSchema.safeParse(value);
    if (slug.success) slugs.add(slug.data);
  }
  return [...slugs].sort();
}

/** The one value of a single-value parameter that passes `schema`; absent, repeated, or malformed is null. */
export function parseSingle<T>(
  raw: string | readonly string[] | undefined,
  schema: z.ZodType<T, string>,
): T | null {
  const values = valuesOf(raw);
  const [only] = values;
  if (values.length !== 1 || only === undefined) return null;
  const parsed = schema.safeParse(only);
  return parsed.success ? parsed.data : null;
}

/**
 * Reads the filters out of the address. An unknown parameter is ignored, a malformed value is
 * dropped, a list over its bound is dropped whole, and a repeated single-value parameter is
 * dropped. Nothing is repaired: what survives is exactly what the address said.
 */
export function parseFilters(searchParams: RawSearchParams): BrowseQuery {
  return {
    filters: {
      categories: parseSlugList(searchParams[browseParamNames.categories]),
      neighborhoods: parseSlugList(
        searchParams[browseParamNames.neighborhoods],
      ),
      date: parseSingle(searchParams[browseParamNames.date], IsoDateSchema),
    },
    after: parseSingle(searchParams[browseParamNames.after], CursorSchema),
  };
}

type SlugOptions = {
  categories: readonly { slug: string }[];
  neighborhoods: readonly { slug: string }[];
};

/**
 * The filters the catalog has a category or neighborhood for. A slug nobody has is dropped, so a
 * made-up one never becomes a cache key or reaches the database. `matchesNothing` is set when a list
 * had slugs and none is known: that list matches no experience, as a slug with no row always did, and
 * the browse is empty without a read. A list with some known slugs shows what they match.
 */
export function knownFilters(
  filters: BrowseFilters,
  options: SlugOptions,
): { filters: BrowseFilters; matchesNothing: boolean } {
  const categories = keepKnown(filters.categories, options.categories);
  const neighborhoods = keepKnown(filters.neighborhoods, options.neighborhoods);
  return {
    filters: { ...filters, categories, neighborhoods },
    matchesNothing:
      (filters.categories.length > 0 && categories.length === 0) ||
      (filters.neighborhoods.length > 0 && neighborhoods.length === 0),
  };
}

function keepKnown(
  slugs: readonly string[],
  options: readonly { slug: string }[],
) {
  const known = new Set(options.map(({ slug }) => slug));
  return slugs.filter((slug) => known.has(slug));
}

/** The same pairs `toQuery` writes, for a form that sends them as hidden fields. */
export function toQueryEntries({
  filters,
  after,
}: BrowseQuery): [string, string][] {
  const entries: [string, string][] = [];
  for (const slug of [...filters.categories].sort()) {
    entries.push([browseParamNames.categories, slug]);
  }
  for (const slug of [...filters.neighborhoods].sort()) {
    entries.push([browseParamNames.neighborhoods, slug]);
  }
  if (filters.date) entries.push([browseParamNames.date, filters.date]);
  if (after) entries.push([browseParamNames.after, after]);
  return entries;
}

/** The query string without its leading `?`, in a fixed order so one state has one address. */
export function toQuery(query: BrowseQuery): string {
  return new URLSearchParams(toQueryEntries(query)).toString();
}

export function browseHref(query: BrowseQuery): string {
  const queryString = toQuery(query);
  return queryString ? `${browsePath}?${queryString}` : browsePath;
}

/** A filter change starts again from the first results. */
export function hrefForFilters(filters: BrowseFilters): string {
  return browseHref({ filters, after: null });
}

export function activeFilterCount(filters: BrowseFilters): number {
  return (
    filters.categories.length +
    filters.neighborhoods.length +
    (filters.date ? 1 : 0)
  );
}

export function canAddFilterValue(
  filters: BrowseFilters,
  key: FilterListKey,
): boolean {
  return filters[key].length < maxFilterValues;
}

export type ChipState = { selected: boolean; disabled: boolean };

/** A chosen chip can always be turned off; one that is not chosen is disabled once its list is full. */
export function chipState(
  filters: BrowseFilters,
  key: FilterListKey,
  slug: string,
): ChipState {
  const selected = filters[key].includes(slug);
  return { selected, disabled: !selected && !canAddFilterValue(filters, key) };
}

/** Adds the slug, or removes it when it is already chosen. A full list refuses a new value. */
export function toggleFilterValue(
  filters: BrowseFilters,
  key: FilterListKey,
  slug: string,
): BrowseFilters {
  const current = filters[key];
  if (current.includes(slug)) {
    return { ...filters, [key]: current.filter((value) => value !== slug) };
  }
  if (!canAddFilterValue(filters, key)) return filters;
  return { ...filters, [key]: [...current, slug].sort() };
}

export function withDate(
  filters: BrowseFilters,
  date: string | null,
): BrowseFilters {
  return { ...filters, date };
}

/**
 * Only the unfiltered first page is for search engines. A category or neighborhood alone has its
 * own page, and every other combination, and every later page, would repeat results.
 */
export function isIndexable({ filters, after }: BrowseQuery): boolean {
  return activeFilterCount(filters) === 0 && after === null;
}
