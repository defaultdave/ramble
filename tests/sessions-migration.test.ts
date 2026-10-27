import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, it } from 'vitest';
import {
  firstSessionDate,
  ianaZonePattern,
  lastSessionDate,
  maxAllocation,
  maxSessionMinutes,
  maxTimeZoneLength,
} from '@/lib/sessions';

const migrations = path.resolve(
  import.meta.dirname,
  '../src/server/db/migrations',
);

function sessionMigration(): string {
  const file = readdirSync(migrations).find((name) =>
    name.endsWith('_sessions_and_templates.sql'),
  );
  if (!file) throw new Error('The sessions migration is missing');
  return readFileSync(path.join(migrations, file), 'utf8');
}

it('holds the exact time zone pattern and limits the read schemas use', () => {
  const migration = sessionMigration();

  expect(migration.split(`~ '${ianaZonePattern}'`)).toHaveLength(2);
  expect(migration).toContain(
    `char_length("sessions"."time_zone") <= ${String(maxTimeZoneLength)}`,
  );
  expect(migration).toContain(
    `BETWEEN '${firstSessionDate}' AND '${lastSessionDate}'`,
  );
  expect(
    migration.split(`BETWEEN 0 AND ${String(maxAllocation)}`),
  ).toHaveLength(3);
  expect(migration).toContain(`BETWEEN 1 AND ${String(maxSessionMinutes)}`);
});
