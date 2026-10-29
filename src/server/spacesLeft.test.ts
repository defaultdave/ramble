import { beforeEach, describe, expect, it, vi } from 'vitest';
import { getSpacesLeft } from './spacesLeft';

// Behaviours under test, one per decision, branch or risk:
// - the read uses the spacesLeft profile and tags the session with the tag module's session tag, in lower case
// - an ID that is no guid answers null before any cache key or database read exists
// - a session guests cannot see answers null, and a number is returned as it is, zero and below included
// - a failed read throws only the kind of the failure, never the query or its values
//   (the fallback to Postgres when the runtime cache is down is tested with the wrapper, remote.test.ts)

const cache = vi.hoisted(() => ({ life: vi.fn(), tag: vi.fn() }));
vi.mock('next/cache', () => ({ cacheLife: cache.life, cacheTag: cache.tag }));

const data = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('@/server/db/holds', () => ({ readSessionSpacesLeft: data.read }));

const sessionId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';

beforeEach(() => {
  vi.clearAllMocks();
  data.read.mockResolvedValue(4);
});

describe('getSpacesLeft', () => {
  it('reads the session on the spacesLeft profile under its own tag, in lower case', async () => {
    await expect(getSpacesLeft(sessionId.toUpperCase())).resolves.toBe(4);

    expect(cache.life).toHaveBeenCalledExactlyOnceWith('spacesLeft');
    expect(cache.tag).toHaveBeenCalledExactlyOnceWith(`session:${sessionId}`);
    expect(data.read).toHaveBeenCalledExactlyOnceWith(sessionId);
  });

  it.each(['', 'not-a-guid', `${sessionId}0`, "'; drop table holds;--"])(
    'answers null for %j without a cache key or a read',
    async (id) => {
      await expect(getSpacesLeft(id)).resolves.toBeNull();

      expect(cache.tag).not.toHaveBeenCalled();
      expect(data.read).not.toHaveBeenCalled();
    },
  );

  it.each([null, 0, -3, 10])('returns %s as the read gave it', async (left) => {
    data.read.mockResolvedValue(left);

    await expect(getSpacesLeft(sessionId)).resolves.toBe(left);
  });

  it('throws the kind of a failed read and nothing of the query', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    data.read.mockRejectedValue(
      new Error('Failed query: select ... params: secret-id'),
    );

    const failure: unknown = await getSpacesLeft(sessionId).catch(
      (error: unknown) => error,
    );

    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe('Spaces left read failed: Error');
    expect(JSON.stringify(log.mock.calls)).not.toContain('secret-id');
    log.mockRestore();
  });
});
