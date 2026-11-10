import {
  ageChips,
  browseParamNames,
  hrefForFilters,
  noFilters,
  priceBands,
  settingChips,
  type BrowseFilters,
} from './filters';
import { guestsLabel } from './orderSummary';
import { dateChipLabel } from './time';

/** Browse never offers more than this many ways out of an empty page. */
export const maxSuggestions = 3;

/** A filter, by the name its parameter and its place in `BrowseFilters` share. `after` is a position, not a filter. */
export type FilterParam = Exclude<keyof typeof browseParamNames, 'after'>;

// `labelOf` and `noFilters[param]` below are typed by `FilterParam`, so a parameter with no filter, or a filter with no label, fails to compile.
const filterParams = (
  Object.keys(browseParamNames) as (keyof typeof browseParamNames)[]
).filter((name): name is FilterParam => name !== 'after');

type Option = { slug: string; name: string };
export type NamedOptions = {
  categories: readonly Option[];
  neighborhoods: readonly Option[];
};

const listFormat = new Intl.ListFormat('en-US', {
  style: 'long',
  type: 'conjunction',
});

function chosenName(chips: readonly { selected: boolean; label: string }[]) {
  return chips.find(({ selected }) => selected)?.label ?? null;
}

function namesOf(slugs: readonly string[], options: readonly Option[]) {
  const lookup = new Map(options.map(({ slug, name }) => [slug, name]));
  const names = slugs.flatMap((slug) => lookup.get(slug) ?? []);
  return names.length === 0 ? null : listFormat.format(names);
}

/** What the filter is called on a link: "Kayaking", "Under $50", "4 guests". Null when there is nothing to call it by. */
const labelOf: Record<
  FilterParam,
  (filters: BrowseFilters, options: NamedOptions) => string | null
> = {
  categories: (filters, options) =>
    namesOf(filters.categories, options.categories),
  neighborhoods: (filters, options) =>
    namesOf(filters.neighborhoods, options.neighborhoods),
  date: ({ date }) => (date === null ? null : dateChipLabel(date)),
  guests: ({ guests }) => (guests === null ? null : guestsLabel(guests)),
  price: ({ price }) => (price === null ? null : priceBands[price].label),
  age: (filters) => chosenName(ageChips(filters)),
  setting: (filters) => chosenName(settingChips(filters)),
  search: ({ search }) => (search === null ? null : `“${search}”`),
};

function isActive(filters: BrowseFilters, param: FilterParam): boolean {
  const value = filters[param];
  return Array.isArray(value) ? value.length > 0 : value !== noFilters[param];
}

/** One filter that is on, what it is called, and the filters as they would be without it. */
export type FilterRemoval = {
  param: FilterParam;
  label: string;
  filters: BrowseFilters;
};

/**
 * Each filter that is on, in the order of `browseParamNames`. A list filter comes off whole. A
 * filter with no name to show has no removal, and neither has one in `omit`.
 */
export function removals(
  filters: BrowseFilters,
  options: NamedOptions,
  omit: readonly FilterParam[] = [],
): FilterRemoval[] {
  return filterParams.flatMap((param) => {
    if (omit.includes(param) || !isActive(filters, param)) return [];
    const label = labelOf[param](filters, options);
    if (label === null) return [];
    return [
      { param, label, filters: { ...filters, [param]: noFilters[param] } },
    ];
  });
}

export type ZeroResultSuggestion = {
  param: FilterParam;
  label: string;
  /** How many experiences browse would list without this filter. */
  count: number;
  /** Browse without this filter, from its first results. */
  href: string;
};

/**
 * Up to `maxSuggestions` filters to take off an empty page: the ones that bring back the most
 * experiences first, ties in the order of `browseParamNames`. `counts` is what browse lists without
 * each filter; one with no count, or a count of none, is not offered.
 */
export function suggestions(
  filters: BrowseFilters,
  options: NamedOptions,
  counts: Partial<Record<FilterParam, number>>,
  omit: readonly FilterParam[] = [],
): ZeroResultSuggestion[] {
  return removals(filters, options, omit)
    .flatMap(({ param, label, filters: without }) => {
      const count = counts[param] ?? 0;
      return count > 0
        ? [{ param, label, count, href: hrefForFilters(without) }]
        : [];
    })
    .sort((a, b) => b.count - a.count)
    .slice(0, maxSuggestions);
}
