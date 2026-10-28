import 'server-only';
import { z } from 'zod';
import {
  allowedContentTypes,
  defaultSignedUrlSeconds,
  maxObjectBytes,
  maxSignedUrlSeconds,
  StorageKeySchema,
  visibilityOfKey,
  type StorageProviderName,
  type StorageVisibility,
} from '@/lib/storage';

export type StorageErrorCode =
  /** The input failed the port's schema; nothing was sent. */
  | 'invalid_input'
  | 'not_found'
  /** Keys are immutable: a stored object is never overwritten. */
  | 'already_exists'
  /** The provider could not take the request; retry later. */
  | 'provider_unavailable';

export class StorageError extends Error {
  readonly code: StorageErrorCode;

  constructor(code: StorageErrorCode, message?: string, cause?: unknown) {
    super(message ?? code, cause === undefined ? undefined : { cause });
    this.name = 'StorageError';
    this.code = code;
  }
}

const PutInputSchema = z
  .object({
    key: StorageKeySchema,
    body: z.custom<Uint8Array>((value) => value instanceof Uint8Array),
    contentType: z.string().max(100),
  })
  .superRefine((input, ctx) => {
    const visibility = visibilityOfKey(input.key);
    if (!visibility) return;
    const allowed: readonly string[] = allowedContentTypes[visibility];
    if (!allowed.includes(input.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: `${input.contentType} is not allowed under ${visibility}/`,
      });
    }
    if (input.body.byteLength === 0 || input.body.byteLength > maxObjectBytes) {
      ctx.addIssue({
        code: 'custom',
        path: ['body'],
        message: `An object is 1 to ${String(maxObjectBytes)} bytes`,
      });
    }
  });
export type PutInput = z.input<typeof PutInputSchema>;

const SignedUrlInputSchema = z.object({
  key: StorageKeySchema.refine((key) => key.startsWith('private/'), {
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
 * document can never be written to, or linked from, the public side. Expected refusals reject with a
 * `StorageError`; nothing is repaired.
 */
export type StoragePort = {
  readonly provider: StorageProviderName;
  /** Stores a new object. A key that already holds one is refused, never overwritten. */
  put(input: PutInput): Promise<StoredObject>;
  /** A link to a private object that stops working after `expiresInSeconds` (default 5 minutes, at most 15). */
  getSignedUrl(input: SignedUrlInput): Promise<string>;
  /** Removes an object. Deleting a key that holds nothing is not an error. */
  delete(input: DeleteInput): Promise<void>;
};

export function parsePutInput(input: PutInput) {
  const result = PutInputSchema.safeParse(input);
  if (!result.success) throw new StorageError('invalid_input');
  const visibility = visibilityOfKey(result.data.key);
  if (!visibility) throw new StorageError('invalid_input');
  return { ...result.data, visibility };
}

export function parseSignedUrlInput(input: SignedUrlInput) {
  const result = SignedUrlInputSchema.safeParse(input);
  if (!result.success) throw new StorageError('invalid_input');
  return result.data;
}

export function parseDeleteInput(input: DeleteInput) {
  const result = DeleteInputSchema.safeParse(input);
  if (!result.success) throw new StorageError('invalid_input');
  return result.data;
}
