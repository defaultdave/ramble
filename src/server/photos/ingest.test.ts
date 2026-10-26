import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import { blurDataUrlPattern, photoLimits } from '@/lib/photos';
import { ingestPhoto, PhotoRefusedError } from './ingest';

// Behaviours under test, one per decision, branch or risk:
// - a valid photo comes back as a JPEG with its blur placeholder
// - EXIF (with GPS), XMP, and the embedded profile of the original are gone from the stored copy
// - a photo larger than the stored square is fitted inside it, a smaller one is not enlarged
// - the camera's rotation is applied before the tag that records it is dropped
// - a PNG with transparency is flattened, and a WebP is accepted
// - each refusal is reported with its code, and nothing is decoded for a size refusal
// - a file that is not an image, a truncated one, and an animation are refused

const solid = { r: 90, g: 140, b: 180 };

function raw(width: number, height: number) {
  return sharp({
    create: { width, height, channels: 3, background: solid },
  });
}

async function jpeg(width: number, height: number) {
  return raw(width, height).jpeg().toBuffer();
}

async function codeOf(upload: Uint8Array) {
  const error = await ingestPhoto(upload).then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PhotoRefusedError);
  return (error as PhotoRefusedError).code;
}

let landscape: Buffer;

beforeAll(async () => {
  landscape = await jpeg(2000, 1500);
});

describe('ingestPhoto', () => {
  it('re-encodes a valid photo as a JPEG and returns a blur placeholder', async () => {
    const result = await ingestPhoto(landscape);

    const meta = await sharp(result.bytes).metadata();
    expect(meta.format).toBe('jpeg');
    expect([result.width, result.height]).toEqual([2000, 1500]);
    expect([meta.width, meta.height]).toEqual([2000, 1500]);
    expect(result.blurDataUrl).toMatch(new RegExp(blurDataUrlPattern));
    expect(result.blurDataUrl.length).toBeLessThanOrEqual(
      photoLimits.maxBlurLength,
    );
  });

  it('drops EXIF with its GPS position, XMP, and the embedded profile', async () => {
    const tagged = await raw(2000, 1500)
      .withExif({
        IFD0: { Copyright: 'Somebody', Make: 'CameraCo' },
        IFD3: {
          GPSLatitudeRef: 'N',
          GPSLatitude: '40/1 44/1 5400/100',
          GPSLongitudeRef: 'W',
          GPSLongitude: '73/1 59/1 3000/100',
        },
      })
      .withXmp(
        '<x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"/></x:xmpmeta>',
      )
      .withIccProfile('p3')
      .jpeg()
      .toBuffer();
    const before = await sharp(tagged).metadata();
    expect(before.exif).toBeDefined();
    expect(before.xmp).toBeDefined();
    expect(before.icc).toBeDefined();

    const result = await ingestPhoto(tagged);

    const after = await sharp(result.bytes).metadata();
    expect(after.exif).toBeUndefined();
    expect(after.xmp).toBeUndefined();
    expect(after.iptc).toBeUndefined();
    expect(after.icc).toBeUndefined();
    expect(result.bytes.includes(Buffer.from('GPS'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('Somebody'))).toBe(false);
    expect(result.bytes.includes(Buffer.from('CameraCo'))).toBe(false);
  });

  it('fits a photo larger than the stored square inside it', async () => {
    const result = await ingestPhoto(await jpeg(4000, 3000));

    expect([result.width, result.height]).toEqual([2400, 1800]);
  });

  it('does not enlarge a photo smaller than the stored square', async () => {
    const result = await ingestPhoto(await jpeg(1600, 1000));

    expect([result.width, result.height]).toEqual([1600, 1000]);
  });

  it('applies the rotation tag before dropping it', async () => {
    const rotated = await raw(2000, 1600)
      .withMetadata({ orientation: 6 })
      .jpeg()
      .toBuffer();
    expect((await sharp(rotated).metadata()).orientation).toBe(6);

    const result = await ingestPhoto(rotated);

    expect([result.width, result.height]).toEqual([1600, 2000]);
    expect((await sharp(result.bytes).metadata()).orientation).toBeUndefined();
  });

  it('flattens a transparent PNG onto white', async () => {
    const png = await sharp({
      create: {
        width: 1800,
        height: 1200,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .png()
      .toBuffer();

    const result = await ingestPhoto(png);

    const { data } = await sharp(result.bytes)
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([...data.subarray(0, 3)].every((value) => value > 250)).toBe(true);
  });

  it('accepts a WebP', async () => {
    const webp = await raw(1800, 1200).webp().toBuffer();

    const result = await ingestPhoto(webp);

    expect(result.width).toBe(1800);
  });

  describe('refusals', () => {
    it.each([
      ['an empty upload', Buffer.alloc(0), 'corrupt'],
      [
        'an upload over the byte limit',
        Buffer.alloc(photoLimits.maxInputBytes + 1),
        'too_large',
      ],
    ] as const)('refuses %s before decoding', async (_name, upload, code) => {
      expect(await codeOf(upload)).toBe(code);
    });

    it('accepts an upload of exactly the byte limit as far as the size check goes', async () => {
      expect(await codeOf(Buffer.alloc(photoLimits.maxInputBytes))).toBe(
        'unsupported_format',
      );
    });

    it('refuses bytes that are not an image', async () => {
      expect(await codeOf(Buffer.from('<html>not a photo</html>'))).toBe(
        'unsupported_format',
      );
    });

    it('refuses a format outside the accepted list', async () => {
      const tiff = await raw(1800, 1200).tiff().toBuffer();

      expect(await codeOf(tiff)).toBe('unsupported_format');
    });

    it.each([
      ['a long edge under 1,600 px', 1500, 1000],
      ['a short edge under 400 px', 3000, 300],
    ])('refuses a photo with %s', async (_name, width, height) => {
      expect(await codeOf(await jpeg(width, height))).toBe('too_small');
    });

    it('refuses a long edge over 8,192 px from the header, so a tiny file cannot ask for a huge decode', async () => {
      const wide = await raw(8193, 600).png({ compressionLevel: 9 }).toBuffer();
      expect(wide.byteLength).toBeLessThan(photoLimits.maxInputBytes);

      expect(await codeOf(wide)).toBe('too_many_pixels');
    });

    it('refuses an area over the pixel limit even when each edge is in range', async () => {
      const big = await sharp({
        create: { width: 8000, height: 7000, channels: 3, background: solid },
      })
        .png({ compressionLevel: 9 })
        .toBuffer();
      expect(big.byteLength).toBeLessThan(photoLimits.maxInputBytes);

      expect(await codeOf(big)).toBe('too_many_pixels');
    });

    it('refuses a truncated JPEG instead of storing the part that decoded', async () => {
      const truncated = landscape.subarray(0, Math.floor(landscape.length / 2));

      expect(await codeOf(truncated)).toBe('corrupt');
    });

    it('refuses an animation', async () => {
      const frame = (background: string) =>
        sharp({
          create: { width: 1600, height: 800, channels: 3, background },
        })
          .png()
          .toBuffer();
      // Identical frames would be merged into one, so the two differ.
      const animated = await sharp(
        [await frame('#ff0000'), await frame('#0000ff')],
        {
          join: { animated: true },
        },
      )
        .webp()
        .toBuffer();
      expect((await sharp(animated).metadata()).pages).toBe(2);

      expect(await codeOf(animated)).toBe('animated');
    });
  });
});
