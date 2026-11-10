import { describe, expect, it } from 'vitest';
import {
  ariaSortFor,
  carriedFields,
  changedParamHref,
  CURSOR_MAX_LENGTH,
  firstPageHref,
  nextPageHref,
  nextSortDirection,
  parseCursor,
  parseSearchTerm,
  parseSort,
  SEARCH_MAX_LENGTH,
  sortHref,
  tableHref,
  type SortState,
} from './tableQuery';

// Behaviours under test, one per decision, branch or risk:
// - parseSort: a named sortable column wins; anything else falls back; direction is desc only when asked
// - parseCursor: empty, missing, and oversized cursors start from the first page
// - parseSearchTerm: trimmed and capped
// - the next direction flips only the sorted column; ariaSortFor names it
// - hrefs drop unset params, keep the rest, and reset the cursor when the order or filter changes

const fallback: SortState = { column: 'created', direction: 'desc' };
const columns = ['created', 'name'];

describe('parseSort', () => {
  it.each([
    [
      { sort: 'name', dir: 'asc' },
      { column: 'name', direction: 'asc' },
    ],
    [
      { sort: 'name', dir: 'desc' },
      { column: 'name', direction: 'desc' },
    ],
    [{ sort: 'name' }, { column: 'name', direction: 'asc' }],
    [
      { sort: 'name', dir: 'sideways' },
      { column: 'name', direction: 'asc' },
    ],
    [{ sort: 'password' }, fallback],
    [{ dir: 'asc' }, fallback],
    [{}, fallback],
  ] as const)('reads %j as %j', (query, expected) => {
    expect(parseSort(query, columns, fallback)).toEqual(expected);
  });
});

describe('parseCursor', () => {
  it.each([
    [undefined, null],
    ['', null],
    ['abc', 'abc'],
    ['x'.repeat(CURSOR_MAX_LENGTH), 'x'.repeat(CURSOR_MAX_LENGTH)],
    ['x'.repeat(CURSOR_MAX_LENGTH + 1), null],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseCursor(raw)).toBe(expected);
  });
});

describe('parseSearchTerm', () => {
  it.each([
    [undefined, ''],
    ['  gift  ', 'gift'],
    ['x'.repeat(SEARCH_MAX_LENGTH + 20), 'x'.repeat(SEARCH_MAX_LENGTH)],
  ])('reads %j as %j', (raw, expected) => {
    expect(parseSearchTerm(raw)).toBe(expected);
  });
});

describe('sort direction', () => {
  it.each([
    [{ column: 'name', direction: 'asc' }, 'name', 'desc'],
    [{ column: 'name', direction: 'desc' }, 'name', 'asc'],
    [{ column: 'created', direction: 'desc' }, 'name', 'asc'],
  ] as const)('after %j, choosing %s sorts %s', (current, column, expected) => {
    expect(nextSortDirection(current, column)).toBe(expected);
  });

  it.each([
    [{ column: 'name', direction: 'asc' }, 'name', 'ascending'],
    [{ column: 'name', direction: 'desc' }, 'name', 'descending'],
    [{ column: 'name', direction: 'asc' }, 'created', 'none'],
  ] as const)('after %j, %s is %s', (current, column, expected) => {
    expect(ariaSortFor(current, column)).toBe(expected);
  });
});

describe('addresses', () => {
  const query = { status: 'failed', q: 'gift', cursor: 'c1' };

  it('leaves out unset params and adds no ? for none', () => {
    expect(tableHref('/ops', { a: undefined, b: '', c: null })).toBe('/ops');
    expect(tableHref('/ops', { a: '1', b: undefined })).toBe('/ops?a=1');
  });

  it('encodes values', () => {
    expect(tableHref('/ops', { q: 'a&b c' })).toBe('/ops?q=a%26b+c');
  });

  it('sorts from the first page and keeps the filter and search', () => {
    expect(sortHref('/ops', query, fallback, 'name')).toBe(
      '/ops?status=failed&q=gift&sort=name&dir=asc',
    );
  });

  it('flips the sorted column', () => {
    expect(
      sortHref('/ops', {}, { column: 'name', direction: 'asc' }, 'name'),
    ).toBe('/ops?sort=name&dir=desc');
  });

  it('moves to the next page and back to the first', () => {
    expect(nextPageHref('/ops', { status: 'failed' }, 'c9')).toBe(
      '/ops?status=failed&cursor=c9',
    );
    expect(firstPageHref('/ops', query)).toBe('/ops?status=failed&q=gift');
  });

  it('changes a param from the first page, and clears it with null', () => {
    expect(changedParamHref('/ops', query, 'status', 'paid')).toBe(
      '/ops?status=paid&q=gift',
    );
    expect(changedParamHref('/ops', query, 'status', null)).toBe('/ops?q=gift');
  });
});

describe('carriedFields', () => {
  it('keeps the rest of the address and drops the own field, the cursor, and empty values', () => {
    expect(
      carriedFields(
        { q: 'gift', status: 'failed', cursor: 'c1', sort: '', dir: undefined },
        'q',
      ),
    ).toEqual([['status', 'failed']]);
  });
});
