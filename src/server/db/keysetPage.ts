import 'server-only';
import { asc, sql, type SQL } from 'drizzle-orm';
import type { PgColumn, PgTable } from 'drizzle-orm/pg-core';

// The ordering the ops lists page by: name, then id, so the order is total and a page ends where
// the next begins. The cursor is the id of the last row shown.

type NamedTable = PgTable & { name: PgColumn; id: PgColumn };

/** The `ORDER BY` of a list paged by name. */
export function byNameThenId(table: NamedTable) {
  return [asc(table.name), asc(table.id)];
}

/** Every row past the cursor in that order, or no condition for the first page. */
export function pastNameCursor(
  table: NamedTable,
  cursor: string | null,
): SQL | undefined {
  if (cursor === null) return undefined;
  return sql`(${table.name}, ${table.id}) > (SELECT c.name, c.id FROM ${table} c WHERE c.id = ${cursor})`;
}
