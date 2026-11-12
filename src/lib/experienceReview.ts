import { andList } from './andList';
import type { ExperienceStatus } from './experienceEditor';
import { formText, type FormGetter, type NoticeText } from './opsForm';
import { pickKnown } from './pickKnown';
import { photoLimits, type GuestPhoto } from './photos';

// The review of an experience a host has put forward: the pure decisions, the form reading and the
// copy. A host puts a listing in review (a later unit); ops approves it to live or sends it back to
// draft. The audit log holds codes and never a sentence, so a rejection records one of a fixed list
// of reasons, not free text.

export const reviewPath = '/ops/review';

export function reviewItemPath(experienceId: string): string {
  return `${reviewPath}/${experienceId}`;
}

export const rejectionReasons = [
  'photos',
  'description',
  'prices',
  'other',
] as const;
export type RejectionReason = (typeof rejectionReasons)[number];

const rejectionReasonLabels = {
  photos: 'The photos need work',
  description: 'The description needs work',
  prices: 'The prices need work',
  other: 'Something else needs work',
} as const satisfies Record<RejectionReason, string>;

export const rejectionReasonOptions = Object.entries(rejectionReasonLabels).map(
  ([value, label]) => ({ value, label }),
);

/** The reason a posted reject form names, or null when it names none of the list. */
export function parseRejectionReason(get: FormGetter): RejectionReason | null {
  return pickKnown(formText(get, 'reason'), rejectionReasons, null);
}

export type ReviewDecision =
  { kind: 'approve' } | { kind: 'reject'; reason: RejectionReason };

/** Where an experience goes on each decision: approved is live, rejected goes back to draft. */
export const decisionStatuses = {
  approve: 'live',
  reject: 'draft',
} as const satisfies Record<ReviewDecision['kind'], ExperienceStatus>;

type PhotoAlt = Pick<GuestPhoto, 'decorative' | 'altText'>;

/** The photos that would be refused, each by its place in the gallery counted from 1, the cover being 1. */
export function photosNeedingAlt(photos: readonly PhotoAlt[]): number[] {
  return photos.flatMap((photo, index) =>
    photo.decorative || (photo.altText ?? '').trim() !== '' ? [] : [index + 1],
  );
}

export type ReviewRefusal =
  | { status: 'not_in_review' }
  | { status: 'alt_missing'; photoNumbers: number[] };

/**
 * Why a decision cannot go ahead, or null when it can. Only an experience in review is decided,
 * and an approval also needs every photo to have alt text or be marked decorative. A rejection
 * does not wait on the photos.
 */
export function reviewRefusal(
  status: ExperienceStatus,
  decision: ReviewDecision,
  photos: readonly PhotoAlt[],
): ReviewRefusal | null {
  if (status !== 'in_review') return { status: 'not_in_review' };
  if (decision.kind === 'reject') return null;
  const photoNumbers = photosNeedingAlt(photos);
  return photoNumbers.length === 0
    ? null
    : { status: 'alt_missing', photoNumbers };
}

/** The photo numbers a refused approval names in its address, so the notice can name them. */
export const photoNumberFields: readonly string[] = Array.from(
  { length: photoLimits.maxPerExperience },
  (_, index) => String(index + 1),
);

/** "photo 2 and photo 4": the photos a check names, counted as the gallery shows them. */
function photoNumbersText(photoNumbers: readonly (number | string)[]): string {
  return andList.format(photoNumbers.map((n) => `photo ${String(n)}`));
}

/** What to do about the photos an approval is held up by. */
export function altNeededText(photoNumbers: readonly (number | string)[]) {
  return `Add alt text, or mark as decorative, for ${photoNumbersText(photoNumbers)}.`;
}

export const reviewNoticeCodes = [
  'approved',
  'rejected',
  'not_in_review',
  'alt_missing',
  'no_reason',
] as const;
export type ReviewNoticeCode = (typeof reviewNoticeCodes)[number];

const reviewNotices = {
  approved: { tone: 'success', title: 'Experience approved. It is live.' },
  rejected: { tone: 'success', title: 'Experience sent back to draft.' },
  not_in_review: {
    tone: 'info',
    title: 'That experience is not waiting for review, so nothing changed.',
  },
  alt_missing: {
    tone: 'danger',
    title: 'Approval refused. Some photos need alt text.',
  },
  no_reason: { tone: 'danger', title: 'Choose a reason for sending it back.' },
} as const satisfies Record<ReviewNoticeCode, NoticeText>;

/** The notice for a code, naming the photos a refused approval is about. */
export function reviewNoticeText(
  code: ReviewNoticeCode | null,
  photoNumbers: readonly string[],
): NoticeText | null {
  if (code === null) return null;
  if (code !== 'alt_missing' || photoNumbers.length === 0) {
    return reviewNotices[code];
  }
  return {
    tone: 'danger',
    title: `Approval refused. ${altNeededText(photoNumbers)}`,
  };
}
