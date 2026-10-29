import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { nonPiiColumns, piiColumns } from '@/lib/privacy';
import * as schema from '@/server/db/schema';

// Behaviours: the inventory and the schema cannot drift apart.
// - every column of every table in the schema is in the inventory as personal or not, once, so a new column
//   (or a new table) fails here until someone decides which
// - nothing in the inventory names a column that is not in the schema

const tables: PgTable[] = [];
for (const value of Object.values(schema)) {
  if (is(value, PgTable)) tables.push(value);
}

const snake = (key: string) =>
  key.replaceAll(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);

const columnsOf = new Map(
  tables.map((table) => [
    getTableName(table),
    getTableConfig(table).columns.map((column) => snake(column.name)),
  ]),
);

const classified = [...piiColumns, ...nonPiiColumns].map(
  ({ table, column }) => `${table}.${column}`,
);
const everyColumn = [...columnsOf].flatMap(([table, columns]) =>
  columns.map((column) => `${table}.${column}`),
);

describe('the PII inventory against the schema', () => {
  it('classifies every column of every table, as personal or not, exactly once', () => {
    const counts = new Map<string, number>();
    for (const name of classified) {
      counts.set(name, (counts.get(name) ?? 0) + 1);
    }

    expect({
      unclassified: everyColumn.filter((name) => !counts.has(name)),
      twice: [...counts].filter(([, n]) => n > 1).map(([name]) => name),
      notInSchema: classified.filter((name) => !everyColumn.includes(name)),
    }).toEqual({ unclassified: [], twice: [], notInSchema: [] });
  });
});
