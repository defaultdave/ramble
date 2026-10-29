import { createHash } from 'node:crypto';
import { vi } from 'vitest';

const request = {
  cookie: undefined as string | undefined,
  forwardedFor: '203.0.113.7' as string | null,
};

/**
 * Stands in for `next/headers` in a test file that builds devices:
 * `vi.mock('next/headers', async () => (await import('<path>/deviceFixture')).nextHeadersMock)`.
 */
export const nextHeadersMock = {
  cookies: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'ramble_device' && request.cookie !== undefined
          ? { name, value: request.cookie }
          : undefined,
      set: () => undefined,
    }),
  headers: () =>
    Promise.resolve({
      get: (name: string) =>
        name === 'x-forwarded-for' ? request.forwardedFor : null,
    }),
};

let queue: Promise<unknown> = Promise.resolve();

/**
 * A device built the way a request builds one: through `getDevice` with a cookie. The same label is
 * the same device. Calls take turns because the mocked request is shared.
 */
export function testDevice(label = 'device-test') {
  const built = queue.then(async () => {
    const { getDevice } =
      await vi.importActual<typeof import('@/server/device')>(
        '@/server/device',
      );
    request.cookie = createHash('sha256').update(label).digest('base64url');
    return getDevice();
  });
  queue = built.catch(() => undefined);
  return built;
}
