import { z } from 'zod';
import { EntityIdSchema, SlugSchema } from './catalog';
import { holdLimits, PartySizeSchema } from './holds';
import { guestsLabel } from './orderSummary';
import { browsePath } from './routes';
import { IsoDateSchema } from './sessions';
import { isDateInWindow, type SessionWindow } from './sessionWindow';

/** A list parameter with more values than this is refused whole, never cut to fit. */
export const maxFilterValues = 8;
const maxSlugLength = 64;
const maxCursorLength = 36;

/** The one place the browse URL grammar lives: `category`, `neighborhood`, `date`, `guests`, `price`, `age`, `setting`, and `after`. */
export const browseParamNames = {
  categories: 'category',
  neighborhoods: 'neighborhood',
  date: 'date',
  guests: 'guests',
  price: 'price',
  age: 'age',
  setting: 'setting',
  after: 'after',
} as const;

export type FilterListKey = 'categories' | 'neighborhoods';

// Digits only, so "2.0", "+2", "0x2", and " 2" are dropped instead of read as 2.
const GuestsParamSchema = z
  .string()
  .regex(/^[1-9]\d?$/)
  .transform(Number)
  .pipe(PartySizeSchema);

/** The party a search starts with, in the hero and in the header's link to browse. */
export const defaultGuests = 2;

/** The party sizes a guest can search for, in order. */
export const guestCounts: readonly number[] = Array.from(
  { length: holdLimits.maxSeats - holdLimits.minSeats + 1 },
  (_, index) => holdLimits.minSeats + index,
);

/** The price bands, by the cheapest price option that takes a space. A band is from `minMinor` up to, but not including, `maxMinor`. */
export const priceBands = {
  'under-50': { label: 'Under $50', minMinor: 0, maxMinor: 5000 },
  '50-to-100': { label: '$50 to $100', minMinor: 5000, maxMinor: 10000 },
  '100-plus': { label: '$100 and up', minMinor: 10000, maxMinor: null },
} as const;
export type PriceBand = keyof typeof priceBands;

/** An experience is for kids when its minimum age is no higher than this, or it has none. */
export const kidsMinAgeCeiling = 12;

const ageChoices = {
  kids: 'Kids welcome',
  'twenty-one-plus': '21 and over',
} as const;

const settingChoices = {
  indoor: 'Indoor',
  outdoor: 'Outdoor',
} as const;

// The keys are the values a parameter may take, so a value no one offers is dropped like any malformed one.
function choiceSchema<T extends string>(choices: Record<T, unknown>) {
  return z.enum(Object.keys(choices) as [T, ...T[]]);
}
const PriceBandSchema = choiceSchema(priceBands);
const AgeChoiceSchema = choiceSchema(ageChoices);
const SettingChoiceSchema = choiceSchema(settingChoices);

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
  guests: PartySizeSchema.nullable(),
  price: PriceBandSchema.nullable(),
  age: AgeChoiceSchema.nullable(),
  setting: SettingChoiceSchema.nullable(),
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
  guests: null,
  price: null,
  age: null,
  setting: null,
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
      guests: parseSingle(
        searchParams[browseParamNames.guests],
        GuestsParamSchema,
      ),
      price: parseSingle(searchParams[browseParamNames.price], PriceBandSchema),
      age: parseSingle(searchParams[browseParamNames.age], AgeChoiceSchema),
      setting: parseSingle(
        searchParams[browseParamNames.setting],
        SettingChoiceSchema,
      ),
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
 * the browse is empty without a read. A list with some known slugs shows what they match. A date no
 * session in `window` could be on is dropped the same way, so it never becomes a cache key either:
 * `dateOutsideWindow` is set and the results are empty without a read.
 */
export function knownFilters(
  filters: BrowseFilters,
  options: SlugOptions,
  window: SessionWindow,
): {
  filters: BrowseFilters;
  matchesNothing: boolean;
  dateOutsideWindow: boolean;
} {
  const categories = keepKnown(filters.categories, options.categories);
  const neighborhoods = keepKnown(filters.neighborhoods, options.neighborhoods);
  const dateOutsideWindow =
    filters.date !== null && !isDateInWindow(filters.date, window);
  return {
    filters: {
      ...filters,
      categories,
      neighborhoods,
      date: dateOutsideWindow ? null : filters.date,
    },
    dateOutsideWindow,
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
  if (filters.guests !== null) {
    entries.push([browseParamNames.guests, String(filters.guests)]);
  }
  if (filters.price) entries.push([browseParamNames.price, filters.price]);
  if (filters.age) entries.push([browseParamNames.age, filters.age]);
  if (filters.setting)
    entries.push([browseParamNames.setting, filters.setting]);
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
    (filters.date ? 1 : 0) +
    (filters.guests === null ? 0 : 1) +
    (filters.price === null ? 0 : 1) +
    (filters.age === null ? 0 : 1) +
    (filters.setting === null ? 0 : 1)
  );
}

export function canAddFilterValue(
  filters: BrowseFilters,
  key: FilterListKey,
): boolean {
  return filters[key].length < maxFilterValues;
}

type ChipState = { selected: boolean; disabled: boolean };

/** A chosen chip can always be turned off; one that is not chosen is disabled once its list is full. */
function chipState(
  filters: BrowseFilters,
  key: FilterListKey,
  slug: string,
): ChipState {
  const selected = filters[key].includes(slug);
  return { selected, disabled: !selected && !canAddFilterValue(filters, key) };
}

/** One chip of a group, with the address choosing it leads to. A disabled chip has no address to go to. */
export type ChipView = {
  key: string;
  label: string;
  selected: boolean;
  disabled: boolean;
  href: string;
};

/** The chips of a list filter, one per option, each linking to the address with it turned on or off. */
export function listChips(
  filters: BrowseFilters,
  key: FilterListKey,
  options: readonly { slug: string; name: string }[],
): ChipView[] {
  return options.map(({ slug, name }) => ({
    key: slug,
    label: name,
    ...chipState(filters, key, slug),
    href: hrefForFilters(toggleFilterValue(filters, key, slug)),
  }));
}

/** The chips for each party size; the chosen one links to the address without a party, so choosing it again clears it. */
export function guestChips(filters: BrowseFilters): ChipView[] {
  return guestCounts.map((count) => {
    const selected = filters.guests === count;
    return {
      key: String(count),
      label: guestsLabel(count),
      selected,
      disabled: false,
      href: hrefForFilters(withGuests(filters, selected ? null : count)),
    };
  });
}

type ChoiceKey = 'price' | 'age' | 'setting';

/** One chip per choice of a single-choice filter; the chosen one links to the address without it, so choosing it again clears it. */
function choiceChips<K extends ChoiceKey>(
  filters: BrowseFilters,
  key: K,
  labels: Readonly<Record<NonNullable<BrowseFilters[K]>, string>>,
): ChipView[] {
  return Object.entries(labels).map(([value, label]) => {
    const selected = filters[key] === value;
    return {
      key: value,
      label: String(label),
      selected,
      disabled: false,
      href: hrefForFilters({ ...filters, [key]: selected ? null : value }),
    };
  });
}

const priceLabels = Object.fromEntries(
  Object.entries(priceBands).map(([band, { label }]) => [band, label]),
) as Record<PriceBand, string>;

export function priceChips(filters: BrowseFilters): ChipView[] {
  return choiceChips(filters, 'price', priceLabels);
}

export function ageChips(filters: BrowseFilters): ChipView[] {
  return choiceChips(filters, 'age', ageChoices);
}

export function settingChips(filters: BrowseFilters): ChipView[] {
  return choiceChips(filters, 'setting', settingChoices);
}

/** What a search select offers: the value it submits and the words it shows. */
export type SelectOption = { value: string; label: string };

/** "Anywhere" first, which submits nothing, then each neighborhood by its slug. */
export function neighborhoodOptions(
  neighborhoods: readonly { slug: string; name: string }[],
): SelectOption[] {
  return [
    { value: '', label: 'Anywhere' },
    ...neighborhoods.map(({ slug, name }) => ({ value: slug, label: name })),
  ];
}

/** Each party size a search offers, by its number. */
export const guestOptions: readonly SelectOption[] = guestCounts.map(
  (count) => ({ value: String(count), label: String(count) }),
);

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

export function withGuests(
  filters: BrowseFilters,
  guests: number | null,
): BrowseFilters {
  return { ...filters, guests };
}

/**
 * Only the unfiltered first page is for search engines. A category or neighborhood alone has its
 * own page, and every other combination, and every later page, would repeat results.
 */
export function isIndexable({ filters, after }: BrowseQuery): boolean {
  return activeFilterCount(filters) === 0 && after === null;
}
