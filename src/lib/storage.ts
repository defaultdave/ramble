import { z } from 'zod';

export const storageProviderNames = ['fake', 'vercel-blob'] as const;
export type StorageProviderName = (typeof storageProviderNames)[number];

export type StorageVisibility = 'public' | 'private';

/**
 * The first path segment of a key says who may read the object. A public photo cannot be written
 * under `private/` or the other way round, so which store an object lands in is never a separate
 * argument that a caller could get wrong.
 */
const keyPattern =
  /^(public|private)\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

const maxKeyLength = 200;

export const StorageKeySchema = z.string().max(maxKeyLength).regex(keyPattern);

export function visibilityOfKey(key: string): StorageVisibility | null {
  if (!StorageKeySchema.safeParse(key).success) return null;
  return key.startsWith('public/') ? 'public' : 'private';
}

/** Public objects are photos; private ones are host documents such as a signed waiver. */
export const allowedContentTypes = {
  public: ['image/jpeg', 'image/png', 'image/webp'],
  private: ['application/pdf', 'image/jpeg', 'image/png'],
} as const satisfies Record<StorageVisibility, readonly string[]>;

export const maxObjectBytes = 10 * 1024 * 1024;

/** A link to a private object lives for minutes, never days. */
export const defaultSignedUrlSeconds = 300;
export const maxSignedUrlSeconds = 900;

/**
 * The store id inside a read-write token, `vercel_blob_rw_<storeId>_<random>`, which is also the first
 * label of the store's public host. The SDK reads it the same way. Null when the token has another shape.
 */
export function publicStoreIdFromToken(token: string): string | null {
  const match = /^vercel_blob_rw_([A-Za-z0-9]{1,64})_\S+$/.exec(token);
  return match?.[1] ? match[1].toLowerCase() : null;
}

type StorageSettings = {
  STORAGE_PROVIDER: StorageProviderName;
  VERCEL_ENV?: 'production' | 'preview' | 'development' | undefined;
  BLOB_PUBLIC_READ_WRITE_TOKEN?: string | undefined;
  BLOB_PRIVATE_READ_WRITE_TOKEN?: string | undefined;
};

/**
 * What the environment must also hold for the chosen provider. The fake needs nothing and is
 * allowed in every environment, a production deployment included, so the demo runs without Blob
 * stores; it keeps photos in memory, so they vanish on the next restart.
 */
export function storageSettingIssues(
  settings: StorageSettings,
): { name: string; message: string }[] {
  // TODO(U-021b): refuse the fake in a production deployment once the photo pool is stored; it keeps photos in memory.
  if (settings.STORAGE_PROVIDER === 'fake') return [];
  const issues: { name: string; message: string }[] = [];
  for (const name of [
    'BLOB_PUBLIC_READ_WRITE_TOKEN',
    'BLOB_PRIVATE_READ_WRITE_TOKEN',
  ] as const) {
    if (!settings[name]) {
      issues.push({
        name,
        message: 'Required when STORAGE_PROVIDER=vercel-blob',
      });
    }
  }
  const publicToken = settings.BLOB_PUBLIC_READ_WRITE_TOKEN;
  if (publicToken && !publicStoreIdFromToken(publicToken)) {
    issues.push({
      name: 'BLOB_PUBLIC_READ_WRITE_TOKEN',
      message:
        'Expected the vercel_blob_rw_<storeId>_... form; the store id pins which host next/image may fetch',
    });
  }
  return issues;
}
