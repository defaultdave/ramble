import { labelledOptions } from './experienceEditor';
import {
  fieldsFromIssues,
  formHas,
  formText,
  inFieldOrder,
  oversizedFields,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import {
  NewPhotoSchema,
  photoLimits,
  photoRefusalCodes,
  photoRefusalMessage,
  photoRightsBases,
  refusalForUpload,
  type GuestPhoto,
  type PhotoRefusalCode,
} from './photos';

// The photo upload on the ops experience page: reading the posted form, the sentences for a
// refused field, and the notices the action sends back. One photo is posted at a time, with its own
// alt text and rights, so a refusal names the field to look at.

export const photoFormFields = [
  'photoFile',
  'altText',
  'rightsBasis',
  'rightsHolder',
  'rightsLicense',
  'rightsSourceUrl',
] as const;
export type PhotoFormField = (typeof photoFormFields)[number];

/** The largest text a photo form field may hold, so no rule walks an unbounded string. */
const rawTextLimit = photoLimits.maxUrlLength;

export const photoRightsBasisLabels = {
  host_agreement: 'Covered by the host agreement',
  ramble_owned: 'Shot or owned by Ramble',
  licensed: 'Licensed stock photo',
} as const satisfies Record<(typeof photoRightsBases)[number], string>;

export const photoRightsBasisOptions = labelledOptions(photoRightsBasisLabels);

const rightsFields = {
  basis: 'rightsBasis',
  holder: 'rightsHolder',
  license: 'rightsLicense',
  sourceUrl: 'rightsSourceUrl',
} as const;

function isRightsKey(key: unknown): key is keyof typeof rightsFields {
  return typeof key === 'string' && key in rightsFields;
}

/** The form field a rule on a photo's input belongs to: alt text for anything about the description, and a rights field by its name. */
function fieldOfIssue(path: readonly PropertyKey[]): PhotoFormField | null {
  if (path[0] === 'description') return 'altText';
  if (path[0] !== 'rights') return null;
  return isRightsKey(path[1]) ? rightsFields[path[1]] : 'rightsBasis';
}

export type PhotoFormResult =
  | { status: 'ready'; input: unknown; file: File }
  | { status: 'invalid'; fields: PhotoFormField[] }
  | { status: 'refused'; code: PhotoRefusalCode };

/**
 * Reads a posted photo form. A file over the upload limit is refused by its size alone, so the
 * action never reads its bytes; a missing file, blank alt text, or missing rights are fields to
 * look at.
 */
export function parsePhotoForm(
  get: FormGetter,
  experienceId: string,
): PhotoFormResult {
  const oversized = oversizedFields(
    get,
    ['altText', 'rightsHolder', 'rightsLicense', 'rightsSourceUrl'],
    rawTextLimit,
  );
  const raw = get('photoFile');
  const file = raw instanceof File && raw.size > 0 ? raw : null;
  const parsed = NewPhotoSchema.safeParse({
    experienceId,
    description: formHas(get, 'decorative')
      ? { decorative: true }
      : { decorative: false, altText: formText(get, 'altText') },
    rights: {
      basis: formText(get, 'rightsBasis'),
      holder: formText(get, 'rightsHolder'),
      license: formText(get, 'rightsLicense'),
      sourceUrl: formText(get, 'rightsSourceUrl'),
    },
  });

  const failed = new Set<PhotoFormField>(oversized);
  if (file === null) failed.add('photoFile');
  if (!parsed.success) {
    const named = parsed.error.issues.map((issue) => ({
      path: [fieldOfIssue(issue.path) ?? ''],
    }));
    for (const field of fieldsFromIssues(named, photoFormFields)) {
      failed.add(field);
    }
  }
  if (failed.size > 0 || file === null || !parsed.success) {
    return { status: 'invalid', fields: inFieldOrder(photoFormFields, failed) };
  }
  const code = refusalForUpload(file.size);
  return code === null
    ? { status: 'ready', input: parsed.data, file }
    : { status: 'refused', code };
}

/** What an ops reader sees of a photo's description: its alt text, or that it is decorative. */
export function photoAltSummary(
  photo: Pick<GuestPhoto, 'decorative' | 'altText'>,
): string {
  return photo.decorative
    ? 'Decorative, no alt text.'
    : `Alt text: ${photo.altText ?? ''}`;
}

export const photoFieldProblems = {
  photoFile: 'Choose a photo to upload.',
  altText: `Describe the photo in up to ${String(photoLimits.maxAltLength)} characters, or mark it decorative.`,
  rightsBasis: 'Choose where the rights to this photo come from.',
  rightsHolder: `Name the photographer or rights holder, up to ${String(photoLimits.maxRightsTextLength)} characters.`,
  rightsLicense: `Name the licence, up to ${String(photoLimits.maxRightsTextLength)} characters. A licensed photo needs one.`,
  rightsSourceUrl:
    'Enter the web address the photo came from, starting with http:// or https://. A licensed photo needs one.',
} as const satisfies Record<PhotoFormField, string>;

/** The sentences for each field, with the file's own sentence replaced by the reason the last upload was refused. */
export function photoProblemTexts(
  refusal: PhotoRefusalCode | null,
): Record<PhotoFormField, string> {
  return refusal === null
    ? photoFieldProblems
    : { ...photoFieldProblems, photoFile: photoRefusalMessage(refusal) };
}

export const photoNoticeCodes = [
  'photo_added',
  'photo_invalid',
  'photo_limit',
  'photo_too_large',
  'photo_unsupported_format',
  'photo_too_many_pixels',
  'photo_too_small',
  'photo_animated',
  'photo_corrupt',
] as const;
export type PhotoNoticeCode = (typeof photoNoticeCodes)[number];

/** The notice an upload the pipeline refused sends back; the file field then says why. */
export function photoRefusalNotice(
  code: PhotoRefusalCode,
): `photo_${PhotoRefusalCode}` {
  return `photo_${code}`;
}

/** The refusal a notice stands for, or null for any other notice. */
export function photoRefusalOf(
  notice: PhotoNoticeCode | null,
): PhotoRefusalCode | null {
  return (
    photoRefusalCodes.find((code) => photoRefusalNotice(code) === notice) ??
    null
  );
}

const refused: NoticeText = {
  tone: 'danger',
  title: 'That photo was not added.',
};

export const photoNotices = {
  photo_added: { tone: 'success', title: 'Photo added.' },
  photo_invalid: {
    tone: 'danger',
    title: 'Some photo details need another look.',
  },
  photo_limit: {
    tone: 'danger',
    title: `This experience already has ${String(photoLimits.maxPerExperience)} photos, the most it can hold.`,
  },
  photo_too_large: refused,
  photo_unsupported_format: refused,
  photo_too_many_pixels: refused,
  photo_too_small: refused,
  photo_animated: refused,
  photo_corrupt: refused,
} as const satisfies Record<PhotoNoticeCode, NoticeText>;
