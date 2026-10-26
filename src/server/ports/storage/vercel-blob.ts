import 'server-only';
import {
  BlobError,
  BlobNotFoundError,
  del,
  head,
  issueSignedToken,
  presignUrl,
  put,
} from '@vercel/blob';
import {
  parseDeleteInput,
  parsePutInput,
  parseSignedUrlInput,
  StorageError,
  type StoragePort,
} from './index';

export type VercelBlobOptions = {
  /** Read-write token of the public store, which holds photos. */
  publicToken: string;
  /** Read-write token of the private store, which holds host documents. A Blob store is public or private, never both. */
  privateToken: string;
  /** Time source for link expiry (the Clock port's `now`). */
  now: () => Date;
};

const alreadyExistsText = 'already exists';

function toStorageError(error: unknown): StorageError {
  if (error instanceof StorageError) return error;
  if (error instanceof BlobNotFoundError) return new StorageError('not_found');
  // The SDK's message can echo the request, so only the error kind travels on.
  if (error instanceof BlobError && error.message.includes(alreadyExistsText)) {
    return new StorageError('already_exists');
  }
  return new StorageError('provider_unavailable', undefined, error);
}

/**
 * Vercel Blob, with a public store for photos and a private store for documents. Keys are the
 * blob pathnames; nothing is overwritten and no random suffix is added, so a key names one object
 * for good. A private object's link comes from a signed token and is the only way to open it.
 */
export function createVercelBlobAdapter(
  options: VercelBlobOptions,
): StoragePort {
  const tokenFor = (visibility: 'public' | 'private') =>
    visibility === 'public' ? options.publicToken : options.privateToken;

  return {
    provider: 'vercel-blob',

    async put(input) {
      const { key, body, contentType, visibility } = parsePutInput(input);
      try {
        const result = await put(key, Buffer.from(body), {
          access: visibility,
          token: tokenFor(visibility),
          contentType,
          addRandomSuffix: false,
          allowOverwrite: false,
        });
        return {
          key,
          visibility,
          size: body.byteLength,
          contentType,
          url: visibility === 'public' ? result.url : null,
        };
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async getSignedUrl(input) {
      const { key, expiresInSeconds } = parseSignedUrlInput(input);
      const token = options.privateToken;
      try {
        await head(key, { token });
        const validUntil = options.now().getTime() + expiresInSeconds * 1000;
        const signed = await issueSignedToken({
          token,
          pathname: key,
          operations: ['get'],
          validUntil,
        });
        const { presignedUrl } = await presignUrl(signed, {
          operation: 'get',
          pathname: key,
          access: 'private',
          validUntil,
        });
        return presignedUrl;
      } catch (error) {
        throw toStorageError(error);
      }
    },

    async delete(input) {
      const { key } = parseDeleteInput(input);
      const visibility = key.startsWith('public/') ? 'public' : 'private';
      try {
        await del(key, { token: tokenFor(visibility) });
      } catch (error) {
        if (error instanceof BlobNotFoundError) return;
        throw toStorageError(error);
      }
    },
  };
}
