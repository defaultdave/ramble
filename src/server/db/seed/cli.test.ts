import { beforeEach, describe, expect, it, vi } from 'vitest';
import { curated } from '@/lib/seed/fixtures';
import { snapshotFromFixtures } from '@/lib/seed/snapshot';
import { SeedStepError } from '@/lib/seed/decide';
import type { SeedCommand } from './cli';
import { seedCaller } from './caller';

// Behaviours under test:
// - a bad argument stops with exit code 2 before anything else happens
// - a refusal (production, no declared target, a remote host declared local) prints why, exits 1, and
//   never runs the seed, reads the database, or opens a connection
// - production-demo seeds the curated set against production and refuses --scale before anything runs
// - a good run seeds with the clock and scale it was given, checks coverage, prints the result, exits 0
// - a coverage gap exits 1 and names the probe; a scale run holds the scale probe to account
// - after the coverage matrix the photo step opens the store, writes the photos, and checks the cover and
//   the three-photo floor; a gap exits 1 and names the experience
// - the fake provider on any target but local skips the photo step without opening the store
// - a refusal never opens the store
// - a failure prints only a safe message, exits 1, and still closes the pool

const end = vi.fn(() => Promise.resolve());
const runSeed = vi.fn();
const readSeedSnapshot = vi.fn();
const seedTestPhotos = vi.fn();
const readPhotoCoverageGaps = vi.fn();
const openStorage = vi.fn();

vi.mock('@/server/db/client', () => ({ db: { $client: { end } } }));
vi.mock('./run', () => ({ runSeed }));
vi.mock('./read', () => ({ readSeedSnapshot }));
vi.mock('./photos', () => ({ seedTestPhotos, readPhotoCoverageGaps }));

const now = new Date('2026-10-28T15:00:00Z');
const lines: string[] = [];

const command = (overrides: Partial<SeedCommand> = {}): SeedCommand => ({
  argv: [],
  target: {
    nodeEnv: 'development',
    vercelEnv: undefined,
    seedTarget: 'local',
    databaseUrl: 'postgres://ramble:ramble@localhost:5432/ramble',
    seedHost: undefined,
  },
  now,
  storage: { provider: 'vercel-blob', open: openStorage },
  write: (line) => lines.push(line),
  ...overrides,
});

async function run(overrides?: Partial<SeedCommand>) {
  const { runSeedCommand } = await import('./cli');
  return runSeedCommand(command(overrides));
}

beforeEach(() => {
  lines.length = 0;
  end.mockClear();
  runSeed.mockReset().mockResolvedValue({});
  openStorage.mockReset().mockReturnValue({ provider: 'vercel-blob' });
  seedTestPhotos.mockReset().mockResolvedValue({ created: 2, alreadyThere: 1 });
  readPhotoCoverageGaps.mockReset().mockResolvedValue([]);
  readSeedSnapshot
    .mockReset()
    .mockResolvedValue(snapshotFromFixtures(curated, undefined, now));
});

describe('runSeedCommand', () => {
  it('stops on a bad argument before doing anything', async () => {
    expect(await run({ argv: ['--drop-everything'] })).toBe(2);
    expect(lines.join('\n')).toContain('Usage: seed');
    expect(runSeed).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  it.each([
    [
      'production NODE_ENV',
      { nodeEnv: 'production' },
      'NODE_ENV is production',
    ],
    [
      'production VERCEL_ENV',
      { vercelEnv: 'production' },
      'VERCEL_ENV is production',
    ],
    ['no declared target', { seedTarget: undefined }, 'SEED_TARGET is not set'],
    ['no database', { databaseUrl: undefined }, 'DATABASE_URL is not set'],
    [
      'a remote host declared local',
      { databaseUrl: 'postgres://u:secret@db.example.com/ramble' },
      'SEED_TARGET is local',
    ],
    [
      'a database named like production',
      {
        seedTarget: 'staging' as const,
        databaseUrl: 'postgres://u:secret@db.example.com/prod',
      },
      'looks like a production database',
    ],
  ])('refuses %s without touching anything', async (_name, target, message) => {
    const base = command().target;
    expect(await run({ target: { ...base, ...target } })).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain(`Refusing to seed: `);
    expect(output).toContain(message);
    expect(output).not.toContain('secret');
    expect(runSeed).not.toHaveBeenCalled();
    expect(readSeedSnapshot).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
  });

  describe('production-demo', () => {
    const demo = () => ({
      ...command().target,
      vercelEnv: 'production',
      seedTarget: 'production-demo' as const,
      databaseUrl:
        'postgres://u:secret@ep-quiet.us-east-2.aws.neon.tech/neondb',
      seedHost: 'ep-quiet.us-east-2.aws.neon.tech',
    });

    it('seeds the curated set against production', async () => {
      expect(await run({ target: demo() })).toBe(0);
      expect(lines.join('\n')).toContain(
        'Seeding the production-demo database',
      );
      expect(runSeed).toHaveBeenCalledWith(
        expect.objectContaining({ scale: undefined }),
      );
    });

    it('refuses --scale before touching anything', async () => {
      expect(await run({ target: demo(), argv: ['--scale=5'] })).toBe(1);
      const output = lines.join('\n');
      expect(output).toContain('Refusing to seed: ');
      expect(output).toContain('--scale');
      expect(output).not.toContain('secret');
      expect(runSeed).not.toHaveBeenCalled();
      expect(readSeedSnapshot).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    });
  });

  it('seeds with the clock given, checks coverage, and exits 0', async () => {
    expect(await run()).toBe(0);
    expect(runSeed).toHaveBeenCalledWith(
      expect.objectContaining({ caller: seedCaller, now, scale: undefined }),
    );
    expect(readSeedSnapshot).toHaveBeenCalledWith(seedCaller, now);
    expect(lines.join('\n')).toContain('no gaps');
    expect(end).toHaveBeenCalledTimes(1);
  });

  describe('photos', () => {
    it('writes them after the matrix and reports the count and the coverage', async () => {
      expect(await run()).toBe(0);
      expect(seedTestPhotos).toHaveBeenCalledWith(seedCaller, {
        provider: 'vercel-blob',
      });
      const output = lines.join('\n');
      expect(output).toContain('Photos: 2 written, 1 already there');
      expect(output).toContain('Photo coverage: 14 experiences');
    });

    it('exits 1 and names the experience when one lacks its photos', async () => {
      readPhotoCoverageGaps.mockResolvedValue([
        'kids-wheel-class has no cover',
      ]);
      expect(await run()).toBe(1);
      expect(lines.join('\n')).toContain('kids-wheel-class has no cover');
      expect(end).toHaveBeenCalledTimes(1);
    });

    it('skips them for the fake provider on a staging target, without opening the store', async () => {
      const base = command().target;
      const code = await run({
        storage: { provider: 'fake', open: openStorage },
        target: {
          ...base,
          seedTarget: 'staging',
          databaseUrl: 'postgres://u:secret@db.example.com/ramble',
          seedHost: 'db.example.com',
        },
      });
      expect(code).toBe(0);
      expect(lines.join('\n')).toContain('Photos skipped');
      expect(openStorage).not.toHaveBeenCalled();
      expect(seedTestPhotos).not.toHaveBeenCalled();
    });

    it('writes them on the local target with the fake provider', async () => {
      expect(
        await run({ storage: { provider: 'fake', open: openStorage } }),
      ).toBe(0);
      expect(seedTestPhotos).toHaveBeenCalledTimes(1);
    });

    it('does not open the store when the target is refused', async () => {
      const base = command().target;
      await run({ target: { ...base, vercelEnv: 'production' } });
      expect(openStorage).not.toHaveBeenCalled();
      expect(seedTestPhotos).not.toHaveBeenCalled();
    });

    it('keeps the matrix gap as the exit code when the photos are fine', async () => {
      const snapshot = snapshotFromFixtures(curated, undefined, now);
      readSeedSnapshot.mockResolvedValue({
        ...snapshot,
        settings: { ...snapshot.settings, giftsEnabled: false },
      });
      expect(await run()).toBe(1);
      expect(seedTestPhotos).toHaveBeenCalledTimes(1);
    });
  });

  it('passes the scale options to the seed', async () => {
    readSeedSnapshot.mockResolvedValue(
      snapshotFromFixtures(curated, undefined, now),
    );
    await run({ argv: ['--scale=30', '--scale-seed=7'] });
    expect(runSeed).toHaveBeenCalledWith(
      expect.objectContaining({ scale: { experiences: 30, seed: 7 } }),
    );
  });

  it('exits 1 and names the probe when the database lacks a state', async () => {
    const snapshot = snapshotFromFixtures(curated, undefined, now);
    readSeedSnapshot.mockResolvedValue({
      ...snapshot,
      settings: { ...snapshot.settings, giftsEnabled: false },
    });
    expect(await run()).toBe(1);
    expect(lines.join('\n')).toContain('gift-guide');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('holds the scale probe to account when a scale run was asked for', async () => {
    expect(await run({ argv: ['--scale=5'] })).toBe(1);
    expect(lines.join('\n')).toContain('many-results');
  });

  it('prints a seed refusal as it is and still closes the pool', async () => {
    runSeed.mockRejectedValue(
      new SeedStepError('Seed step "x" was refused: no'),
    );
    expect(await run()).toBe(1);
    expect(lines).toContain('Seed step "x" was refused: no');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('prints only the kind and code of a driver error', async () => {
    runSeed.mockRejectedValue(
      Object.assign(new Error('insert into hosts params: hunter2'), {
        code: '23505',
      }),
    );
    expect(await run()).toBe(1);
    const output = lines.join('\n');
    expect(output).toContain('Seed failed: Error (23505)');
    expect(output).not.toMatch(/hunter2|insert/);
  });
});
