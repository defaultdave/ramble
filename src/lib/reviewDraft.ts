import { type FormGetter } from './opsForm';
import { reviewLimits, type ReviewSubmitStatus } from './reviews';
import { msPerMinute } from './time';

// What the booker had typed when a review did not go through, kept for a few minutes in a cookie so
// the form comes back filled in. The words never ride in an address, and nothing is stored on the
// server: the cookie is the booker's own and ends with the attempt.

export const reviewDraftCookieName = 'ramble_review_draft';
export const reviewDraftMaxAgeSeconds = (10 * msPerMinute) / 1000;

/** Browsers drop a cookie over 4096 bytes, so a draft that would not fit is not kept. */
const reviewDraftMaxBytes = 3800;

/** The order's reference travels with the draft, so a draft for one booking never fills the form of another. */
export type ReviewDraft = {
  reference: string;
  rating: number | null;
  body: string;
};

const ratingPattern = /^[1-5]$/;
// reference | rating (empty for none) | the words, which may hold anything, bars included.
const draftPattern = /^([^|]*)\|([1-5]?)\|([\s\S]*)$/;

/** The draft of a posted form, whatever it holds: a rating that is not one of the five is no rating, and the words are cut to the limit. */
export function draftOfPost(reference: string, get: FormGetter): ReviewDraft {
  const rating = get('rating');
  const body = get('body');
  return {
    reference,
    rating:
      typeof rating === 'string' && ratingPattern.test(rating)
        ? Number(rating)
        : null,
    body:
      typeof body === 'string'
        ? Array.from(body).slice(0, reviewLimits.bodyMaxChars).join('')
        : '',
  };
}

/** What a submit's outcome does to the kept draft: a wait keeps it for the retry, a review made ends it, anything else leaves it be. */
export function reviewDraftFate(
  status: ReviewSubmitStatus,
): 'keep' | 'forget' | 'leave' {
  if (status === 'rate_limited') return 'keep';
  return status === 'created' ? 'forget' : 'leave';
}

/** The cookie value for a draft, or null for one too large to keep. */
export function encodeReviewDraft(draft: ReviewDraft): string | null {
  const value = `${draft.reference}|${draft.rating === null ? '' : String(draft.rating)}|${draft.body}`;
  return new TextEncoder().encode(encodeURIComponent(value)).length <=
    reviewDraftMaxBytes
    ? value
    : null;
}

/** The draft a cookie holds, if it is one for this order; anything else is no draft. */
export function parseReviewDraft(
  raw: string | undefined,
  reference: string,
): ReviewDraft | null {
  const match = raw === undefined ? null : draftPattern.exec(raw);
  if (match === null || match[1] !== reference) return null;
  const body = match[3] ?? '';
  if (Array.from(body).length > reviewLimits.bodyMaxChars) return null;
  const rating = match[2] ?? '';
  return {
    reference,
    rating: rating === '' ? null : Number(rating),
    body,
  };
}
