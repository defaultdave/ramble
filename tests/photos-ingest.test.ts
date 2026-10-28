import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { blurDataUrlPattern, photoLimits } from '@/lib/photos';
import { ingestPhoto, PhotoRefusedError } from '@/server/photos/ingest';

// Behaviours under test, through the real image adapter: a valid photo is stored as a JPEG with a
// placeholder; the edge and area limits are enforced from files far under the byte limit (so a small
// download cannot ask for a huge decode); and a non-image, another format, an animation and a
// truncated file are each refused with their code. The rules themselves are tested in
// src/lib/photos.test.ts and src/server/photos/ingest.test.ts, and the adapter in the image contract.

const solid = { r: 90, g: 140, b: 180 };
const blank = (width: number, height: number) =>
  sharp({ create: { width, height, channels: 3, background: solid } });

async function codeOf(attempt: Promise<unknown>) {
  const error = await attempt.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(PhotoRefusedError);
  return (error as PhotoRefusedError).code;
}

describe('ingestPhoto through the sharp adapter', () => {
  it('stores a valid photo as a JPEG with a placeholder', async () => {
    const result = await ingestPhoto(await blank(2000, 1500).jpeg().toBuffer());

    expect((await sharp(result.bytes).metadata()).format).toBe('jpeg');
    expect([result.width, result.height]).toEqual([2000, 1500]);
    expect(result.blurDataUrl).toMatch(new RegExp(blurDataUrlPattern));
    expect(result.blurDataUrl.length).toBeLessThanOrEqual(
      photoLimits.maxBlurLength,
    );
  });

  it('refuses a long edge over 8,192 px from a file far under the byte limit', async () => {
    const wide = await blank(8193, 600).png({ compressionLevel: 9 }).toBuffer();
    expect(wide.byteLength).toBeLessThan(photoLimits.maxInputBytes);

    expect(await codeOf(ingestPhoto(wide))).toBe('too_many_pixels');
  });

  it('refuses an area over the pixel limit when each edge is in range', async () => {
    const big = await blank(8000, 7000).png({ compressionLevel: 9 }).toBuffer();
    expect(big.byteLength).toBeLessThan(photoLimits.maxInputBytes);

    expect(await codeOf(ingestPhoto(big))).toBe('too_many_pixels');
  });

  it.each([
    ['a long edge under 1,600 px', 1500, 1000],
    ['a short edge under 400 px', 3000, 300],
  ])('refuses a photo with %s', async (_name, width, height) => {
    expect(
      await codeOf(ingestPhoto(await blank(width, height).jpeg().toBuffer())),
    ).toBe('too_small');
  });

  it('refuses bytes that are not an image', async () => {
    expect(
      await codeOf(ingestPhoto(Buffer.from('<html>not a photo</html>'))),
    ).toBe('unsupported_format');
  });

  it('refuses a format outside the accepted list', async () => {
    const tiff = await blank(1800, 1200).tiff().toBuffer();

    expect(await codeOf(ingestPhoto(tiff))).toBe('unsupported_format');
  });

  it('refuses an animation', async () => {
    const frame = (background: string) =>
      sharp({ create: { width: 1600, height: 800, channels: 3, background } })
        .png()
        .toBuffer();
    // Identical frames would be merged into one, so the two differ.
    const animated = await sharp(
      [await frame('#ff0000'), await frame('#0000ff')],
      { join: { animated: true } },
    )
      .webp()
      .toBuffer();

    expect(await codeOf(ingestPhoto(animated))).toBe('animated');
  });

  it('refuses a truncated photo', async () => {
    const whole = await blank(2000, 1500).jpeg().toBuffer();

    expect(
      await codeOf(
        ingestPhoto(whole.subarray(0, Math.floor(whole.length / 2))),
      ),
    ).toBe('corrupt');
  });
});
