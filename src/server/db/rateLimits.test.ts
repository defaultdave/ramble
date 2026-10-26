import { describe, expect, it, vi } from 'vitest';

const execute = vi.hoisted(() => vi.fn());
vi.mock('./client', () => ({ db: { execute } }));

describe('purgeExpiredRateLimits', () => {
  it('returns the number of rows the driver reports', async () => {
    execute.mockResolvedValue({ rowCount: 7 });
    const { purgeExpiredRateLimits } = await import('./rateLimits');

    await expect(purgeExpiredRateLimits()).resolves.toBe(7);
  });

  it('throws when the driver reports no count, instead of saying nothing was purged', async () => {
    execute.mockResolvedValue({ rowCount: null });
    const { purgeExpiredRateLimits } = await import('./rateLimits');

    await expect(purgeExpiredRateLimits()).rejects.toThrow(
      'did not report how many rows',
    );
  });
});
