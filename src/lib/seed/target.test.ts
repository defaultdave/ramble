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
