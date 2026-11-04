import 'server-only';
import { createHmac, randomBytes } from 'node:crypto';
import { signedUrlDeadline, type StorageCapabilities } from '@/lib/storage';
import { secureEqual } from '@/server/hash';
import {
  parseDeleteInput,
  parsePutInput,
  parseSignedUrlInput,
  StorageError,
  type StoragePort,
} from './index';

const fakeOrigin = 'https://fake-storage.ramble.invalid';

/** Runs synchronous work as a promise, so a refusal rejects instead of throwing at the call. */
function settle<T>(run: () => T): Promise<T> {
  return new Promise((resolve) => {
    resolve(run());
  });
}

export type FakeStorageState = {
  objects: Map<string, { body: Uint8Array; contentType: string }>;
  secret: Buffer;
};

/** What the fake stores, apart from the adapter, so every adapter built over it sees the same objects. */
export function createFakeStorageState(): FakeStorageState {
  return { objects: new Map(), secret: randomBytes(32) };
}

export type FakeStorageOptions = {
  /** Time source for link expiry (the Clock port's `now`). */
  now: () => Date;
  state?: FakeStorageState;
  /**
   * Whether it declares a locked store for audit objects. Off unless asked: its objects vanish with
   * the process, so the app's fake must not let an audit export report success. A test of the
   * export's success path turns it on.
   */
  storesAudit?: boolean;
};

export type FakeStorageAdapter = StoragePort & {
  /** What a stored object holds, or null; the fake's stand-in for fetching its address. */
  read(key: string): Uint8Array | null;
  /** True while the link is signed by this store and unexpired; the fake's stand-in for opening it. */
  opens(signedUrl: string): boolean;
};

/**
 * Works with no keys: objects live in memory, so they last as long as the process. Its addresses
 * point at a host that does not resolve, so `next/image` will not display them; the demo's photos
 * come from the real adapter.
 */
export function createFakeStorageAdapter(
  options: FakeStorageOptions,
): FakeStorageAdapter {
  const { now } = options;
  const { objects, secret } = options.state ?? createFakeStorageState();

  const capabilities: StorageCapabilities = {
    storesAudit: options.storesAudit ?? false,
  };

  const sign = (key: string, expires: number) =>
    createHmac('sha256', secret)
      .update(`${key}\n${String(expires)}`)
      .digest('hex');

  return {
    provider: 'fake',
    ...capabilities,

    put: (input) =>
      settle(() => {
        const { key, body, contentType, visibility } = parsePutInput(
          input,
          capabilities,
        );
        if (objects.has(key)) throw new StorageError('already_exists');
        objects.set(key, { body: Uint8Array.from(body), contentType });
        return {
          key,
          visibility,
          size: body.byteLength,
          contentType,
          url: visibility === 'public' ? `${fakeOrigin}/${key}` : null,
        };
      }),

    getSignedUrl: (input) =>
      settle(() => {
        const { key, expiresInSeconds } = parseSignedUrlInput(input);
        if (!objects.has(key)) throw new StorageError('not_found');
        const expires = Math.ceil(
          signedUrlDeadline(now(), expiresInSeconds).getTime() / 1000,
        );
        return `${fakeOrigin}/${key}?expires=${String(expires)}&signature=${sign(key, expires)}`;
      }),

    delete: (input) =>
      settle(() => {
        objects.delete(parseDeleteInput(input).key);
      }),

    read(key) {
      return objects.get(key)?.body ?? null;
    },

    opens(signedUrl) {
      const url = new URL(signedUrl);
      const key = url.pathname.slice(1);
      const expires = Number(url.searchParams.get('expires'));
      const signature = url.searchParams.get('signature') ?? '';
      return (
        objects.has(key) &&
        Number.isInteger(expires) &&
        expires * 1000 > now().getTime() &&
        secureEqual(signature, sign(key, expires))
      );
    },
  };
}
