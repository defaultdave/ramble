import { z } from 'zod';

export const storageProviderNames = ['fake', 'vercel-blob'] as const;
export type StorageProviderName = (typeof storageProviderNames)[number];

/**
 * `audit` holds the nightly audit-log export: no address, no signed link, and no delete, so what the
 * port accepts there it can never be asked to give back or remove.
 */
export type StorageVisibility = 'public' | 'private' | 'audit';

/**
 * The first path segment of a key says who may read the object. A public photo cannot be written
 * under `private/` or the other way round, so which store an object lands in is never a separate
 * argument that a caller could get wrong.
 */
const keyPattern =
  /^(public|private|audit)\/[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*$/;

const maxKeyLength = 200;

export const StorageKeySchema = z.string().max(maxKeyLength).regex(keyPattern);

export function visibilityOfKey(key: string): StorageVisibility | null {
  if (!StorageKeySchema.safeParse(key).success) return null;
  if (key.startsWith('public/')) return 'public';
  return key.startsWith('audit/') ? 'audit' : 'private';
}

/**
 * Audit objects are write-once and never removed, so no delete is accepted for one. A key that
 * names no store is not deletable either.
 */
export function canDeleteKey(key: string): boolean {
  const visibility = visibilityOfKey(key);
  return visibility !== null && visibility !== 'audit';
}

/** What an adapter declares about the stores behind it. */
export type StorageCapabilities = {
  /** A store whose objects cannot be overwritten or deleted, such as a bucket with object lock. */
  storesAudit: boolean;
};

/** Photos and documents go to any adapter; an audit object only to one with a locked store. */
export function canStoreVisibility(
  visibility: StorageVisibility,
  capabilities: StorageCapabilities,
): boolean {
  return visibility !== 'audit' || capabilities.storesAudit;
}

/**
 * Whether a refused write means the key already holds an object. Keys are written once, so for an
 * export that re-runs it is an earlier attempt's own object.
 */
export function isAlreadyWritten(code: string): boolean {
  return code === 'already_exists';
}

/** A refusal that retrying cannot change: the adapter lacks the store, however often it is asked. */
export function isPermanentStorageCode(code: string): boolean {
  return code === 'unsupported';
}

/** Public objects are photos; private ones are host documents such as a signed waiver. */
export const allowedContentTypes = {
  public: ['image/jpeg', 'image/png', 'image/webp'],
  private: ['application/pdf', 'image/jpeg', 'image/png'],
  audit: ['application/x-ndjson'],
} as const satisfies Record<StorageVisibility, readonly string[]>;

/** The one 10 MiB bound: no stored object, and no uploaded photo, is larger. */
export const maxObjectBytes = 10 * 1024 * 1024;

/** A link to a private object lives for minutes, never days. */
export const defaultSignedUrlSeconds = 300;
export const maxSignedUrlSeconds = 900;

/** Where a refusal belongs in the put input, and what to tell the caller. */
export type PutRefusal = { path: 'contentType' | 'body'; message: string };

/**
 * What a write may hold under its key's prefix: the content types that prefix allows and the one
 * size bound. A key that names no store has no rule here; the key schema refuses it.
 */
export function putRefusals(
  key: string,
  contentType: string,
  byteLength: number,
): PutRefusal[] {
  const visibility = visibilityOfKey(key);
  if (!visibility) return [];
  const refusals: PutRefusal[] = [];
  const allowed: readonly string[] = allowedContentTypes[visibility];
  if (!allowed.includes(contentType)) {
    refusals.push({
      path: 'contentType',
      message: `${contentType} is not allowed under ${visibility}/`,
    });
  }
  if (byteLength === 0 || byteLength > maxObjectBytes) {
    refusals.push({
      path: 'body',
      message: `An object is 1 to ${String(maxObjectBytes)} bytes`,
    });
  }
  return refusals;
}

/** When a link issued at `now` stops working, to the millisecond, so no adapter lets it lapse early. */
export function signedUrlDeadline(now: Date, seconds: number): Date {
  return new Date(now.getTime() + seconds * 1000);
}

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
