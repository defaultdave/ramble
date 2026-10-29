import { describe, expect, it, vi } from 'vitest';
import type { StoragePort } from '@/server/ports/storage';
import { storeIngestedPhoto } from './store';

// Behaviours under test:
// - the bytes are put under the given key with the stored content type, and the address comes back
// - a store that answers without an address is refused, not repaired
// - a refusal from the store propagates

const key = 'public/photos/e/p.jpg';
const bytes = Uint8Array.of(1, 2, 3);

const storageReturning = (url: string | null) => {
  const put = vi.fn(() =>
    Promise.resolve({
      key,
      visibility: 'public' as const,
      size: 3,
      contentType: 'image/jpeg',
      url,
    }),
  );
  return { storage: { put } as unknown as StoragePort, put };
};

describe('storeIngestedPhoto', () => {
  it('puts the bytes under the key as a JPEG and returns the address', async () => {
    const { storage, put } = storageReturning('https://example.invalid/p.jpg');
    expect(await storeIngestedPhoto(storage, key, { bytes })).toBe(
      'https://example.invalid/p.jpg',
    );
    expect(put).toHaveBeenCalledWith({
      key,
      body: bytes,
      contentType: 'image/jpeg',
    });
  });

  it('refuses a store that returns no address', async () => {
    const { storage } = storageReturning(null);
    await expect(storeIngestedPhoto(storage, key, { bytes })).rejects.toThrow(
      'A public photo came back without an address',
    );
  });

  it('lets a store refusal through', async () => {
    const storage = {
      put: vi.fn(() => Promise.reject(new Error('unavailable'))),
    } as unknown as StoragePort;
    await expect(storeIngestedPhoto(storage, key, { bytes })).rejects.toThrow(
      'unavailable',
    );
  });
});
