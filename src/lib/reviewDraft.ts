import { type FormGetter } from './opsForm';
import {
  parseReviewRating,
  reviewLimits,
  type ReviewSubmitStatus,
} from './reviews';
import { utf8Bytes } from './text';
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

// reference | rating (empty for none) | the words, which may hold anything, bars included.
const draftPattern = /^([^|]*)\|(\d*)\|([\s\S]*)$/;

/** The draft of a posted form, whatever it holds: a rating that is not one of the five is no rating, and the words are cut to the limit. */
export function draftOfPost(reference: string, get: FormGetter): ReviewDraft {
  const rating = get('rating');
  const body = get('body');
  return {
    reference,
    rating: parseReviewRating(rating),
    body:
      typeof body === 'string'
        ? Array.from(body).slice(0, reviewLimits.bodyMaxChars).join('')
        : '',
  };
}

/** What a submit's outcome does to the kept draft: a wait keeps it for the retry, a form with problems leaves it be, and an outcome that ends the attempt (a review made, or a link that takes none now) forgets it. */
export function reviewDraftFate(
  status: ReviewSubmitStatus,
): 'keep' | 'forget' | 'leave' {
  if (status === 'rate_limited') return 'keep';
  return status === 'invalid' ? 'leave' : 'forget';
}

/** The cookie value for a draft, or null for one too large to keep. */
export function encodeReviewDraft(draft: ReviewDraft): string | null {
  const value = `${draft.reference}|${draft.rating === null ? '' : String(draft.rating)}|${draft.body}`;
  return utf8Bytes(encodeURIComponent(value)) <= reviewDraftMaxBytes
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
  const typed = match[2] ?? '';
  const rating = typed === '' ? null : parseReviewRating(typed);
  if (typed !== '' && rating === null) return null;
  return { reference, rating, body };
}
