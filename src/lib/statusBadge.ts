import type { BadgeTone } from './badge';
import { z } from 'zod';
import { parseSingle } from './filters';
import { pickKnown } from './pickKnown';
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

/** The one option the address names, or null (all) when it names none, or more than one, that the filter offers. */
export function parseStatusFilter(
  raw: string | readonly string[] | undefined,
  options: readonly StatusFilterOption[],
): string | null {
  return pickKnown(
    parseSingle(raw, z.string()),
    options.map(({ value }) => value),
    null,
  );
}

/** The status the address names when it is one of `statuses`, or null (all). `options` is what the filter offers, which can be narrower than the list. */
export function parseStatusParam<Status extends string>(
  raw: string | readonly string[] | undefined,
  statuses: readonly Status[],
  options: readonly StatusFilterOption[],
): Status | null {
  return pickKnown(parseStatusFilter(raw, options), statuses, null);
}

/**
 * A list's status filter from its statuses and their words: the options its filter bar offers and
 * the parser that reads the one the address names (null, every row, for none, a repeated one, or one
 * the list does not have).
 */
export function statusFilter<Status extends string>(
  statuses: readonly Status[],
  labels: Readonly<Record<Status, string>>,
) {
  const options = statuses.map((value) => ({ value, label: labels[value] }));
  return {
    options,
    parse: (raw: string | readonly string[] | undefined): Status | null =>
      parseStatusParam(raw, statuses, options),
  };
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
