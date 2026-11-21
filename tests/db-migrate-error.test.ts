import { expect, it } from 'vitest';
import { formatMigrationError } from '../scripts/db-migrate-error';

it('prints the Postgres fields of the error wrapped inside drizzle’s own', () => {
  const wrapped = new Error('Failed query: CREATE UNIQUE INDEX', {
    cause: Object.assign(new Error('could not create unique index'), {
      code: '23505',
      detail: 'Key (slug)=(a) is duplicated.',
      table: 'hosts',
      constraint: 'hosts_slug_unique',
    }),
  });
  const out = formatMigrationError(wrapped);
  expect(out).toContain('Failed query: CREATE UNIQUE INDEX');
  expect(out).toContain('code: 23505');
  expect(out).toContain('detail: Key (slug)=(a) is duplicated.');
  expect(out).toContain('table: hosts');
  expect(out).toContain('constraint: hosts_slug_unique');
});

it('omits Postgres fields the error does not carry', () => {
  expect(formatMigrationError(new Error('connect ECONNREFUSED'))).toBe(
    'Error: connect ECONNREFUSED',
  );
});

it('prints a thrown non-Error and stops on a cause cycle', () => {
  expect(formatMigrationError('boom')).toBe('boom');
  const a = new Error('a');
  const b = new Error('b', { cause: a });
  a.cause = b;
  expect(formatMigrationError(a).split('\n')).toHaveLength(2);
});
