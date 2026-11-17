import { z } from 'zod';
import { userActor, type AuditEntryInput } from './audit';
import { WriteIdSchema } from './catalog';
import { reviewCopy } from './copy/review';
import { reviewModerationCopy } from './copy/reviewModeration';
import { defaultHostTimeZone } from './hostSetup';
import {
  formText,
  oversizedFields,
  type FormGetter,
  type FormResult,
  type NoticeText,
} from './opsForm';
import type { ReviewRow } from './reviewList';
import { reviewLimits, reviewStatuses } from './reviews';
import { statusFilter, type StatusTone } from './statusBadge';
import { firstNameOr, nameClip } from './text';
import { zonedDeadlineLabel } from './zonedLabels';

// Ops hiding a review from guests and showing it again (PRD-32). A hidden review stays in the table;
// the guest-facing reads only count and list visible ones. Reports are not here.

export const reviewModerationPath = '/ops/reviews';

export type ReviewStatus = (typeof reviewStatuses)[number];

export const reviewStatusTones = {
  visible: 'success',
  hidden: 'neutral',
} satisfies Record<ReviewStatus, StatusTone>;

const reviewFilter = statusFilter(
  reviewStatuses,
  reviewModerationCopy.statusLabels,
);
export const reviewStatusOptions = reviewFilter.options;

/** The status the address names, or null (every review) for none, a repeated one, or one the page does not have. */
export const parseReviewStatus = reviewFilter.parse;

/** Why a review was hidden, as a code: the audit log holds codes and ids, never a sentence. */
export const reviewHideReasons = [
  'spam',
  'abusive',
  'off_topic',
  'personal_info',
  'other',
] as const;
export type ReviewHideReason = (typeof reviewHideReasons)[number];

export const reviewHideReasonOptions = reviewHideReasons.map((value) => ({
  value,
  label: reviewModerationCopy.hideReasons[value],
}));

export type ReviewModerationRecord = ReviewRow & {
  experienceName: string;
  status: ReviewStatus;
};

export type ReviewModerationRow = {
  id: string;
  experienceName: string;
  ratingText: string;
  body: string;
  firstName: string;
  status: ReviewStatus;
  writtenLabel: string;
};

/** The reviews as the table shows them: the first name only, and the time in New York. */
export function buildReviewModerationRows(
  records: readonly ReviewModerationRecord[],
): ReviewModerationRow[] {
  return records.map((record) => ({
    id: record.id,
    experienceName: record.experienceName,
    ratingText: reviewModerationCopy.ratingText(
      record.rating,
      reviewLimits.maxRating,
    ),
    body: record.body,
    firstName: firstNameOr(
      record.guestName,
      reviewCopy.display.anonymousGuest,
      nameClip.firstName,
    ),
    status: record.status,
    writtenLabel: zonedDeadlineLabel(record.createdAt, defaultHostTimeZone),
  }));
}

export type ReviewModerationAction = 'hide' | 'unhide';

export type ReviewModerationOutcome =
  'hidden' | 'unhidden' | 'already_hidden' | 'already_visible' | 'not_found';

/** What hiding or showing a review does with the row as it stands under the lock: nothing for a missing one or one already in that state. */
export function reviewModerationOutcome(
  row: { status: ReviewStatus } | undefined,
  action: ReviewModerationAction,
): ReviewModerationOutcome {
  if (row === undefined) return 'not_found';
  if (action === 'hide') {
    return row.status === 'hidden' ? 'already_hidden' : 'hidden';
  }
  return row.status === 'visible' ? 'already_visible' : 'unhidden';
}

/** Whether the outcome changed a review, so the pages that show it need a refresh. */
export function reviewModerationChanged(
  outcome: ReviewModerationOutcome,
): boolean {
  return outcome === 'hidden' || outcome === 'unhidden';
}

/** The status a review takes when an action changes it. */
export const reviewStatusAfter = {
  hide: 'hidden',
  unhide: 'visible',
} as const satisfies Record<ReviewModerationAction, ReviewStatus>;

/** A longer field than this is refused unread, so no rule walks an unbounded string. */
const rawFieldMax = 200;

const HideSchema = z.strictObject({
  id: WriteIdSchema,
  reason: z.enum(reviewHideReasons),
});
const UnhideSchema = z.strictObject({ id: WriteIdSchema });

export type ReviewHideInput = z.output<typeof HideSchema>;
export type ReviewUnhideInput = z.output<typeof UnhideSchema>;

/** The posted hide form: a review id and one of the reasons offered. Nothing is repaired; a refused form hides nothing. */
export function parseReviewHideForm(
  get: FormGetter,
): FormResult<ReviewHideInput> {
  if (oversizedFields(get, ['id', 'reason'], rawFieldMax).length > 0) {
    return { ok: false };
  }
  const parsed = HideSchema.safeParse({
    id: formText(get, 'id'),
    reason: formText(get, 'reason'),
  });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

/** The posted show-again form: a review id. */
export function parseReviewUnhideForm(
  get: FormGetter,
): FormResult<ReviewUnhideInput> {
  if (oversizedFields(get, ['id'], rawFieldMax).length > 0) {
    return { ok: false };
  }
  const parsed = UnhideSchema.safeParse({ id: formText(get, 'id') });
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export const reviewModerationNoticeCodes = [
  'hidden',
  'unhidden',
  'already_hidden',
  'already_visible',
  'not_found',
  'invalid',
] as const;

export const reviewModerationNotices = {
  hidden: { tone: 'success', title: reviewModerationCopy.notices.hidden },
  unhidden: { tone: 'success', title: reviewModerationCopy.notices.unhidden },
  already_hidden: {
    tone: 'info',
    title: reviewModerationCopy.notices.already_hidden,
  },
  already_visible: {
    tone: 'info',
    title: reviewModerationCopy.notices.already_visible,
  },
  not_found: {
    tone: 'warning',
    title: reviewModerationCopy.notices.not_found,
  },
  invalid: { tone: 'warning', title: reviewModerationCopy.notices.invalid },
} satisfies Record<(typeof reviewModerationNoticeCodes)[number], NoticeText>;

/** A review was hidden. The reason is a code from the list above. */
export function reviewHiddenEntry(
  userId: string,
  reviewId: string,
  reason: ReviewHideReason,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'review.hidden',
    subjectKind: 'review',
    subjectId: reviewId,
    details: { reason },
  };
}

/** A hidden review was shown again. */
export function reviewUnhiddenEntry(
  userId: string,
  reviewId: string,
): AuditEntryInput {
  return {
    ...userActor(userId),
    action: 'review.unhidden',
    subjectKind: 'review',
    subjectId: reviewId,
  };
}
