'use server';

import { redirect } from 'next/navigation';
import {
  parseRejectionReason,
  reviewItemPath,
  reviewPath,
  type ReviewDecision,
} from '@/lib/experienceReview';
import { noticeHref } from '@/lib/opsForm';
import { decideExperienceReview } from '@/server/db/experienceReview';
import { idOrLeave, opsCallerOrLeave } from '@/server/opsAccess';

/** Where a decision sends the person: the queue once the experience has left it, the experience's own page when it stays. */
async function decide(
  formData: FormData,
  decision: ReviewDecision | null,
): Promise<never> {
  const caller = await opsCallerOrLeave(reviewPath);
  const experienceId = idOrLeave(formData, 'experienceId', reviewPath);
  const here = reviewItemPath(experienceId);
  if (decision === null) redirect(noticeHref(here, 'no_reason'));

  const result = await decideExperienceReview(caller, experienceId, decision);
  switch (result.status) {
    case 'not_found':
      redirect(reviewPath);
    case 'alt_missing':
      redirect(
        noticeHref(here, 'alt_missing', result.photoNumbers.map(String)),
      );
    case 'not_in_review':
      redirect(noticeHref(here, 'not_in_review'));
    case 'approved':
    case 'rejected':
      redirect(noticeHref(reviewPath, result.status));
  }
}

export async function approveExperienceAction(
  formData: FormData,
): Promise<void> {
  await decide(formData, { kind: 'approve' });
}

export async function rejectExperienceAction(
  formData: FormData,
): Promise<void> {
  const reason = parseRejectionReason((name) => formData.get(name));
  await decide(formData, reason === null ? null : { kind: 'reject', reason });
}
