import 'server-only';
import { storedPhotoContentType } from '@/lib/photos';
import type { StoragePort } from '@/server/ports/storage';
import type { IngestedPhoto } from './ingest';

/** Stores the ingested copy under its key and returns the address a page will load it from. */
export async function storeIngestedPhoto(
  storage: StoragePort,
  key: string,
  ingested: Pick<IngestedPhoto, 'bytes'>,
): Promise<string> {
  const stored = await storage.put({
    key,
    body: ingested.bytes,
    contentType: storedPhotoContentType,
  });
  if (!stored.url) {
    throw new Error('A public photo came back without an address');
  }
  return stored.url;
}
