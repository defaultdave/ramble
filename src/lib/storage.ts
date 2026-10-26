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

type StorageSettings = {
  STORAGE_PROVIDER: StorageProviderName;
  BLOB_PUBLIC_READ_WRITE_TOKEN?: string | undefined;
  BLOB_PRIVATE_READ_WRITE_TOKEN?: string | undefined;
};

/** What the environment must also hold for the chosen provider. The fake needs nothing. */
export function storageSettingIssues(
  settings: StorageSettings,
): { name: string; message: string }[] {
  if (settings.STORAGE_PROVIDER !== 'vercel-blob') return [];
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
  return issues;
}
