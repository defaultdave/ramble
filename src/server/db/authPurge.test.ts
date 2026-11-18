import { beforeEach, describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ db: { execute } }));

beforeEach(() => execute.mockReset());

describe.each([
  ['purgeLapsedAuthVerifications'],
  ['purgeLapsedAuthSessions'],
] as const)('%s', (name) => {
  it('returns the number of rows the driver reports', async () => {
    execute.mockResolvedValue({ rowCount: 7 });
    const purge = (await import('./authPurge'))[name];

    await expect(purge()).resolves.toBe(7);
  });

  it('throws when the driver reports no count, instead of saying nothing was purged', async () => {
    execute.mockResolvedValue({ rowCount: null });
    const purge = (await import('./authPurge'))[name];

    await expect(purge()).rejects.toThrow('did not report how many rows');
  });
});
