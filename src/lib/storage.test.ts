import { describe, expect, it } from 'vitest';
import {
  allowedContentTypes,
  publicStoreIdFromToken,
  defaultSignedUrlSeconds,
  maxSignedUrlSeconds,
  storageSettingIssues,
  visibilityOfKey,
} from './storage';

describe('visibilityOfKey', () => {
  it.each([
    ['public/photos/a.jpg', 'public'],
    ['private/documents/waiver-1.pdf', 'private'],
    [
      'public/photos/3f2b8a40-5c1d-4e6f-9a7b-1c2d3e4f5a6b/7d1c9b1e.jpg',
      'public',
    ],
    ['photos/a.jpg', null],
    ['publicphotos/a.jpg', null],
    ['public', null],
    ['public/', null],
    ['public/../private/a.pdf', null],
    ['private/./a.pdf', null],
    ['private//a.pdf', null],
    ['/public/a.jpg', null],
    ['public/a.jpg\n', null],
    ['', null],
  ])('%j is %s', (key, expected) => {
    expect(visibilityOfKey(key)).toBe(expected);
  });
});

describe('content types', () => {
  it('never lets a document type under public/', () => {
    expect(allowedContentTypes.public).not.toContain('application/pdf');
  });

  it('never lets a script or markup type anywhere', () => {
    const all: readonly string[] = [
      ...allowedContentTypes.public,
      ...allowedContentTypes.private,
    ];
    expect(all.some((type) => /html|javascript|svg|xml/.test(type))).toBe(
      false,
    );
  });
});

describe('signed link lifetime', () => {
  it('defaults to less than the maximum, which is minutes', () => {
    expect(defaultSignedUrlSeconds).toBeLessThanOrEqual(maxSignedUrlSeconds);
    expect(maxSignedUrlSeconds).toBeLessThanOrEqual(15 * 60);
  });
});

describe('publicStoreIdFromToken', () => {
  it.each([
    ['vercel_blob_rw_AbC123xyz_Zk90QwErTy', 'abc123xyz'],
    ['vercel_blob_rw_store1_a_b_c', 'store1'],
    ['vercel_blob_rw__secret', null],
    ['vercel_blob_rw_store1', null],
    ['vercel_blob_rw_store.1_secret', null],
    ['vercel_blob_ro_store1_secret', null],
    ['vercel_blob_rw_store1_has space', null],
    [`vercel_blob_rw_${'a'.repeat(65)}_secret`, null],
    ['test-public-token', null],
    ['', null],
  ])('%j gives %j', (token, expected) => {
    expect(publicStoreIdFromToken(token)).toBe(expected);
  });
});

describe('storageSettingIssues', () => {
  const publicToken = 'vercel_blob_rw_teststore1_notarealsecret';
  const names = (settings: Parameters<typeof storageSettingIssues>[0]) =>
    storageSettingIssues(settings).map((issue) => issue.name);

  it.each([undefined, 'development', 'preview', 'production'] as const)(
    'asks nothing of the fake when VERCEL_ENV is %s, a production deployment included',
    (VERCEL_ENV) => {
      expect(
        storageSettingIssues({ STORAGE_PROVIDER: 'fake', VERCEL_ENV }),
      ).toEqual([]);
    },
  );

  it('asks for both tokens of vercel-blob, one issue each', () => {
    expect(names({ STORAGE_PROVIDER: 'vercel-blob' })).toEqual([
      'BLOB_PUBLIC_READ_WRITE_TOKEN',
      'BLOB_PRIVATE_READ_WRITE_TOKEN',
    ]);
  });

  it('asks only for the token that is missing', () => {
    expect(
      names({
        STORAGE_PROVIDER: 'vercel-blob',
        BLOB_PUBLIC_READ_WRITE_TOKEN: publicToken,
      }),
    ).toEqual(['BLOB_PRIVATE_READ_WRITE_TOKEN']);
  });

  it('refuses a public token whose store id cannot be read, since it pins the image host', () => {
    expect(
      names({
        STORAGE_PROVIDER: 'vercel-blob',
        BLOB_PUBLIC_READ_WRITE_TOKEN: 'not-a-blob-token',
        BLOB_PRIVATE_READ_WRITE_TOKEN: 'y',
      }),
    ).toEqual(['BLOB_PUBLIC_READ_WRITE_TOKEN']);
  });

  it('still asks for both tokens of vercel-blob in a production deployment, where only the fake is relaxed', () => {
    expect(
      names({ STORAGE_PROVIDER: 'vercel-blob', VERCEL_ENV: 'production' }),
    ).toEqual([
      'BLOB_PUBLIC_READ_WRITE_TOKEN',
      'BLOB_PRIVATE_READ_WRITE_TOKEN',
    ]);
  });

  it('still refuses a public token without a store id in a production deployment', () => {
    expect(
      names({
        STORAGE_PROVIDER: 'vercel-blob',
        VERCEL_ENV: 'production',
        BLOB_PUBLIC_READ_WRITE_TOKEN: 'not-a-blob-token',
        BLOB_PRIVATE_READ_WRITE_TOKEN: 'y',
      }),
    ).toEqual(['BLOB_PUBLIC_READ_WRITE_TOKEN']);
  });

  it.each(['production', 'preview', undefined] as const)(
    'is satisfied by both tokens when VERCEL_ENV is %s',
    (VERCEL_ENV) => {
      expect(
        storageSettingIssues({
          STORAGE_PROVIDER: 'vercel-blob',
          VERCEL_ENV,
          BLOB_PUBLIC_READ_WRITE_TOKEN: publicToken,
          BLOB_PRIVATE_READ_WRITE_TOKEN: 'y',
        }),
      ).toEqual([]);
    },
  );
});
