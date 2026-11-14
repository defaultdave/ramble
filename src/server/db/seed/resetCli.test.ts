import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ResetCommand } from './resetCli';

// Behaviours under test:
// - without --confirm=RESET (missing, another word, lower case) it prints how to confirm, exits 2, and checks and resets nothing
// - a production deployment, and the production-demo target, are refused with exit 1 before any reset or connection
// - a database the seed's own check refuses (no declared target, a production-looking host) is refused the same way
// - a confirmed run on a declared, non-production target resets with the clock it was given and exits 0
// - a failure prints only a safe message, exits 1, and still closes the pool

const end = vi.fn(() => Promise.resolve());
const resetDemoData = vi.fn();

vi.mock('@/server/db/client', () => ({ db: { $client: { end } } }));
vi.mock('./reset', () => ({ resetDemoData }));

const now = new Date('2026-11-13T15:00:00Z');
const lines: string[] = [];

const command = (overrides: Partial<ResetCommand> = {}): ResetCommand => ({
  argv: ['--confirm=RESET'],
  target: {
    nodeEnv: 'development',
    vercelEnv: undefined,
    seedTarget: 'staging',
    databaseUrl: 'postgres://u:secret@db.example.com/ramble',
    seedHost: 'db.example.com',
    storageProvider: 'fake',
  },
  now,
  write: (line) => lines.push(line),
  ...overrides,
});

async function run(overrides?: Partial<ResetCommand>) {
  const { runResetCommand } = await import('./resetCli');
  return runResetCommand(command(overrides));
}

const withTarget = (over: Partial<ResetCommand['target']>) => ({
  target: { ...command().target, ...over },
});

beforeEach(() => {
  lines.length = 0;
  end.mockClear();
  resetDemoData.mockReset().mockResolvedValue({});
});

describe('runResetCommand without the confirmation', () => {
  it.each([[[]], [['--confirm=reset']], [['--confirm=']], [['--yes']]])(
    'says how to confirm and does nothing for %j',
    async (argv) => {
      expect(await run({ argv })).toBe(2);
      expect(lines.join('\n')).toContain('--confirm=RESET');
      expect(resetDemoData).not.toHaveBeenCalled();
      expect(end).not.toHaveBeenCalled();
    },
  );
});

describe('runResetCommand in production', () => {
  it.each([
    ['a production deployment', withTarget({ vercelEnv: 'production' })],
    [
      'a production deployment declared as staging',
      withTarget({ vercelEnv: 'production', seedTarget: 'staging' }),
    ],
    [
      'the production-demo target, with no VERCEL_ENV in the shell',
      withTarget({ seedTarget: 'production-demo' }),
    ],
    [
      'a database named like production',
      withTarget({
        databaseUrl: 'postgres://u:secret@ramble-prod.example.com/ramble',
        seedHost: 'ramble-prod.example.com',
      }),
    ],
  ])('refuses %s without resetting or connecting', async (_what, overrides) => {
    expect(await run(overrides)).toBe(1);
    expect(resetDemoData).not.toHaveBeenCalled();
    expect(end).not.toHaveBeenCalled();
    expect(lines.join('\n')).not.toContain('secret');
  });

  it('refuses a database nobody said what it is', async () => {
    expect(await run(withTarget({ seedTarget: undefined }))).toBe(1);
    expect(resetDemoData).not.toHaveBeenCalled();
  });
});

describe('runResetCommand', () => {
  it('resets with the clock it was given and exits 0', async () => {
    expect(await run()).toBe(0);
    expect(resetDemoData).toHaveBeenCalledTimes(1);
    expect(resetDemoData.mock.calls[0]?.[0]).toMatchObject({ now });
    expect(lines.at(-1)).toBe('Demo data reset');
    expect(end).toHaveBeenCalledTimes(1);
  });

  it('prints a safe message on a failure, exits 1, and still closes the pool', async () => {
    resetDemoData.mockRejectedValue(
      new Error('postgres://u:secret@db.example.com/ramble refused'),
    );
    expect(await run()).toBe(1);
    expect(lines.join('\n')).not.toContain('secret');
    expect(end).toHaveBeenCalledTimes(1);
  });
});
