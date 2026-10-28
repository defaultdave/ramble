import { z } from 'zod';
import { EntityIdSchema, httpUrlPattern } from './catalog';

/**
 * Every bound on a photo in one place. The input bounds are checked before any pixel is decoded;
 * the stored ones are what the database CHECKs repeat.
 */
export const photoLimits = {
  /** An upload larger than this is refused before it reaches the decoder. */
  maxInputBytes: 10 * 1024 * 1024,
  /** ADR 0001 and PRD-50: 1,600 to 8,192 px on the long edge. */
  minLongEdge: 1600,
  maxLongEdge: 8192,
  /** Keeps a 1600 by 1 strip from passing as a photo. */
  minShortEdge: 400,
  /** Decoding costs memory per pixel, so the area is capped on its own: a decompression bomb is small on disk. */
  maxPixels: 50_000_000,
  /** The stored copy fits inside this square; `next/image` makes every served size from it. */
  storedEdge: 2400,
  maxStoredBytes: 5 * 1024 * 1024,
  maxPerExperience: 20,
  maxAltLength: 300,
  maxRightsTextLength: 200,
  maxUrlLength: 2048,
  maxBlurLength: 2048,
} as const;

const acceptedPhotoFormats = ['jpeg', 'png', 'webp'] as const;
type AcceptedPhotoFormat = (typeof acceptedPhotoFormats)[number];

export const storedPhotoContentType = 'image/jpeg';

export const photoRefusalCodes = [
  'too_large',
  'unsupported_format',
  'too_many_pixels',
  'too_small',
  'animated',
  'corrupt',
] as const;
export type PhotoRefusalCode = (typeof photoRefusalCodes)[number];

const refusalCopy: Record<PhotoRefusalCode, string> = {
  too_large: 'That photo is larger than 10 MB. Choose a smaller file.',
  unsupported_format: 'Use a JPEG, PNG, or WebP photo.',
  too_many_pixels:
    'That photo is too big. It can be up to 8,192 pixels on its long edge.',
  too_small:
    'That photo is too small. It needs to be at least 1,600 pixels on its long edge.',
  animated: 'Use a single still photo, not an animation.',
  corrupt: 'That file could not be read as a photo.',
};

export function photoRefusalMessage(code: PhotoRefusalCode): string {
  return refusalCopy[code];
}

/** The check that needs no decoder: the size of what arrived. */
export function refusalForUpload(byteLength: number): PhotoRefusalCode | null {
  if (byteLength === 0) return 'corrupt';
  if (byteLength > photoLimits.maxInputBytes) return 'too_large';
  return null;
}

type ImageStage = 'inspect' | 'reencode';

/** The refusal for a file the decoder could not handle at a stage: no readable header means the format is not one we take, a failed decode of a readable header means the file is damaged. */
export function refusalForImageStage(stage: ImageStage): PhotoRefusalCode {
  return stage === 'inspect' ? 'unsupported_format' : 'corrupt';
}

/** The check on the re-encoded copy, once it exists: what is stored must fit the stored cap. */
export function refusalForStoredCopy(
  byteLength: number,
): PhotoRefusalCode | null {
  return byteLength > photoLimits.maxStoredBytes ? 'too_large' : null;
}

export type ImageHeader = {
  format: string | undefined;
  width: number | undefined;
  height: number | undefined;
  pages: number | undefined;
};

function isAcceptedFormat(format: string): format is AcceptedPhotoFormat {
  return (acceptedPhotoFormats as readonly string[]).includes(format);
}

/** The check on what the decoder reports from the file header, before any pixel is read. */
export function refusalForHeader(header: ImageHeader): PhotoRefusalCode | null {
  const { format, width, height, pages } = header;
  if (!format || !isAcceptedFormat(format)) return 'unsupported_format';
  if (!width || !height) return 'corrupt';
  if ((pages ?? 1) > 1) return 'animated';
  const long = Math.max(width, height);
  const short = Math.min(width, height);
  if (long > photoLimits.maxLongEdge || width * height > photoLimits.maxPixels)
    return 'too_many_pixels';
  if (long < photoLimits.minLongEdge || short < photoLimits.minShortEdge)
    return 'too_small';
  return null;
}

/**
 * The path every photo is stored under; the ids in it are the row's. The `storage_key` CHECK builds
 * the same string in SQL, so the ids must be the canonical lower-case uuids Postgres prints.
 */
export function photoStorageKey(experienceId: string, photoId: string): string {
  return `public/photos/${experienceId}/${photoId}.jpg`;
}

/** The lowest unused position, or null when the experience already holds its limit. */
export function nextPhotoPosition(taken: readonly number[]): number | null {
  const used = new Set(taken);
  for (let position = 0; position < photoLimits.maxPerExperience; position++) {
    if (!used.has(position)) return position;
  }
  return null;
}

/** A tiny JPEG as a data URL, for `next/image`'s `blurDataURL`. Its length is capped by its own CHECK. The separator is `.` because drizzle-kit cuts a CHECK at a literal semicolon. */
export const blurDataUrlPattern = String.raw`^data:image/jpeg.base64,[A-Za-z0-9+/]+={0,2}$`;

const blurDataUrlPrefix = 'data:image/jpeg;base64,';

/**
 * The placeholder as a data URL, or null when it is empty or would not fit `maxBlurLength`. The
 * byte count is checked first, so the encoder never sees more than the cap allows.
 */
export function blurDataUrlFrom(bytes: Uint8Array): string | null {
  if (bytes.byteLength === 0 || bytes.byteLength > photoLimits.maxBlurLength)
    return null;
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  const url = `${blurDataUrlPrefix}${btoa(binary)}`;
  return url.length > photoLimits.maxBlurLength ? null : url;
}

/** The roles that may add a photo to any experience, and the one that may add to its own host's. */
const photoStaffRoles = ['ops', 'admin'] as const;
type PhotoStaffRole = (typeof photoStaffRoles)[number];

export type PhotoActor =
  { kind: 'staff'; role: PhotoStaffRole } | { kind: 'host_owner' };

/** Which way the caller may add photos, from their roles alone; null when they may not at all. */
export function photoActorFor(roles: readonly string[]): PhotoActor | null {
  const role = photoStaffRoles.find((staffRole) => roles.includes(staffRole));
  if (role) return { kind: 'staff', role };
  return roles.includes('host_owner') ? { kind: 'host_owner' } : null;
}

export type PhotoAccess =
  | { outcome: 'staff'; role: PhotoStaffRole }
  | { outcome: 'host_owner'; hostId: string }
  /** Staff are told an experience does not exist. */
  | { outcome: 'experience_missing' }
  /** A host owner is refused the same way for a missing experience as for another host's. */
  | { outcome: 'refused' };

/**
 * What an actor may do once the experience is looked up (`experienceHostId` is null when there is
 * none). A host owner gets the refusal, not "missing", so the answer never says which IDs exist.
 */
export function photoAccessFor(
  actor: PhotoActor,
  experienceHostId: string | null,
): PhotoAccess {
  if (actor.kind === 'staff') {
    return experienceHostId === null
      ? { outcome: 'experience_missing' }
      : { outcome: 'staff', role: actor.role };
  }
  return experienceHostId === null
    ? { outcome: 'refused' }
    : { outcome: 'host_owner', hostId: experienceHostId };
}

export const photoRightsBases = [
  'host_agreement',
  'ramble_owned',
  'licensed',
] as const;

const RightsText = z
  .string()
  .trim()
  .min(1)
  .max(photoLimits.maxRightsTextLength);
const RightsUrl = z
  .string()
  .max(photoLimits.maxUrlLength)
  .regex(new RegExp(httpUrlPattern));

/**
 * PRD-52. A licensed photo (the stock pool of ADR 0008) names its photographer, licence, and source
 * link; one covered by a host agreement or shot by Ramble needs only an optional credit.
 */
export const PhotoRightsSchema = z.discriminatedUnion('basis', [
  z.object({
    basis: z.literal('licensed'),
    holder: RightsText,
    license: RightsText,
    sourceUrl: RightsUrl,
  }),
  z
    .object({
      basis: z.enum(['host_agreement', 'ramble_owned']),
      holder: RightsText.nullish(),
    })
    .transform(({ basis, holder }) => ({
      basis,
      holder: holder ?? null,
      license: null,
      sourceUrl: null,
    })),
]);

/** Alt text is required unless the photo is marked decorative; one or the other, never both. */
const PhotoDescriptionSchema = z.discriminatedUnion('decorative', [
  z.object({ decorative: z.literal(true) }).transform(() => ({
    decorative: true as const,
    altText: null,
  })),
  z.object({
    decorative: z.literal(false),
    altText: z.string().trim().min(1).max(photoLimits.maxAltLength),
  }),
]);

export const NewPhotoSchema = z.object({
  experienceId: EntityIdSchema,
  description: PhotoDescriptionSchema,
  rights: PhotoRightsSchema,
});

/** What a guest page needs to render one photo. Rights and the storage key stay server-side. */
export const GuestPhotoSchema = z.object({
  id: EntityIdSchema,
  experienceId: EntityIdSchema,
  position: z.int().nonnegative(),
  url: z.string().regex(new RegExp(httpUrlPattern)),
  width: z.int().positive(),
  height: z.int().positive(),
  decorative: z.boolean(),
  // Looser than the write schema on purpose: the database counts characters, Zod counts UTF-16 units.
  altText: z.string().min(1).nullable(),
  blurDataUrl: z.string().regex(new RegExp(blurDataUrlPattern)),
});
export type GuestPhoto = z.output<typeof GuestPhotoSchema>;
