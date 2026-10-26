import { BlobError, BlobNotFoundError } from '@vercel/blob';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { describeStoragePortContract } from '../../../../tests/contracts/storage-port';
import { StorageError } from './index';
import { createVercelBlobAdapter } from './vercel-blob';

const publicToken = 'test-public-store-token';
const privateToken = 'test-private-store-token';
const start = new Date('2026-10-26T12:00:00.000Z');

type Stored = { access: string; body: Uint8Array };

// A stand-in for the SDK that behaves the way the Blob service documents: one store per token,
// a store is either public or private, a key is written once, and a signed link expires.
const sdk = vi.hoisted(() => ({
  stores: new Map<string, { access: string; objects: Map<string, Stored> }>(),
  calls: [] as { fn: string; token: string; access?: string }[],
  failNext: null as Error | null,
}));

vi.mock('@vercel/blob', async (importOriginal) => {
  const original = await importOriginal<typeof import('@vercel/blob')>();
  const storeOf = (token: string) => {
    const store = sdk.stores.get(token);
    if (!store) throw new original.BlobError('No such store');
    return store;
  };
  const maybeFail = () => {
    if (sdk.failNext) {
      const error = sdk.failNext;
      sdk.failNext = null;
      throw error;
    }
  };
  return {
    ...original,
    put: (
      key: string,
      body: Buffer,
      options: { access: string; token: string; allowOverwrite?: boolean },
    ) => {
      sdk.calls.push({
        fn: 'put',
        token: options.token,
        access: options.access,
      });
      maybeFail();
      const store = storeOf(options.token);
      if (options.access !== store.access) {
        throw new original.BlobError('Wrong access for this store');
      }
      if (store.objects.has(key) && !options.allowOverwrite) {
        throw new original.BlobError(
          'This blob already exists, use allowOverwrite: true',
        );
      }
      store.objects.set(key, { access: options.access, body });
      const host = `https://abc123.${store.access}.blob.vercel-storage.com`;
      return Promise.resolve({ url: `${host}/${key}`, pathname: key });
    },
    head: (key: string, options: { token: string }) => {
      sdk.calls.push({ fn: 'head', token: options.token });
      maybeFail();
      if (!storeOf(options.token).objects.has(key)) {
        throw new original.BlobNotFoundError();
      }
      return Promise.resolve({ pathname: key });
    },
    del: (key: string, options: { token: string }) => {
      sdk.calls.push({ fn: 'del', token: options.token });
      maybeFail();
      if (!storeOf(options.token).objects.delete(key)) {
        throw new original.BlobNotFoundError();
      }
      return Promise.resolve();
    },
    issueSignedToken: (options: {
      token: string;
      pathname: string;
      operations: string[];
      validUntil: number;
    }) => {
      sdk.calls.push({ fn: 'issueSignedToken', token: options.token });
      maybeFail();
      return Promise.resolve({
        delegationToken: 'delegation',
        clientSigningToken: 'signing',
        validUntil: options.validUntil,
        operations: options.operations,
      });
    },
    presignUrl: (
      signed: { validUntil: number },
      options: { pathname: string; access: string; validUntil: number },
    ) => {
      if (options.access !== 'private') {
        throw new original.BlobError('Only private links are signed');
      }
      return Promise.resolve({
        presignedUrl: `https://abc123.private.blob.vercel-storage.com/${options.pathname}?exp=${String(options.validUntil)}&capped=${String(signed.validUntil)}`,
      });
    },
  };
});

let current = start.getTime();

function makeAdapter() {
  return createVercelBlobAdapter({
    publicToken,
    privateToken,
    now: () => new Date(current),
  });
}

beforeEach(() => {
  current = start.getTime();
  sdk.calls.length = 0;
  sdk.failNext = null;
  sdk.stores.clear();
  sdk.stores.set(publicToken, { access: 'public', objects: new Map() });
  sdk.stores.set(privateToken, { access: 'private', objects: new Map() });
});

describeStoragePortContract('vercel-blob', () => ({
  port: makeAdapter(),
  opens: (url) => {
    const parsed = new URL(url);
    const expires = Number(parsed.searchParams.get('exp'));
    return Promise.resolve(expires > current);
  },
  advanceSeconds: (seconds) => {
    current += seconds * 1000;
  },
}));

describe('vercel-blob storage adapter', () => {
  const jpeg = new Uint8Array([0xff, 0xd8, 1, 2]);
  const pdf = new TextEncoder().encode('%PDF-1.7');

  it('writes public keys to the public store and private keys to the private store', async () => {
    const port = makeAdapter();

    await port.put({
      key: 'public/photos/a.jpg',
      body: jpeg,
      contentType: 'image/jpeg',
    });
    await port.put({
      key: 'private/documents/a.pdf',
      body: pdf,
      contentType: 'application/pdf',
    });

    expect(sdk.calls).toEqual([
      { fn: 'put', token: publicToken, access: 'public' },
      { fn: 'put', token: privateToken, access: 'private' },
    ]);
  });

  it('signs a link with the private store and for no longer than asked', async () => {
    const port = makeAdapter();
    await port.put({
      key: 'private/documents/a.pdf',
      body: pdf,
      contentType: 'application/pdf',
    });

    const url = new URL(
      await port.getSignedUrl({
        key: 'private/documents/a.pdf',
        expiresInSeconds: 120,
      }),
    );

    const expected = String(start.getTime() + 120_000);
    expect(url.searchParams.get('exp')).toBe(expected);
    expect(url.searchParams.get('capped')).toBe(expected);
    expect(sdk.calls.filter((c) => c.fn !== 'put')).toEqual([
      { fn: 'head', token: privateToken },
      { fn: 'issueSignedToken', token: privateToken },
    ]);
  });

  it('deletes from the store its key names', async () => {
    const port = makeAdapter();
    await port.put({
      key: 'public/photos/a.jpg',
      body: jpeg,
      contentType: 'image/jpeg',
    });

    await port.delete({ key: 'public/photos/a.jpg' });

    expect(sdk.calls.at(-1)).toEqual({ fn: 'del', token: publicToken });
  });

  it.each([
    [
      'put',
      (port: ReturnType<typeof makeAdapter>) =>
        port.put({
          key: 'public/photos/b.jpg',
          body: jpeg,
          contentType: 'image/jpeg',
        }),
    ],
    [
      'delete',
      (port: ReturnType<typeof makeAdapter>) =>
        port.delete({ key: 'public/photos/b.jpg' }),
    ],
  ])(
    'turns a provider failure on %s into provider_unavailable without its message',
    async (_name, run) => {
      sdk.failNext = new BlobError('store rejected the request for abc123');

      const error = await run(makeAdapter()).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(StorageError);
      expect((error as StorageError).code).toBe('provider_unavailable');
      expect((error as StorageError).message).toBe('provider_unavailable');
    },
  );

  it('treats a delete of a key the store does not hold as done', async () => {
    const port = makeAdapter();
    sdk.failNext = new BlobNotFoundError();

    await expect(
      port.delete({ key: 'public/photos/gone.jpg' }),
    ).resolves.toBeUndefined();
  });
});
