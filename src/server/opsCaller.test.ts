import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Role, getCaller, type Caller } from '@/server/auth/caller';
import { rethrowOrLog } from '@/server/monitoring/rethrowOrLog';
import { readOpsCaller } from './opsCaller';

vi.mock('@/server/auth/caller', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/server/auth/caller')>()),
  getCaller: vi.fn(),
}));
vi.mock('@/server/monitoring/rethrowOrLog', () => ({
  rethrowOrLog: vi.fn(),
}));

// Behaviours under test:
// - a caller that is read is returned as it is, ops role included
// - a failed read is logged and gives the anonymous caller, with no role
// - an error the framework needs to see (the end of a prerender) is rethrown, not turned into anonymous

const ops: Caller = { userId: 'u1', roles: [Role.Ops], hostIds: [] };

beforeEach(() => {
  vi.mocked(getCaller).mockReset();
  vi.mocked(rethrowOrLog).mockReset();
});

describe('readOpsCaller', () => {
  it('returns the caller that was read', async () => {
    vi.mocked(getCaller).mockResolvedValue(ops);

    expect(await readOpsCaller()).toBe(ops);
    expect(rethrowOrLog).not.toHaveBeenCalled();
  });

  it('logs a failed read and gives the anonymous caller', async () => {
    const failure = new Error('database down');
    vi.mocked(getCaller).mockRejectedValue(failure);

    expect(await readOpsCaller()).toEqual({
      userId: null,
      roles: [],
      hostIds: [],
    });
    expect(rethrowOrLog).toHaveBeenCalledExactlyOnceWith(
      expect.any(String),
      failure,
    );
  });

  it('lets an error the framework needs pass through', async () => {
    const prerenderEnd = new Error('prerender is complete');
    vi.mocked(getCaller).mockRejectedValue(prerenderEnd);
    vi.mocked(rethrowOrLog).mockImplementation(() => {
      throw prerenderEnd;
    });

    await expect(readOpsCaller()).rejects.toBe(prerenderEnd);
  });
});
