import {
  guestChips,
  listChips,
  type BrowseFilters,
  type ChipView,
} from './filters';

type Option = { slug: string; name: string };

/**
 * The chips for what is chosen, in the order the bar shows them, each linking to the address
 * without it. A slug the catalog has no option for has no name to show, so it has no chip.
 * Keys are prefixed by their group, because a category and a neighborhood may share a slug.
 */
export function selectedChips(
  filters: BrowseFilters,
  options: { categories: readonly Option[]; neighborhoods: readonly Option[] },
): ChipView[] {
  const groups = [
    ['categories', listChips(filters, 'categories', options.categories)],
    [
      'neighborhoods',
      listChips(filters, 'neighborhoods', options.neighborhoods),
    ],
    ['guests', guestChips(filters)],
  ] as const;
  return groups.flatMap(([group, chips]) =>
    chips
      .filter(({ selected }) => selected)
      .map((chip) => ({ ...chip, key: `${group}:${chip.key}` })),
  );
}
