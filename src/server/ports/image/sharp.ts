import 'server-only';
import sharp from 'sharp';
import {
  ImageError,
  ReencodeOptionsSchema,
  ThumbnailOptionsSchema,
  type ImagePort,
} from './index';

function parse<T>(
  schema: {
    safeParse: (
      value: unknown,
    ) => { success: true; data: T } | { success: false };
  },
  value: unknown,
): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new ImageError('invalid_input');
  return result.data;
}

export function createSharpImageAdapter(): ImagePort {
  return {
    provider: 'sharp',

    async inspect(input) {
      try {
        // The pixel limit is off here because the header is all that is read.
        const meta = await sharp(input, { limitInputPixels: false }).metadata();
        return {
          format: meta.format,
          width: meta.width,
          height: meta.height,
          pages: meta.pages,
        };
      } catch (error) {
        throw new ImageError('unreadable', undefined, error);
      }
    },

    async reencodeAsJpeg(input, rawOptions) {
      const options = parse(ReencodeOptionsSchema, rawOptions);
      try {
        const { data, info } = await sharp(input, {
          limitInputPixels: options.maxPixels,
          // Strict: a truncated or damaged file is refused instead of stored as far as it decoded.
          failOn: 'warning',
        })
          // Apply the camera's rotation before the tags that record it are dropped.
          .rotate()
          .resize({
            width: options.fitWithin,
            height: options.fitWithin,
            fit: 'inside',
            withoutEnlargement: true,
          })
          .toColourspace('srgb')
          .flatten({ background: '#ffffff' })
          .jpeg({ quality: options.quality, mozjpeg: true })
          .toBuffer({ resolveWithObject: true });
        return { bytes: data, width: info.width, height: info.height };
      } catch (error) {
        throw new ImageError('unreadable', undefined, error);
      }
    },

    async thumbnail(jpeg, rawOptions) {
      const options = parse(ThumbnailOptionsSchema, rawOptions);
      try {
        return await sharp(jpeg)
          .resize({ width: options.edge, height: options.edge, fit: 'inside' })
          .jpeg({ quality: options.quality })
          .toBuffer();
      } catch (error) {
        throw new ImageError('unreadable', undefined, error);
      }
    },
  };
}
