import { afterEach, describe, expect, it, vi } from 'vitest';

async function loadConfig() {
  vi.resetModules();
  return import('./config');
}

const now = () => new Date('2026-10-26T12:00:00.000Z');

describe('getStorage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it('is the fake when nothing is configured', async () => {
    vi.stubEnv('STORAGE_PROVIDER', undefined);
    const { getStorage } = await loadConfig();

    expect(getStorage(now).provider).toBe('fake');
  });

  it('gives every fake adapter the same objects', async () => {
    const { getStorage } = await loadConfig();
    const key = 'private/documents/shared.pdf';

    await getStorage(now).put({
      key,
      body: new TextEncoder().encode('%PDF'),
      contentType: 'application/pdf',
    });

    await expect(getStorage(now).getSignedUrl({ key })).resolves.toContain(key);
  });

  it('is vercel-blob when both stores are configured', async () => {
    vi.stubEnv('STORAGE_PROVIDER', 'vercel-blob');
    vi.stubEnv('BLOB_PUBLIC_READ_WRITE_TOKEN', 'test-public-token');
    vi.stubEnv('BLOB_PRIVATE_READ_WRITE_TOKEN', 'test-private-token');
    const { getStorage } = await loadConfig();

    expect(getStorage(now).provider).toBe('vercel-blob');
  });
});
