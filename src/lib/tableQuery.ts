export type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection };

/** Search params as a page reads them: one value per name, absent or empty when unset. */
export type TableQuery = Readonly<Record<string, string | undefined>>;

export const SEARCH_MAX_LENGTH = 100;
export const CURSOR_MAX_LENGTH = 128;

const SORT_PARAM = 'sort';
const DIRECTION_PARAM = 'dir';
const CURSOR_PARAM = 'cursor';

/** The sort the address names, or the fallback when it names a column the table cannot sort by. */
export function parseSort(
  query: TableQuery,
  sortableColumns: readonly string[],
  fallback: SortState,
): SortState {
  const column = sortableColumns.find((known) => known === query[SORT_PARAM]);
  if (column === undefined) return fallback;
  return {
    column,
    direction: query[DIRECTION_PARAM] === 'desc' ? 'desc' : 'asc',
  };
}

/** The cursor the address names. An empty or oversized one is not a cursor, so the read starts at the first page. */
export function parseCursor(raw: string | undefined): string | null {
  if (raw === undefined || raw === '' || raw.length > CURSOR_MAX_LENGTH) {
    return null;
  }
  return raw;
}

export function parseSearchTerm(raw: string | undefined): string {
  return (raw ?? '').trim().slice(0, SEARCH_MAX_LENGTH);
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
    ...query,
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
  return tableHref(path, { ...query, [CURSOR_PARAM]: nextCursor });
}

export function firstPageHref(path: string, query: TableQuery): string {
  return tableHref(path, { ...query, [CURSOR_PARAM]: null });
}

/** A change to what the table lists (a filter, a search) starts from the first page. */
export function changedParamHref(
  path: string,
  query: TableQuery,
  name: string,
  value: string | null,
): string {
  return tableHref(path, { ...query, [name]: value, [CURSOR_PARAM]: null });
}

/** What a GET search form carries besides its own field: the rest of the address, from the first page. */
export function carriedFields(
  query: TableQuery,
  ownName: string,
): [name: string, value: string][] {
  return Object.entries(query).flatMap(([name, value]) =>
    value === undefined ||
    value === '' ||
    name === ownName ||
    name === CURSOR_PARAM
      ? []
      : [[name, value] as [string, string]],
  );
}
