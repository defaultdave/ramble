import 'server-only';
import { asc, desc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// The orderings the ops lists page by: one column, then id, so the order is total and a page ends
// where the next begins. The cursor is the id of the last row shown.

type KeyedTable = PgTable & { id: PgColumn };
type NamedTable = KeyedTable & { name: PgColumn };

export type KeysetDirection = 'asc' | 'desc';

/** The `ORDER BY` of a list paged by `column` in `direction`, ties broken by id in the same direction. */
export function byColumnThenId(
  table: KeyedTable,
  column: PgColumn,
  direction: KeysetDirection,
) {
  const order = direction === 'asc' ? asc : desc;
  return [order(column), order(table.id)];
}

/** Every row past the cursor in that order, or no condition for the first page. */
export function pastKeysetCursor(
  table: KeyedTable,
  column: PgColumn,
  direction: KeysetDirection,
  cursor: string | null,
): SQL | undefined {
  if (cursor === null) return undefined;
  const past = direction === 'asc' ? sql`>` : sql`<`;
  return sql`(${column}, ${table.id}) ${past} (SELECT c.${sql.identifier(column.name)}, c.id FROM ${table} c WHERE c.id = ${cursor})`;
}

/** The `ORDER BY` of a list paged by name. */
export function byNameThenId(table: NamedTable) {
  return byColumnThenId(table, table.name, 'asc');
}

/** Every row past the cursor in name order, or no condition for the first page. */
export function pastNameCursor(
  table: NamedTable,
  cursor: string | null,
): SQL | undefined {
  return pastKeysetCursor(table, table.name, 'asc', cursor);
}
