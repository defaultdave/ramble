import { notFound, redirect } from 'next/navigation';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readRemoteOrFallback } from './remote';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('readRemoteOrFallback', () => {
  it('returns the cached read and never touches Postgres', async () => {
    const fallback = vi.fn(() => Promise.resolve(0));

    await expect(
      readRemoteOrFallback(() => Promise.resolve(7), fallback),
    ).resolves.toBe(7);
    expect(fallback).not.toHaveBeenCalled();
  });

  it('reads Postgres and logs the message when the runtime cache fails', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    const value = await readRemoteOrFallback(
      () => Promise.reject(new Error('simulated remote cache outage: get')),
      () => Promise.resolve(3),
    );

    expect(value).toBe(3);
    expect(log).toHaveBeenCalledWith(
      '[readRemoteOrFallback] Runtime cache read failed, reading Postgres instead: simulated remote cache outage: get',
    );
  });

  it('logs a thrown value that is not an Error', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await readRemoteOrFallback(
      // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- a handler can throw anything
      () => Promise.reject('plain text'),
      () => Promise.resolve(1),
    );

    expect(log).toHaveBeenLastCalledWith(
      '[readRemoteOrFallback] Runtime cache read failed, reading Postgres instead: plain text',
    );
  });

  it('lets a failing Postgres read surface', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);

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
