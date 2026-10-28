import 'server-only';
import {
  blurDataUrlFrom,
  photoLimits,
  refusalForHeader,
  refusalForImageStage,
  refusalForStoredCopy,
  refusalForUpload,
  type PhotoRefusalCode,
} from '@/lib/photos';
import { ImageError, type ImagePort } from '@/server/ports/image';
import { getImagePort } from '@/server/ports/image/config';

// TODO(U-074b): first caller
export class PhotoRefusedError extends Error {
  readonly code: PhotoRefusalCode;

  constructor(code: PhotoRefusalCode) {
    super(`Photo refused: ${code}`);
    this.name = 'PhotoRefusedError';
    this.code = code;
  }
}

export type IngestedPhoto = {
  /** The stored copy: a JPEG with no EXIF, GPS, XMP, IPTC, or embedded profile. */
  bytes: Uint8Array;
  width: number;
  height: number;
  blurDataUrl: string;
};

const blurEdge = 10;
const storedQuality = 82;
const blurQuality = 40;

/**
 * Turns an upload into the copy that is stored and served. Size is checked before the file reaches
 * the decoder, and the header (format, dimensions, frame count) before any pixel is decoded; the
 * decode itself runs under a pixel limit as a second guard. The output is a fresh encode, so
 * nothing from the original file but pixels survives: location data and every other tag are gone.
 * Anything the decoder cannot read is refused, never repaired.
 */
export async function ingestPhoto(
  upload: Uint8Array,
  image: ImagePort = getImagePort(),
): Promise<IngestedPhoto> {
  const uploadRefusal = refusalForUpload(upload.byteLength);
  if (uploadRefusal) throw new PhotoRefusedError(uploadRefusal);

  const header = await image.inspect(upload).catch((error: unknown) => {
    if (error instanceof ImageError) {
      throw new PhotoRefusedError(refusalForImageStage('inspect'));
    }
    throw error;
  });
  const headerRefusal = refusalForHeader(header);
  if (headerRefusal) throw new PhotoRefusedError(headerRefusal);

  const stored = await image
    .reencodeAsJpeg(upload, {
      maxPixels: photoLimits.maxPixels,
      fitWithin: photoLimits.storedEdge,
      quality: storedQuality,
    })
    .catch((error: unknown) => {
      if (error instanceof ImageError) {
        throw new PhotoRefusedError(refusalForImageStage('reencode'));
      }
      throw error;
    });
  const storedRefusal = refusalForStoredCopy(stored.bytes.byteLength);
  if (storedRefusal) throw new PhotoRefusedError(storedRefusal);

  const tiny = await image.thumbnail(stored.bytes, {
    edge: blurEdge,
    quality: blurQuality,
  });
  const blurDataUrl = blurDataUrlFrom(tiny);
  if (!blurDataUrl) throw new Error('Blur placeholder is empty or too long');

  return {
    bytes: stored.bytes,
    width: stored.width,
    height: stored.height,
    blurDataUrl,
  };
}
