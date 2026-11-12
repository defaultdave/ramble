import { andList } from './andList';
import {
  labelledOptions,
  type ExperienceContent,
  type ExperienceStatus,
} from './experienceEditor';
import {
  formText,
  noticeText,
  type FormGetter,
  type NoticeText,
} from './opsForm';
import { formatPrice } from './money';
import { pickKnown } from './pickKnown';
import { hasPhotoDescription, photoLimits, type GuestPhoto } from './photos';

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

export const rejectionReasonOptions = labelledOptions(rejectionReasonLabels);

/** The reason a posted reject form names, or null when it names none of the list. */
function parseRejectionReason(get: FormGetter): RejectionReason | null {
  return pickKnown(formText(get, 'reason'), rejectionReasons, null);
}

export type ReviewDecision =
  { kind: 'approve' } | { kind: 'reject'; reason: RejectionReason };

/** The rejection a posted reject form asks for, or null when it names no reason: a rejection always says why. */
export function parseRejectDecision(get: FormGetter): ReviewDecision | null {
  const reason = parseRejectionReason(get);
  return reason === null ? null : { kind: 'reject', reason };
}

/** Where an experience goes on each decision: approved is live, rejected goes back to draft. */
export const decisionStatuses = {
  approve: 'live',
  reject: 'draft',
} as const satisfies Record<ReviewDecision['kind'], ExperienceStatus>;

type PhotoAlt = Pick<GuestPhoto, 'decorative' | 'altText'>;

/** The photos that would be refused, each by its place in the gallery counted from 1, the cover being 1. */
export function photosNeedingAlt(photos: readonly PhotoAlt[]): number[] {
  return photos.flatMap((photo, index) =>
    hasPhotoDescription(photo) ? [] : [index + 1],
  );
}

export type ReviewRefusal =
  | { status: 'not_in_review' }
  | { status: 'host_suspended' }
  | { status: 'alt_missing'; photoNumbers: number[] };

/**
 * Why a decision cannot go ahead, or null when it can. Only an experience in review is decided.
 * An approval also waits while the host is suspended, since a suspended host has nothing live, and
 * needs every photo to have alt text or be marked decorative. A rejection waits on neither.
 */
export function reviewRefusal(
  status: ExperienceStatus,
  decision: ReviewDecision,
  photos: readonly PhotoAlt[],
  hostSuspended: boolean,
): ReviewRefusal | null {
  if (status !== 'in_review') return { status: 'not_in_review' };
  if (decision.kind === 'reject') return null;
  if (hostSuspended) return { status: 'host_suspended' };
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
  'host_suspended',
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
  host_suspended: {
    tone: 'danger',
    title:
      'Approval refused. This host is suspended. Unsuspend the host first.',
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
  const notice = noticeText(reviewNotices, code);
  if (notice === null || code !== 'alt_missing' || photoNumbers.length === 0) {
    return notice;
  }
  return {
    tone: 'danger',
    title: `Approval refused. ${altNeededText(photoNumbers)}`,
  };
}

/** The facts ops reads before deciding, one line each; a field the host left empty is left out. */
export function reviewListingFacts(
  content: Pick<
    ExperienceContent,
    | 'description'
    | 'meetingPoint'
    | 'included'
    | 'accessibilityNotes'
    | 'adultPriceMinor'
    | 'childPriceMinor'
  >,
): string[] {
  const facts = [
    content.description,
    content.meetingPoint && `Meet at: ${content.meetingPoint}`,
    content.included && `Included: ${content.included}`,
    content.accessibilityNotes && `Access: ${content.accessibilityNotes}`,
    content.adultPriceMinor !== null &&
      `Adult price: ${formatPrice(content.adultPriceMinor)}`,
    content.childPriceMinor !== null &&
      `Child price: ${formatPrice(content.childPriceMinor)}`,
  ];
  return facts.filter((fact): fact is string => typeof fact === 'string');
}
