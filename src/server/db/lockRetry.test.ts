import { describe, expect, it, vi } from 'vitest';
import { lockRetryLimit, type LockedAttempt } from '@/lib/orderLocks';
import { untilLocksCoverOrder } from './lockRetry';

// Behaviours under test, one per decision, branch, or risk (the attempt is a stub; no database):
// - a done attempt is returned as it is, from the first try, and runs once
// - a stale attempt starts over, and the first done one after it is returned
// - the last try the limit allows can be the done one
// - one stale try more than the limit throws, having made exactly the limit's tries, and returns nothing

const stale: LockedAttempt<string> = { kind: 'stale' };
const done = (value: string): LockedAttempt<string> => ({
  kind: 'done',
  value,
});

describe('untilLocksCoverOrder', () => {
  it('returns a done attempt after one try', async () => {
    const attempt = vi.fn(() => Promise.resolve(done('a')));

    expect(await untilLocksCoverOrder(attempt)).toBe('a');
    expect(attempt).toHaveBeenCalledTimes(1);
  });

  it('starts over after a stale attempt', async () => {
    const attempt = vi
      .fn<() => Promise<LockedAttempt<string>>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(done('b'));

    expect(await untilLocksCoverOrder(attempt)).toBe('b');
    expect(attempt).toHaveBeenCalledTimes(2);
  });

  it('takes a done attempt on the last try the limit allows', async () => {
    const attempt = vi.fn<() => Promise<LockedAttempt<string>>>();
    for (let tries = 1; tries < lockRetryLimit; tries += 1) {
      attempt.mockResolvedValueOnce(stale);
    }
    attempt.mockResolvedValueOnce(done('last'));

    expect(await untilLocksCoverOrder(attempt)).toBe('last');
    expect(attempt).toHaveBeenCalledTimes(lockRetryLimit);
  });

  it('throws after the limit of stale tries, and tries no more', async () => {
    const attempt = vi.fn(() => Promise.resolve(stale));

    await expect(untilLocksCoverOrder(attempt)).rejects.toThrow('kept moving');
    expect(attempt).toHaveBeenCalledTimes(lockRetryLimit);
  });

  it('succeeds when two tries are stale and the third is done', async () => {
    const attempt = vi
      .fn<() => Promise<LockedAttempt<string>>>()
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(stale)
      .mockResolvedValueOnce(done('third'));

    expect(await untilLocksCoverOrder(attempt)).toBe('third');
    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it('throws when three tries in a row are stale, and tries a fourth never', async () => {
    const attempt = vi
      .fn<() => Promise<LockedAttempt<string>>>()
      .mockResolvedValue(stale);

    await expect(untilLocksCoverOrder(attempt)).rejects.toThrow('kept moving');
    expect(attempt).toHaveBeenCalledTimes(3);
  });
});
