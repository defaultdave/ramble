import { z } from 'zod';
import {
  BrowseQuerySchema,
  parseSingle,
  type RawSearchParams,
} from './filters';

export type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection };

/** Search params as Next hands them to a page: a name may repeat, and a repeated one is read as absent. */
export type TableQuery = RawSearchParams;

export const SEARCH_MAX_LENGTH = 100;

// The browse cursor's schema (a lower-cased id), so a hand-edited cursor never reaches a uuid column.
const CursorSchema = BrowseQuerySchema.shape.after.unwrap();
const TextSchema = z.string();

const SORT_PARAM = 'sort';
const DIRECTION_PARAM = 'dir';
const CURSOR_PARAM = 'cursor';

/** The params that carry exactly one value; a repeated name is dropped, never first-wins. */
function singleValues(query: TableQuery): Record<string, string> {
  const single: Record<string, string> = {};
  for (const name of Object.keys(query)) {
    const value = parseSingle(query[name], TextSchema);
    if (value !== null && value !== '') single[name] = value;
  }
  return single;
}

/** TODO(U-073): first caller. The sort the address names, or the fallback when it names a column the table cannot sort by. */
export function parseSort(
  query: TableQuery,
  sortableColumns: readonly string[],
  fallback: SortState,
): SortState {
  const named = parseSingle(query[SORT_PARAM], TextSchema);
  const column = sortableColumns.find((known) => known === named);
  if (column === undefined) return fallback;
  return {
    column,
    direction:
      parseSingle(query[DIRECTION_PARAM], TextSchema) === 'desc'
        ? 'desc'
        : 'asc',
  };
}

/** TODO(U-073): first caller. The one cursor the address names; absent, repeated, or not a row id is null, so the read starts at the first page. */
export function parseCursor(
  raw: string | readonly string[] | undefined,
): string | null {
  return parseSingle(raw, CursorSchema);
}

/** TODO(U-073): first caller. The one search term the address names; absent, repeated, or over the limit is empty. */
export function parseSearchTerm(
  raw: string | readonly string[] | undefined,
): string {
  const term = (parseSingle(raw, TextSchema) ?? '').trim();
  return term.length > SEARCH_MAX_LENGTH ? '' : term;
}

/** Choosing the column that is already sorted flips it; any other column starts ascending. */
export function nextSortDirection(
  current: SortState,
  column: string,
): SortDirection {
  return current.column === column && current.direction === 'asc'
    ? 'desc'
    : 'asc';
}

export function ariaSortFor(
  current: SortState,
  column: string,
): 'ascending' | 'descending' | 'none' {
  if (current.column !== column) return 'none';
  return current.direction === 'asc' ? 'ascending' : 'descending';
}

/** An address from a path and its params, leaving out the unset ones. */
export function tableHref(
  path: string,
  params: Readonly<Record<string, string | null | undefined>>,
): string {
  const search = new URLSearchParams();
  for (const [name, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== '') {
      search.set(name, value);
    }
  }
  const text = search.toString();
  return text === '' ? path : `${path}?${text}`;
}

/** Another sort starts from the first page, because a cursor only means something in the order it came from. */
export function sortHref(
  path: string,
  query: TableQuery,
  current: SortState,
  column: string,
): string {
  return tableHref(path, {
    ...singleValues(query),
    [SORT_PARAM]: column,
    [DIRECTION_PARAM]: nextSortDirection(current, column),
    [CURSOR_PARAM]: null,
  });
}

export function nextPageHref(
  path: string,
  query: TableQuery,
  nextCursor: string,
): string {
  return tableHref(path, {
    ...singleValues(query),
    [CURSOR_PARAM]: nextCursor,
  });
}

export function firstPageHref(path: string, query: TableQuery): string {
  return tableHref(path, { ...singleValues(query), [CURSOR_PARAM]: null });
}

/** A change to what the table lists (a filter, a search) starts from the first page. */
export function changedParamHref(
  path: string,
  query: TableQuery,
  name: string,
  value: string | null,
): string {
  return tableHref(path, {
    ...singleValues(query),
    [name]: value,
    [CURSOR_PARAM]: null,
  });
}

/** What a GET search form carries besides its own field: the rest of the address, from the first page. */
export function carriedFields(
  query: TableQuery,
  ownName: string,
): [name: string, value: string][] {
  return Object.entries(singleValues(query)).filter(
    ([name]) => name !== ownName && name !== CURSOR_PARAM,
  );
}
