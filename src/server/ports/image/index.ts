import 'server-only';
import { z } from 'zod';
import type { ImageHeader } from '@/lib/photos';

export type ImageErrorCode =
  /** The input failed the port's schema; nothing was decoded. */
  | 'invalid_input'
  /** The bytes are not an image the decoder can read to the end, or exceed the pixel limit. */
  | 'unreadable';

export class ImageError extends Error {
  readonly code: ImageErrorCode;

  constructor(code: ImageErrorCode, message?: string, cause?: unknown) {
    super(message ?? code, cause === undefined ? undefined : { cause });
    this.name = 'ImageError';
    this.code = code;
  }
}

// Every operation states its own bounds, so a caller cannot ask for unbounded work by leaving one out.
export const ReencodeOptionsSchema = z.object({
  /** The decode is refused above this many pixels. */
  maxPixels: z.int().min(1).max(100_000_000),
  /** The result is fitted inside a square of this many pixels and never enlarged. */
  fitWithin: z.int().min(1).max(16_384),
  quality: z.int().min(1).max(100),
});
export type ReencodeOptions = z.input<typeof ReencodeOptionsSchema>;

export const ThumbnailOptionsSchema = z.object({
  edge: z.int().min(1).max(256),
  quality: z.int().min(1).max(100),
});
type ThumbnailOptions = z.input<typeof ThumbnailOptionsSchema>;

type ReencodedImage = {
  bytes: Uint8Array;
  width: number;
  height: number;
};

/**
 * Image decoding and encoding behind one interface (ARCH-8), so the rules about what a photo may be
 * live in `src/lib/photos.ts` and the decoder library stays swappable. Expected refusals reject with
 * an `ImageError`; nothing is repaired.
 */
export type ImagePort = {
  readonly provider: 'sharp';
  /** Reads the file header only: no pixel is decoded, so a huge image costs nothing here. */
  inspect(input: Uint8Array): Promise<ImageHeader>;
  /**
   * Decodes under `maxPixels` and re-encodes as a JPEG with the camera's rotation applied, colours
   * in sRGB, transparency flattened onto white, and every metadata block (EXIF with GPS, XMP, IPTC,
   * ICC) left out. A file that is damaged anywhere is refused, not partly decoded.
   */
  reencodeAsJpeg(
    input: Uint8Array,
    options: ReencodeOptions,
  ): Promise<ReencodedImage>;
  /** A JPEG fitted inside `edge` pixels, from a JPEG this port produced. */
  thumbnail(jpeg: Uint8Array, options: ThumbnailOptions): Promise<Uint8Array>;
};
