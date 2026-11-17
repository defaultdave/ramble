'use server';

import { redirect } from 'next/navigation';
import { noticeHref } from '@/lib/opsForm';
import {
  parseReviewHideForm,
  parseReviewUnhideForm,
  reviewModerationChanged,
  reviewModerationPath,
} from '@/lib/reviewModeration';
import { updateTagsForChanges } from '@/server/cache/invalidate';
import {
  setReviewVisibility,
  type ReviewModerationResult,
} from '@/server/db/reviewModeration';
import { opsCallerOrLeave } from '@/server/opsAccess';

/** Refreshes the experience's pages when the review changed, so a card and the experience page drop or restore it, then returns with the outcome. */
function leaveWith({ outcome, experienceId }: ReviewModerationResult): never {
  if (experienceId !== null && reviewModerationChanged(outcome)) {
    updateTagsForChanges([{ kind: 'experience', experienceId }]);
  }
  redirect(noticeHref(reviewModerationPath, outcome));
}

export async function hideReviewAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(reviewModerationPath);
  const parsed = parseReviewHideForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(reviewModerationPath, 'invalid'));
  leaveWith(
    await setReviewVisibility(caller, { action: 'hide', ...parsed.value }),
  );
}

export async function unhideReviewAction(formData: FormData): Promise<void> {
  const caller = await opsCallerOrLeave(reviewModerationPath);
  const parsed = parseReviewUnhideForm((name) => formData.get(name));
  if (!parsed.ok) redirect(noticeHref(reviewModerationPath, 'invalid'));
  leaveWith(
    await setReviewVisibility(caller, { action: 'unhide', ...parsed.value }),
  );
}
