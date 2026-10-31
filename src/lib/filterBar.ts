import {
  chipState,
  guestCounts,
  hrefForFilters,
  toggleFilterValue,
  withGuests,
  type BrowseFilters,
  type FilterListKey,
} from './filters';
import { guestsLabel } from './orderSummary';

/** A chip as the filter bar and its panel draw it: a link to the address with the chip turned on or off. */
export type FilterChip = {
  key: string;
  label: string;
  selected: boolean;
  /** Not chosen, and its list is full: it has no address to go to. */
  disabled: boolean;
  href: string;
};

type Option = { slug: string; name: string };

/** One chip per option of a list filter. */
export function listChips(
  filters: BrowseFilters,
  listKey: FilterListKey,
  options: readonly Option[],
): FilterChip[] {
  return options.map(({ slug, name }) => ({
    key: `${listKey}:${slug}`,
    label: name,
    ...chipState(filters, listKey, slug),
    href: hrefForFilters(toggleFilterValue(filters, listKey, slug)),
  }));
}

/** One chip per party size; the chosen one links to the address without a party. */
export function guestChips(filters: BrowseFilters): FilterChip[] {
  return guestCounts.map((count) => {
    const selected = filters.guests === count;
    return {
      key: `guests:${String(count)}`,
      label: guestsLabel(count),
      selected,
      disabled: false,
      href: hrefForFilters(withGuests(filters, selected ? null : count)),
    };
  });
}

/**
 * The chips for what is chosen, in the order the bar shows them, each linking to the address
 * without it. A slug the catalog has no option for has no name to show, so it has no chip.
 */
export function selectedChips(
  filters: BrowseFilters,
  options: { categories: readonly Option[]; neighborhoods: readonly Option[] },
): FilterChip[] {
  return [
    ...listChips(filters, 'categories', options.categories),
    ...listChips(filters, 'neighborhoods', options.neighborhoods),
    ...guestChips(filters),
  ].filter(({ selected }) => selected);
}
