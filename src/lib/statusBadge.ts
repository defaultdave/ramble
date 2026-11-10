import type { BadgeTone } from './badge';
import { changedParamHref, type TableQuery } from './tableQuery';

export type StatusTone = 'success' | 'warning' | 'danger' | 'info' | 'neutral';

/** A status badge is a Badge, so its colors are the ones the Badge already ships. */
export const statusBadgeTone = {
  success: 'green',
  warning: 'yellow',
  danger: 'pink',
  info: 'blue',
  neutral: 'neutral',
} satisfies Record<StatusTone, BadgeTone>;

export type StatusFilterOption = {
  value: string;
  label: string;
  count?: number;
};

export type StatusFilterChip = {
  id: string;
  label: string;
  href: string;
  selected: boolean;
};

const STATUS_FILTER_PARAM = 'status';

/** The option the address names, or null (all) when it names none the filter offers. */
export function parseStatusFilter(
  raw: string | undefined,
  options: readonly StatusFilterOption[],
): string | null {
  return options.find(({ value }) => value === raw)?.value ?? null;
}

function chipLabel({ label, count }: { label: string; count?: number }) {
  return count === undefined ? label : `${label} (${String(count)})`;
}

/** "All" first, then each option; every chip links to the same table filtered by it, from the first page. */
export function statusFilterChips({
  path,
  query,
  options,
  allLabel = 'All',
  param = STATUS_FILTER_PARAM,
}: {
  path: string;
  query: TableQuery;
  options: readonly StatusFilterOption[];
  allLabel?: string | undefined;
  param?: string;
}): StatusFilterChip[] {
  const selected = parseStatusFilter(query[param], options);
  return [
    {
      id: 'all',
      label: allLabel,
      href: changedParamHref(path, query, param, null),
      selected: selected === null,
    },
    ...options.map((option) => ({
      id: option.value,
      label: chipLabel(option),
      href: changedParamHref(path, query, param, option.value),
      selected: selected === option.value,
    })),
  ];
}
