'use server';

import { notFound, redirect } from 'next/navigation';
import {
  parseReviewForm,
  reviewProblemPath,
  reviewResultPath,
} from '@/lib/reviews';
import { draftOfPost, reviewDraftFate } from '@/lib/reviewDraft';
import { forgetReviewDraft, keepReviewDraft } from '@/server/reviewDraft';
import { submitReview } from '@/server/reviewForm';

/**
 * The review form: it posts the link's reference and token with the rating and the words, runs
 * `submitReview`, and sends the booker back to the same page, which says what came of it. It works
 * with scripting off. A form with no usable link is the not-found page; a rating or body that
 * will not do sends the booker back to the form with the fields named, and what they had typed
 * is kept for a few minutes so the form comes back filled in.
 */
export async function submitReviewForm(formData: FormData): Promise<void> {
  const get = (name: string) => formData.get(name);
  const parsed = parseReviewForm(get);
  if (!parsed.ok && parsed.reason === 'link') notFound();
  if (!parsed.ok) {
    await keepReviewDraft(draftOfPost(parsed.reference, get));
    redirect(reviewProblemPath(parsed.reference, parsed.token, parsed.fields));
  }
  const { reference, token } = parsed.value;
  const status = await submitReview(parsed.value);
  const fate = reviewDraftFate(status);
  if (fate === 'keep') await keepReviewDraft(draftOfPost(reference, get));
  if (fate === 'forget') await forgetReviewDraft();
  redirect(reviewResultPath(reference, token, status));
}
