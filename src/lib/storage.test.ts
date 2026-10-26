import { describe, expect, it } from 'vitest';
import {
  allowedContentTypes,
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

describe('storageSettingIssues', () => {
  it('asks for nothing of the fake', () => {
    expect(storageSettingIssues({ STORAGE_PROVIDER: 'fake' })).toEqual([]);
  });

  it('asks for both tokens of vercel-blob, one issue each', () => {
    expect(
      storageSettingIssues({ STORAGE_PROVIDER: 'vercel-blob' }).map(
        (issue) => issue.name,
      ),
    ).toEqual([
      'BLOB_PUBLIC_READ_WRITE_TOKEN',
      'BLOB_PRIVATE_READ_WRITE_TOKEN',
    ]);
  });

  it('asks only for the token that is missing', () => {
    expect(
      storageSettingIssues({
        STORAGE_PROVIDER: 'vercel-blob',
        BLOB_PUBLIC_READ_WRITE_TOKEN: 'x',
      }).map((issue) => issue.name),
    ).toEqual(['BLOB_PRIVATE_READ_WRITE_TOKEN']);
  });

  it('is satisfied by both tokens', () => {
    expect(
      storageSettingIssues({
        STORAGE_PROVIDER: 'vercel-blob',
        BLOB_PUBLIC_READ_WRITE_TOKEN: 'x',
        BLOB_PRIVATE_READ_WRITE_TOKEN: 'y',
      }),
    ).toEqual([]);
  });
});
