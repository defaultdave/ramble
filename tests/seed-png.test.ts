import sharp from 'sharp';
import { describe, expect, it } from 'vitest';
import { renderTestPhoto } from '@/lib/seed/testPhotos';
import { encodePng } from '@/server/db/seed/png';

// Behaviours under test:
// - the PNG decodes to the pixels it was given, at its size
// - a buffer that does not match the size is refused
// - a banded 2,400 px gradient stays far under the 10 MB upload cap

describe('encodePng', () => {
  it('round-trips the pixels', async () => {
    const rgb = Uint8Array.from(
      { length: 4 * 3 * 3 },
      (_, i) => (i * 17) % 256,
    );
    const { data, info } = await sharp(encodePng(rgb, 4, 3))
      .raw()
      .toBuffer({ resolveWithObject: true });
    expect([info.width, info.height, info.channels]).toEqual([4, 3, 3]);
    expect(new Uint8Array(data)).toEqual(rgb);
  });

  it('refuses a buffer of the wrong length', () => {
    expect(() => encodePng(new Uint8Array(5), 2, 2)).toThrow(RangeError);
  });

  it('keeps a ceiling-sized test photo small', () => {
    const photo = {
      width: 2400,
      height: 1600,
      hue: 120,
      label: ['KAYAK', 'PHOTO 1/3 2400PX'],
    };
    const png = encodePng(renderTestPhoto(photo), photo.width, photo.height);
    expect(png.byteLength).toBeLessThan(2 * 1024 * 1024);
  });
});
