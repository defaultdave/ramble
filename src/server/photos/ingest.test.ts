import { describe, expect, it, vi } from 'vitest';
import {
  blurDataUrlPattern,
  photoLimits,
  type ImageHeader,
} from '@/lib/photos';
import { ImageError, type ImagePort } from '@/server/ports/image';
import { ingestPhoto, PhotoRefusedError } from './ingest';

// Behaviours under test, one per decision, branch or risk:
// - a size refusal never reaches the port, and a header refusal never decodes a pixel
// - a port that cannot read the header means an unsupported format; one that cannot decode means a corrupt file
// - the decode is asked for with the stored square, the pixel limit, and a quality from the rules
// - a re-encode over the stored byte cap is refused before the placeholder is made
// - an error that is not the port's refusal propagates unchanged
// - the blur placeholder is a data URL within its length cap

const goodHeader: ImageHeader = {
  format: 'jpeg',
  width: 2000,
  height: 1500,
  pages: 1,
};

function stubPort(overrides: Partial<ImagePort> = {}) {
  const port = {
    provider: 'sharp' as const,
    inspect: vi.fn(() => Promise.resolve(goodHeader)),
    reencodeAsJpeg: vi.fn(() =>
      Promise.resolve({
        bytes: new Uint8Array(1000),
        width: 2000,
        height: 1500,
      }),
    ),
    thumbnail: vi.fn(() => Promise.resolve(new Uint8Array([1, 2, 3]))),
    ...overrides,
  };
  return port;
}

async function codeOf(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PhotoRefusedError);
  return (error as PhotoRefusedError).code;
}

const upload = new Uint8Array([1, 2, 3]);

describe('ingestPhoto rules', () => {
  it.each([
    ['empty', new Uint8Array(0), 'corrupt'],
    [
      'over the byte limit',
      new Uint8Array(photoLimits.maxInputBytes + 1),
      'too_large',
    ],
  ] as const)(
    'refuses an upload that is %s without calling the port',
    async (_name, bytes, code) => {
      const port = stubPort();

      expect(await codeOf(ingestPhoto(bytes, port))).toBe(code);

      expect(port.inspect).not.toHaveBeenCalled();
      expect(port.reencodeAsJpeg).not.toHaveBeenCalled();
    },
  );

  it('does not decode an image whose header is refused', async () => {
    const port = stubPort({
      inspect: vi.fn(() =>
        Promise.resolve({ ...goodHeader, width: 9000, height: 9000 }),
      ),
    });

    expect(await codeOf(ingestPhoto(upload, port))).toBe('too_many_pixels');

    expect(port.reencodeAsJpeg).not.toHaveBeenCalled();
  });

  it('reads an unreadable header as an unsupported format', async () => {
    const port = stubPort({
      inspect: vi.fn(() => Promise.reject(new ImageError('unreadable'))),
    });

    expect(await codeOf(ingestPhoto(upload, port))).toBe('unsupported_format');
    expect(port.reencodeAsJpeg).not.toHaveBeenCalled();
  });

  it('reads a failed decode as a corrupt file', async () => {
    const port = stubPort({
      reencodeAsJpeg: vi.fn(() => Promise.reject(new ImageError('unreadable'))),
    });

    expect(await codeOf(ingestPhoto(upload, port))).toBe('corrupt');
    expect(port.thumbnail).not.toHaveBeenCalled();
  });

  it('asks for the stored square and the pixel limit from the rules', async () => {
    const port = stubPort();

    await ingestPhoto(upload, port);

    expect(port.reencodeAsJpeg).toHaveBeenCalledWith(upload, {
      maxPixels: photoLimits.maxPixels,
      fitWithin: photoLimits.storedEdge,
      quality: expect.any(Number) as number,
    });
  });

  it('refuses a copy over the stored byte cap before making the placeholder', async () => {
    const port = stubPort({
      reencodeAsJpeg: vi.fn(() =>
        Promise.resolve({
          bytes: new Uint8Array(photoLimits.maxStoredBytes + 1),
          width: 2000,
          height: 1500,
        }),
      ),
    });

    expect(await codeOf(ingestPhoto(upload, port))).toBe('too_large');
    expect(port.thumbnail).not.toHaveBeenCalled();
  });

  it('accepts a copy of exactly the stored byte cap', async () => {
    const port = stubPort({
      reencodeAsJpeg: vi.fn(() =>
        Promise.resolve({
          bytes: new Uint8Array(photoLimits.maxStoredBytes),
          width: 2000,
          height: 1500,
        }),
      ),
    });

    await expect(ingestPhoto(upload, port)).resolves.toBeDefined();
  });

  it.each(['inspect', 'reencodeAsJpeg', 'thumbnail'] as const)(
    'lets a failure of %s that is not a refusal propagate',
    async (method) => {
      const failure = new Error('decoder crashed');
      const port = stubPort({ [method]: vi.fn(() => Promise.reject(failure)) });

      await expect(ingestPhoto(upload, port)).rejects.toBe(failure);
    },
  );

  it('returns the placeholder as a data URL', async () => {
    const result = await ingestPhoto(upload, stubPort());

    expect(result.blurDataUrl).toBe('data:image/jpeg;base64,AQID');
    expect(result.blurDataUrl).toMatch(new RegExp(blurDataUrlPattern));
  });

  it('fails, rather than storing, when the placeholder is over its length cap', async () => {
    const port = stubPort({
      thumbnail: vi.fn(() => Promise.resolve(new Uint8Array(2000))),
    });

    const error = await ingestPhoto(upload, port).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(Error);
    expect(error).not.toBeInstanceOf(PhotoRefusedError);
  });
});
