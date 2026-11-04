import 'server-only';
import { z } from 'zod';
import {
  canDeleteKey,
  canStoreVisibility,
  defaultSignedUrlSeconds,
  isPermanentStorageCode,
  maxSignedUrlSeconds,
  putRefusals,
  StorageKeySchema,
  visibilityOfKey,
  type StorageCapabilities,
  type StorageProviderName,
  type StorageVisibility,
} from '@/lib/storage';
import { PortError } from '@/server/ports/portError';

export type StorageErrorCode =
  /** The input failed the port's schema; nothing was sent. */
  | 'invalid_input'
  | 'not_found'
  /** Keys are immutable: a stored object is never overwritten. */
  | 'already_exists'
  /** The provider could not take the request; retry later. */
  | 'provider_unavailable'
  /** The adapter has no store for this kind of object, and asking again will not give it one. */
  | 'unsupported';

export class StorageError extends PortError<StorageErrorCode> {
  /** True when a retry cannot change the outcome; the job drain dead-letters such a failure at once. */
  readonly permanent: boolean;

  constructor(code: StorageErrorCode, message?: string, cause?: unknown) {
    super('StorageError', code, message, cause);
    this.permanent = isPermanentStorageCode(code);
  }
}

const PutInputSchema = z
  .object({
    key: StorageKeySchema,
    body: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    contentType: z.string().max(100),
  })
  .superRefine((input, ctx) => {
    for (const refusal of putRefusals(
      input.key,
      input.contentType,
      input.body.byteLength,
    )) {
      ctx.addIssue({
        code: 'custom',
        path: [refusal.path],
        message: refusal.message,
      });
    }
  });
export type PutInput = z.input<typeof PutInputSchema>;

const SignedUrlInputSchema = z.object({
  key: StorageKeySchema.refine((key) => visibilityOfKey(key) === 'private', {
    message: 'Only a private object has a signed link',
  }),
  expiresInSeconds: z
    .int()
    .min(1)
    .max(maxSignedUrlSeconds)
    .default(defaultSignedUrlSeconds),
});
export type SignedUrlInput = z.input<typeof SignedUrlInputSchema>;

const DeleteInputSchema = z.object({ key: StorageKeySchema });
export type DeleteInput = z.input<typeof DeleteInputSchema>;

type StoredObject = {
  key: string;
  visibility: StorageVisibility;
  size: number;
  contentType: string;
  /** The address anyone can fetch. Null for a private object, which has no address without `getSignedUrl`. */
  url: string | null;
};

/**
 * Object storage behind one interface (design doc 4.2.1). Keys start with `public/` for photos or
 * `private/` for host documents, and the prefix decides which store holds the object, so a private
 * document can never be written to, or linked from, the public side. `audit/` holds the audit-log
 * export: written once, never linked or deleted through the port. Expected refusals reject with a
 * `StorageError`; nothing is repaired.
 */
export type StoragePort = StorageCapabilities & {
  readonly provider: StorageProviderName;
  /** Stores a new object. A key that already holds one is refused, never overwritten. */
  put(input: PutInput): Promise<StoredObject>;
  /** A link to a private object that stops working after `expiresInSeconds` (default 5 minutes, at most 15). */
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  /** Removes an object. Deleting a key that holds nothing is not an error. */
  delete(input: DeleteInput): Promise<void>;
};

type ParsedPut<Visibility extends StorageVisibility> = z.output<
  typeof PutInputSchema
> & { visibility: Visibility };

/**
 * Every adapter's `put` starts here with its own capabilities, so which objects an adapter refuses
 * is the port's rule and not the adapter's. An object it has no store for is refused before any
 * provider is called; for an adapter that declares `storesAudit: false` the result is typed
 * without `audit`.
 */
export function parsePutInput(
  input: PutInput,
  capabilities: { storesAudit: false },
): ParsedPut<'public' | 'private'>;
export function parsePutInput(
  input: PutInput,
  capabilities: StorageCapabilities,
): ParsedPut<StorageVisibility>;
export function parsePutInput(
  input: PutInput,
  capabilities: StorageCapabilities,
): ParsedPut<StorageVisibility> {
  const result = PutInputSchema.safeParse(input);
  if (!result.success) throw new StorageError('invalid_input');
  const visibility = visibilityOfKey(result.data.key);
  if (!visibility) throw new StorageError('invalid_input');
  if (!canStoreVisibility(visibility, capabilities)) {
    throw new StorageError(
      'unsupported',
      `This adapter has no locked store for ${visibility} objects`,
    );
  }
  return { ...result.data, visibility };
}

export function parseSignedUrlInput(input: SignedUrlInput) {
  const result = SignedUrlInputSchema.safeParse(input);
  if (!result.success) throw new StorageError('invalid_input');
  return result.data;
}

export function parseDeleteInput(input: DeleteInput) {
  const result = DeleteInputSchema.safeParse(input);
  if (!result.success || !canDeleteKey(result.data.key)) {
    throw new StorageError('invalid_input');
  }
  return result.data;
}
