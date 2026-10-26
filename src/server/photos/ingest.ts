import 'server-only';
import sharp, { type OutputInfo } from 'sharp';
import {
  photoLimits,
  refusalForHeader,
  refusalForUpload,
  type PhotoRefusalCode,
} from '@/lib/photos';

export class PhotoRefusedError extends Error {
  readonly code: PhotoRefusalCode;

  constructor(code: PhotoRefusalCode) {
    super(`Photo refused: ${code}`);
    this.name = 'PhotoRefusedError';
    this.code = code;
  }
}

export type IngestedPhoto = {
  /** The stored copy: a baseline-safe JPEG with no EXIF, GPS, XMP, IPTC, or embedded profile. */
  bytes: Buffer;
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
export async function ingestPhoto(upload: Uint8Array): Promise<IngestedPhoto> {
  const uploadRefusal = refusalForUpload(upload.byteLength);
  if (uploadRefusal) throw new PhotoRefusedError(uploadRefusal);

  const header = await readHeader(upload);
  const headerRefusal = refusalForHeader(header);
  if (headerRefusal) throw new PhotoRefusedError(headerRefusal);

  let stored: { data: Buffer; info: OutputInfo };
  try {
    stored = await sharp(upload, {
      limitInputPixels: photoLimits.maxPixels,
      failOn: 'warning',
    })
      // Apply the camera's rotation before the tags that record it are dropped.
      .rotate()
      .resize({
        width: photoLimits.storedEdge,
        height: photoLimits.storedEdge,
        fit: 'inside',
        withoutEnlargement: true,
      })
      .toColourspace('srgb')
      .flatten({ background: '#ffffff' })
      .jpeg({ quality: storedQuality, mozjpeg: true })
      .toBuffer({ resolveWithObject: true });
  } catch {
    throw new PhotoRefusedError('corrupt');
  }
  if (stored.data.byteLength > photoLimits.maxStoredBytes) {
    throw new PhotoRefusedError('too_large');
  }

  return {
    bytes: stored.data,
    width: stored.info.width,
    height: stored.info.height,
    blurDataUrl: await blurPlaceholder(stored.data),
  };
}

/** Reads the file header only. The pixel limit is off here because no pixel is decoded. */
async function readHeader(upload: Uint8Array) {
  try {
    const meta = await sharp(upload, { limitInputPixels: false }).metadata();
    return {
      format: meta.format,
      width: meta.width,
      height: meta.height,
      pages: meta.pages,
    };
  } catch {
    throw new PhotoRefusedError('unsupported_format');
  }
}

async function blurPlaceholder(stored: Buffer): Promise<string> {
  const tiny = await sharp(stored)
    .resize({
      width: blurEdge,
      height: blurEdge,
      fit: 'inside',
    })
    .jpeg({ quality: blurQuality })
    .toBuffer();
  const dataUrl = `data:image/jpeg;base64,${tiny.toString('base64')}`;
  if (dataUrl.length > photoLimits.maxBlurLength) {
    throw new Error('Blur placeholder exceeds its length limit');
  }
  return dataUrl;
}
