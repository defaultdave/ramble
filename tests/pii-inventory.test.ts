import { getTableName, is } from 'drizzle-orm';
import { PgTable, getTableConfig } from 'drizzle-orm/pg-core';
import { describe, expect, it } from 'vitest';
import { nonPiiColumns, piiColumns } from '@/lib/privacy';
import * as schema from '@/server/db/schema';

// Behaviours: the inventory and the schema cannot drift apart.
// - every table the inventory names exists, and so does every column it names
// - a table listed with its non-personal columns has every column classified, as personal or not, once
// - a column that looks like an email address or a person's name in any table is in the inventory

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

const classified = [...piiColumns, ...nonPiiColumns];
const inventoryTables = [...new Set(classified.map(({ table }) => table))];

describe('the PII inventory against the schema', () => {
  it.each(classified.map(({ table, column }) => ({ table, column })))(
    'finds $table.$column in the schema',
    ({ table, column }) => {
      expect(columnsOf.get(table), `no table ${table}`).toContain(column);
    },
  );

  it.each([...new Set(nonPiiColumns.map(({ table }) => table))])(
    'classifies every column of %s exactly once',
    (table) => {
      const listed = classified
        .filter((row) => row.table === table)
        .map(({ column }) => column)
        .sort();

      expect(listed).toEqual([...(columnsOf.get(table) ?? [])].sort());
    },
  );

  it('lists each of its tables in the schema', () => {
    expect(inventoryTables.filter((table) => !columnsOf.has(table))).toEqual(
      [],
    );
  });

  it('inventories every column that holds an email address or a name', () => {
    const personal = new Set(
      piiColumns.map(({ table, column }) => `${table}.${column}`),
    );
    const suspects = [...columnsOf].flatMap(([table, columns]) =>
      columns
        .filter((column) =>
          /(^|_)(email|recipient|address|first_name|last_name|full_name|phone)($|_)/.test(
            column,
          ),
        )
        .map((column) => `${table}.${column}`),
    );

    expect(suspects.filter((name) => !personal.has(name))).toEqual([]);
  });
});
