import { describe, expect, it } from 'vitest';
import { splitPage } from './pagination';

// Behaviours under test, one per decision, branch or risk:
// - fewer rows than a page: all shown, no next page
// - rows that fill a page exactly: no next page
// - one more row than a page: the page is cut and the next starts after its last row
// - no rows: an empty page

const id = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const rows = (count: number) =>
  Array.from({ length: count }, (_, i) => ({ id: id(i + 1) }));

describe('splitPage', () => {
  it('has no next page when there are fewer rows than a page', () => {
    expect(splitPage(rows(3), 5)).toEqual({ items: rows(3), nextCursor: null });
  });

  it('has no next page when the rows fill a page exactly', () => {
    expect(splitPage(rows(5), 5).nextCursor).toBeNull();
  });

  it('shows a page and starts the next after its last row when one more is read', () => {
    const page = splitPage(rows(6), 5);
    expect(page.items).toEqual(rows(5));
    expect(page.nextCursor).toBe(id(5));
  });

  it('handles no rows', () => {
    expect(splitPage([], 5)).toEqual({ items: [], nextCursor: null });
  });
});
