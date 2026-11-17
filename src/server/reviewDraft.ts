import 'server-only';
import { cookies } from 'next/headers';
import {
  encodeReviewDraft,
  parseReviewDraft,
  reviewDraftCookieName,
  reviewDraftMaxAgeSeconds,
  type ReviewDraft,
} from '@/lib/reviewDraft';
import { reviewBasePath } from '@/lib/routes';

// The booker's own words, held in their own cookie between a submit that did not go through and the
// page that shows the form again. Read by the review page, written and ended by its action.

/** The draft for this order, or null when there is none. */
export async function readReviewDraft(
  reference: string,
): Promise<ReviewDraft | null> {
  const stored = (await cookies()).get(reviewDraftCookieName)?.value;
  return parseReviewDraft(stored, reference);
}

/** Keeps the draft for the retry; one too large for a cookie is not kept. */
export async function keepReviewDraft(draft: ReviewDraft): Promise<void> {
  const value = encodeReviewDraft(draft);
  if (value === null) return;
  (await cookies()).set(reviewDraftCookieName, value, {
    httpOnly: true,
    sameSite: 'lax',
    // Browsers accept a Secure cookie on http://localhost, so local runs keep working.
    secure: true,
    path: reviewBasePath,
    maxAge: reviewDraftMaxAgeSeconds,
  });
}

export async function forgetReviewDraft(): Promise<void> {
  (await cookies()).delete({
    name: reviewDraftCookieName,
    path: reviewBasePath,
  });
}
