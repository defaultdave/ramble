import sharp from 'sharp';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ImageError,
  type ImageErrorCode,
  type ImagePort,
  type ReencodeOptions,
} from '@/server/ports/image';

const solid = { r: 90, g: 140, b: 180 };
const options: ReencodeOptions = {
  maxPixels: 50_000_000,
  fitWithin: 2400,
  quality: 82,
};

function blank(width: number, height: number) {
  return sharp({ create: { width, height, channels: 3, background: solid } });
}

async function rejectsWith(promise: Promise<unknown>, code: ImageErrorCode) {
  const error = await promise.then(
    () => null,
    (reason: unknown) => reason,
  );
  expect(error).toBeInstanceOf(ImageError);
  expect((error as ImageError).code).toBe(code);
}

/**
 * Behaviours every image adapter keeps. The rules about which photos are acceptable are not here:
 * they live in `src/lib/photos.ts` and are tested there and through `ingestPhoto`.
 */
export function describeImagePortContract(
  name: string,
  makePort: () => ImagePort,
) {
  describe(`${name} image contract`, () => {
    const port = makePort();
    let landscape: Buffer;

    beforeAll(async () => {
      landscape = await blank(2000, 1500).jpeg().toBuffer();
    });

    describe('inspect', () => {
      it.each([
        ['jpeg', () => blank(800, 600).jpeg().toBuffer()],
        ['png', () => blank(800, 600).png().toBuffer()],
        ['webp', () => blank(800, 600).webp().toBuffer()],
      ])('reads the header of a %s', async (format, make) => {
        const header = await port.inspect(await make());

        expect(header).toMatchObject({ format, width: 800, height: 600 });
      });

      it('reports the frames of an animation', async () => {
        const frame = (background: string) =>
          sharp({
            create: { width: 800, height: 400, channels: 3, background },
          })
            .png()
            .toBuffer();
        // Identical frames would be merged into one, so the two differ.
        const animated = await sharp(
          [await frame('#ff0000'), await frame('#0000ff')],
          { join: { animated: true } },
        )
          .webp()
          .toBuffer();

        expect((await port.inspect(animated)).pages).toBe(2);
      });

      it('reads the header of an image far over any pixel limit without decoding it', async () => {
        const huge = await sharp({
          create: {
            width: 12_000,
            height: 9_000,
            channels: 3,
            background: solid,
          },
        })
          .png({ compressionLevel: 9 })
          .toBuffer();

        expect(await port.inspect(huge)).toMatchObject({
          width: 12_000,
          height: 9_000,
        });
      });

      it.each([
        ['text', Buffer.from('<html>not an image</html>')],
        ['nothing', Buffer.alloc(0)],
      ])('rejects %s as unreadable', async (_name, bytes) => {
        await rejectsWith(port.inspect(bytes), 'unreadable');
      });
    });

    describe('reencodeAsJpeg', () => {
      it('returns a JPEG of the size it reports', async () => {
        const result = await port.reencodeAsJpeg(landscape, options);

        const meta = await sharp(result.bytes).metadata();
        expect(meta.format).toBe('jpeg');
        expect([result.width, result.height]).toEqual([2000, 1500]);
        expect([meta.width, meta.height]).toEqual([2000, 1500]);
      });

      it('fits a larger image inside the square and keeps its proportions', async () => {
        const big = await blank(4000, 3000).jpeg().toBuffer();

        const result = await port.reencodeAsJpeg(big, options);

        expect([result.width, result.height]).toEqual([2400, 1800]);
      });

      it('does not enlarge a smaller image', async () => {
        const small = await blank(900, 600).jpeg().toBuffer();

        const result = await port.reencodeAsJpeg(small, options);

        expect([result.width, result.height]).toEqual([900, 600]);
      });

      it('drops EXIF with its GPS position, XMP, and the embedded profile', async () => {
        const tagged = await blank(2000, 1500)
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

        const { bytes } = await port.reencodeAsJpeg(tagged, options);

        const after = await sharp(bytes).metadata();
        expect(after.exif).toBeUndefined();
        expect(after.xmp).toBeUndefined();
        expect(after.iptc).toBeUndefined();
        expect(after.icc).toBeUndefined();
        const raw = Buffer.from(bytes);
        for (const text of ['GPS', 'Somebody', 'CameraCo']) {
          expect(raw.includes(Buffer.from(text))).toBe(false);
        }
      });

      it('applies the rotation tag before dropping it', async () => {
        const rotated = await blank(2000, 1600)
          .withMetadata({ orientation: 6 })
          .jpeg()
          .toBuffer();
        expect((await sharp(rotated).metadata()).orientation).toBe(6);

        const result = await port.reencodeAsJpeg(rotated, options);

        expect([result.width, result.height]).toEqual([1600, 2000]);
        expect(
          (await sharp(result.bytes).metadata()).orientation,
        ).toBeUndefined();
      });

      it('flattens transparency onto white', async () => {
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

        const { bytes } = await port.reencodeAsJpeg(png, options);

        const { data } = await sharp(bytes)
          .raw()
          .toBuffer({ resolveWithObject: true });
        expect([...data.subarray(0, 3)].every((value) => value > 250)).toBe(
          true,
        );
      });

      it('accepts a WebP', async () => {
        const webp = await blank(1800, 1200).webp().toBuffer();

        expect((await port.reencodeAsJpeg(webp, options)).width).toBe(1800);
      });

      it('refuses an image over the pixel limit it was given', async () => {
        const tooMany = await blank(2000, 1500).png().toBuffer();

        await rejectsWith(
          port.reencodeAsJpeg(tooMany, { ...options, maxPixels: 2_999_999 }),
          'unreadable',
        );
      });

      it('accepts an image of exactly the pixel limit', async () => {
        await expect(
          port.reencodeAsJpeg(landscape, { ...options, maxPixels: 3_000_000 }),
        ).resolves.toMatchObject({ width: 2000 });
      });

      it('refuses a truncated file instead of storing the part that decoded', async () => {
        const truncated = landscape.subarray(
          0,
          Math.floor(landscape.length / 2),
        );

        await rejectsWith(
          port.reencodeAsJpeg(truncated, options),
          'unreadable',
        );
      });

      it('refuses bytes that are not an image', async () => {
        await rejectsWith(
          port.reencodeAsJpeg(Buffer.from('not an image'), options),
          'unreadable',
        );
      });

      it.each([
        ['no pixel limit', { fitWithin: 2400, quality: 82 }],
        ['a zero pixel limit', { ...options, maxPixels: 0 }],
        ['a pixel limit past the cap', { ...options, maxPixels: 1e9 }],
        ['a zero size', { ...options, fitWithin: 0 }],
        ['a fractional size', { ...options, fitWithin: 10.5 }],
        ['a quality of 0', { ...options, quality: 0 }],
        ['a quality of 101', { ...options, quality: 101 }],
      ])('refuses %s before decoding', async (_name, bad) => {
        await rejectsWith(
          port.reencodeAsJpeg(landscape, bad as ReencodeOptions),
          'invalid_input',
        );
      });
    });

    describe('thumbnail', () => {
      it('fits a JPEG inside the edge', async () => {
        const result = await port.thumbnail(landscape, {
          edge: 10,
          quality: 40,
        });

        const meta = await sharp(result).metadata();
        expect(meta.format).toBe('jpeg');
        expect(meta.width).toBe(10);
        // 7.5 rounds either way between decoders.
        expect(meta.height).toBeGreaterThanOrEqual(7);
        expect(meta.height).toBeLessThanOrEqual(8);
      });

      it('refuses an edge over the cap', async () => {
        await rejectsWith(
          port.thumbnail(landscape, { edge: 257, quality: 40 }),
          'invalid_input',
        );
      });

      it('refuses bytes that are not an image', async () => {
        await rejectsWith(
          port.thumbnail(Buffer.from('nope'), { edge: 10, quality: 40 }),
          'unreadable',
        );
      });
    });
  });
}
