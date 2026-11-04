/**
 * One page from a read that fetched `pageSize + 1` rows. The extra row is not shown; its
 * presence is what says there is more, and the last shown row is where the next page starts.
 */
export function splitPage<T extends { id: string }>(
  rows: readonly T[],
  pageSize: number,
): { items: T[]; nextCursor: string | null } {
  const items = rows.slice(0, pageSize);
  const last = items.at(-1);
  return {
    items,
    nextCursor: rows.length > pageSize && last ? last.id : null,
  };
}
