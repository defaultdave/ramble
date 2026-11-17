'use server';

import { notFound, redirect } from 'next/navigation';
import {
  parseReviewForm,
  reviewProblemPath,
  reviewResultPath,
} from '@/lib/reviews';
import { submitReview } from '@/server/reviewForm';

/**
 * The review form: it posts the link's reference and token with the rating and the words, runs
 * `submitReview`, and sends the booker back to the same page, which says what came of it. It works
 * with scripting off. A form with no usable link is the not-found page; a rating or body that
 * will not do sends the booker back to the form with the fields named.
 */
export async function submitReviewForm(formData: FormData): Promise<void> {
  const parsed = parseReviewForm((name) => formData.get(name));
  if (!parsed.ok && parsed.reason === 'link') notFound();
  if (!parsed.ok) {
    redirect(reviewProblemPath(parsed.reference, parsed.token, parsed.fields));
  }
  const { reference, token } = parsed.value;
  redirect(
    reviewResultPath(reference, token, await submitReview(parsed.value)),
  );
}
