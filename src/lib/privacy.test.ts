import { describe, expect, it } from 'vitest';
import {
  nonPiiColumns,
  piiColumns,
  piiVendors,
  retentionSchedule,
  type RetentionPeriod,
} from './privacy';

// Behaviours, one per risk:
// - no column is listed twice, and none is both personal and not
// - every inventory row and vendor says what it holds, where, and how it is deleted
// - vendor names are unique
// - every retention period is pending counsel (Q-16) or a whole number of months in a sane range
// - each table that holds personal data of ours has a retention row

const blank = (value: string) => value.trim() === '';

describe('the PII inventory', () => {
  const keys = [...piiColumns, ...nonPiiColumns].map(
    ({ table, column }) => `${table}.${column}`,
  );

  it('lists no column twice, as personal or as not', () => {
    expect(new Set(keys).size).toBe(keys.length);
  });

  it.each(piiColumns)(
    'says what $table.$column holds and how it is deleted',
    (row) => {
      expect([row.data, row.location, row.deletionPath].some(blank)).toBe(
        false,
      );
    },
  );

  it('gives every column that holds no personal data a reason', () => {
    expect(nonPiiColumns.filter(({ reason }) => blank(reason))).toEqual([]);
  });
});

describe('the vendor list', () => {
  it('names each vendor once', () => {
    const names = piiVendors.map(({ name }) => name);

    expect(new Set(names).size).toBe(names.length);
  });

  it.each(piiVendors)(
    '$name says what it holds, where, and how it is deleted',
    (vendor) => {
      expect(
        [
          vendor.purpose,
          vendor.data,
          vendor.location,
          vendor.deletionPath,
        ].some(blank),
      ).toBe(false);
    },
  );

  it('lists the vendors the design doc and ADRs name', () => {
    const names = piiVendors.map(({ name }) => name);

    expect(names).toEqual(
      expect.arrayContaining([
        'Neon',
        'Cloudflare R2',
        'Vercel',
        'Stripe',
        'Resend',
        'Sentry',
        'Axiom',
        'Better Stack',
      ]),
    );
  });
});

describe('the retention schedule', () => {
  const isValid = (period: RetentionPeriod) =>
    period.status === 'pending_counsel' ||
    (Number.isInteger(period.months) &&
      period.months >= 1 &&
      period.months <= 600);

  it.each(retentionSchedule)('$dataset has a valid period', ({ period }) => {
    expect(isValid(period)).toBe(true);
  });

  it('names each dataset once', () => {
    const datasets = retentionSchedule.map(({ dataset }) => dataset);

    expect(new Set(datasets).size).toBe(datasets.length);
  });

  it('covers every table with a column of ours in the inventory', () => {
    const datasets = new Set(retentionSchedule.map(({ dataset }) => dataset));

    for (const table of ['guests', 'consents', 'privacy_requests']) {
      expect(datasets.has(table), table).toBe(true);
    }
  });
});
