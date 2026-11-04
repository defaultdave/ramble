import { notFound, redirect } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRemoteOrFallback } from './remote';

const log = vi.hoisted(() => ({ error: vi.fn() }));

vi.mock('@/server/monitoring/logger', () => ({ logger: log }));

afterEach(() => {
  vi.restoreAllMocks();
  log.error.mockReset();
});

describe('readRemoteOrFallback', () => {
  it('returns the cached read and never touches Postgres', async () => {
    const fallback = vi.fn(() => Promise.resolve(0));

    await expect(
      readRemoteOrFallback(() => Promise.resolve(7), fallback),
    ).resolves.toBe(7);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('reads Postgres and logs only the kind when the runtime cache fails', async () => {
    const value = await readRemoteOrFallback(
      () => Promise.reject(new TypeError('simulated outage: host db.example')),
      () => Promise.resolve(3),
    );

    expect(value).toBe(3);
    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'Runtime cache read failed, reading Postgres instead',
      { kind: 'TypeError' },
    );
  });

  it('logs the unknown kind for a thrown value that is not an Error, and not its text', async () => {
    await readRemoteOrFallback(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a handler can throw anything
      () => Promise.reject('plain text'),
      () => Promise.resolve(1),
    );

    expect(log.error).toHaveBeenCalledExactlyOnceWith(
      'Runtime cache read failed, reading Postgres instead',
      { kind: 'unknown' },
    );
  });

  it('lets a failing Postgres read surface', async () => {
    await expect(
      readRemoteOrFallback(
        () => Promise.reject(new Error('cache down')),
        () => Promise.reject(new Error('database down')),
      ),
    ).rejects.toThrow('database down');
  });

  it.each([
    [
      'notFound',
      () => {
        notFound();
      },
      'NEXT_HTTP_ERROR_FALLBACK;404',
    ],
    [
      'redirect',
      () => {
        redirect('/somewhere');
      },
      'NEXT_REDIRECT',
    ],
  ])(
    'does not swallow the %s that Next.js uses to end a render',
    async (_name, remote, message) => {
      const fallback = vi.fn(() => Promise.resolve(0));

      await expect(readRemoteOrFallback(remote, fallback)).rejects.toThrow(
        message,
      );
      expect(fallback).not.toHaveBeenCalled();
    },
  );
});
