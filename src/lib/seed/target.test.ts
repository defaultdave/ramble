import { describe, expect, it } from 'vitest';
import {
  checkSeedTarget,
  seedTargets,
  type SeedTargetInput,
  type SeedTargetVerdict,
} from './target';

// Behaviours under test, one per rule and branch:
// - the seed runs for a declared local, staging, or load-test database outside production
// - no database URL, a production NODE_ENV or VERCEL_ENV, and an undeclared target each refuse
// - the target must be declared even for a local database (fail closed)
// - a database named like production is refused on its host or its database name, and a word that only
//   contains "prod" is not mistaken for it
// - SEED_TARGET=local refuses a remote host; staging and load-test accept one
// - an unreadable URL is refused rather than assumed local
// - a query parameter the driver reads in place of the address (host, hostaddr, dbname, database, any case)
//   is refused for every target, including one that makes the address read as production or local
// - an address the guard and the driver could read differently is refused: a percent escape in the host or
//   database, an empty host or database, a protocol other than postgres
// - refusals carry a reason and a message that never repeats the URL (it holds credentials)

const local: SeedTargetInput = {
  nodeEnv: 'development',
  vercelEnv: undefined,
  seedTarget: 'local',
  databaseUrl: 'postgres://ramble:secret@localhost:5432/ramble',
};

const refusal = (verdict: SeedTargetVerdict) =>
  verdict.ok ? undefined : verdict.reason;

describe('checkSeedTarget', () => {
  it.each(seedTargets)('accepts a declared %s database', (seedTarget) => {
    const verdict = checkSeedTarget({ ...local, seedTarget });
    expect(verdict).toEqual({
      ok: true,
      target: seedTarget,
      host: 'localhost',
    });
  });

  it('accepts a staging database on a remote host', () => {
    const verdict = checkSeedTarget({
      ...local,
      seedTarget: 'staging',
      databaseUrl:
        'postgres://u:p@ep-quiet-cell-123.us-east-2.aws.neon.tech/neondb',
    });
    expect(verdict.ok).toBe(true);
  });

  it.each([
    ['NODE_ENV production', { nodeEnv: 'production' }, 'production_runtime'],
    [
      'VERCEL_ENV production',
      { vercelEnv: 'production' },
      'production_runtime',
    ],
    ['no target declared', { seedTarget: undefined }, 'target_not_declared'],
    ['no database', { databaseUrl: undefined }, 'no_database'],
    ['an empty database URL', { databaseUrl: '' }, 'no_database'],
    [
      'an unreadable URL',
      { databaseUrl: 'not a url' },
      'unreadable_database_url',
    ],
    [
      'a remote host declared local',
      { databaseUrl: 'postgres://u:p@db.example.com/ramble' },
      'not_local',
    ],
    [
      'a production word in the host',
      {
        seedTarget: 'staging' as const,
        databaseUrl: 'postgres://u:p@ramble-prod.example.com/ramble',
      },
      'looks_like_production',
    ],
    [
      'a production word in the database name',
      {
        seedTarget: 'staging' as const,
        databaseUrl: 'postgres://u:p@db.example.com/ramble_production',
      },
      'looks_like_production',
    ],
    [
      'a production word beside a local host',
      { databaseUrl: 'postgres://u:p@localhost/prod' },
      'looks_like_production',
    ],
  ] as const)('refuses %s', (_name, change, reason) => {
    expect(refusal(checkSeedTarget({ ...local, ...change }))).toBe(reason);
  });

  describe('a URL whose query changes where the driver connects', () => {
    const base = 'postgres://ramble:ramble@safe.invalid:5432/ramble';

    it.each(['host', 'hostaddr', 'dbname', 'database', 'HOST', 'DbName'])(
      'refuses ?%s=... for staging',
      (key) => {
        const verdict = checkSeedTarget({
          ...local,
          seedTarget: 'staging',
          databaseUrl: `${base}?${key}=127.0.0.1`,
        });
        expect(refusal(verdict)).toBe('address_overridden');
      },
    );

    it.each(['host', 'hostaddr', 'dbname', 'database'])(
      'refuses ?%s=... for a local database that would connect elsewhere',
      (key) => {
        const verdict = checkSeedTarget({
          ...local,
          databaseUrl: `postgres://ramble:ramble@localhost:5432/ramble?${key}=elsewhere.invalid`,
        });
        expect(refusal(verdict)).toBe('address_overridden');
      },
    );

    it('refuses a query host that reads as production', () => {
      const verdict = checkSeedTarget({
        ...local,
        seedTarget: 'staging',
        databaseUrl: `${base}?host=ramble-prod.example.com`,
      });
      expect(refusal(verdict)).toBe('address_overridden');
    });

    it('refuses a parameter after other parameters', () => {
      const verdict = checkSeedTarget({
        ...local,
        seedTarget: 'staging',
        databaseUrl: `${base}?sslmode=require&host=ramble-prod.example.com`,
      });
      expect(refusal(verdict)).toBe('address_overridden');
    });

    it('accepts parameters the driver does not use for the address', () => {
      const verdict = checkSeedTarget({
        ...local,
        seedTarget: 'staging',
        databaseUrl: `${base}?sslmode=require&connect_timeout=5`,
      });
      expect(verdict.ok).toBe(true);
    });

    it('does not repeat the URL in the refusal', () => {
      const verdict = checkSeedTarget({
        ...local,
        seedTarget: 'staging',
        databaseUrl: 'postgres://u:hunter2@safe.invalid/x?host=127.0.0.1',
      });
      expect(verdict.ok ? '' : verdict.message).not.toMatch(
        /hunter2|127\.0\.0\.1|safe\.invalid/,
      );
    });
  });

  it.each([
    [
      'a percent escape that hides a production word in the host',
      'postgres://u:p@ramble-%70rod.example.com/ramble',
    ],
    [
      'a percent escape in the database name',
      'postgres://u:p@db.example.com/%70rod',
    ],
    ['no database name', 'postgres://u:p@db.example.com'],
    ['an empty database name', 'postgres://u:p@db.example.com/'],
    ['no host', 'postgres:///ramble'],
    ['a protocol that is not postgres', 'http://u:p@db.example.com/ramble'],
    ['a socket protocol', 'socket://u:p@db.example.com/ramble'],
  ])('refuses %s', (_name, databaseUrl) => {
    const verdict = checkSeedTarget({
      ...local,
      seedTarget: 'staging',
      databaseUrl,
    });
    expect(refusal(verdict)).toBe('unreadable_database_url');
  });

  it('accepts the postgresql protocol', () => {
    const verdict = checkSeedTarget({
      ...local,
      databaseUrl: 'postgresql://u:p@localhost:5432/ramble',
    });
    expect(verdict.ok).toBe(true);
  });

  it('puts NODE_ENV ahead of a declared target', () => {
    expect(refusal(checkSeedTarget({ ...local, nodeEnv: 'production' }))).toBe(
      'production_runtime',
    );
  });

  it.each(['product-demo', 'reproduce', 'proctor'])(
    'does not mistake %s for production',
    (name) => {
      const verdict = checkSeedTarget({
        ...local,
        seedTarget: 'staging',
        databaseUrl: `postgres://u:p@db.example.com/${name}`,
      });
      expect(verdict.ok).toBe(true);
    },
  );

  it('never repeats the connection string in a refusal', () => {
    for (const change of [
      { databaseUrl: 'postgres://u:hunter2@ramble-prod.example.com/x' },
      { seedTarget: undefined },
      { nodeEnv: 'production' },
    ]) {
      const verdict = checkSeedTarget({ ...local, ...change });
      expect(verdict.ok ? '' : verdict.message).not.toMatch(/hunter2|secret/);
    }
  });
});
