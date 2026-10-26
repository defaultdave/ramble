import 'server-only';
import { env } from '@/server/env';
import { createFakeStorageAdapter, createFakeStorageState } from './fake';
import type { StoragePort } from './index';
import { createVercelBlobAdapter } from './vercel-blob';

/** The fake's objects live here, so adapters built on separate calls share them for the life of the process. */
const fakeState = createFakeStorageState();

// TODO(U-074b): first caller
/**
 * The storage adapter the environment selects. `now` is the clock port's, passed in because
 * server code does not read the system clock itself.
 */
export function getStorage(now: () => Date): StoragePort {
  switch (env.STORAGE_PROVIDER) {
    case 'fake':
      return createFakeStorageAdapter({ now, state: fakeState });
    case 'vercel-blob':
      return createVercelBlobAdapter({
        publicToken: required(
          env.BLOB_PUBLIC_READ_WRITE_TOKEN,
          'BLOB_PUBLIC_READ_WRITE_TOKEN',
        ),
        privateToken: required(
          env.BLOB_PRIVATE_READ_WRITE_TOKEN,
          'BLOB_PRIVATE_READ_WRITE_TOKEN',
        ),
        now,
      });
  }
}

function required(value: string | undefined, name: string): string {
  if (value === undefined) throw new Error(`${name} is not set`);
  return value;
}
