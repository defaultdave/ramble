import { describe, expect, it } from 'vitest';
import {
  draftOfPost,
  encodeReviewDraft,
  parseReviewDraft,
  reviewDraftFate,
} from './reviewDraft';
import { reviewLimits } from './reviews';

// Behaviours under test, one per decision, branch, or risk.
// the draft of a post
// - the rating and the words of a form are kept as typed, with the order's reference
// - a rating that is not one of the five, or none, is no rating; a missing body is empty
// - the words are cut to the limit, counted in characters
// the cookie value
// - a draft round-trips, bars and line breaks in the words included
// - a draft for another order, a value of the wrong shape, an out-of-range rating, or words over the limit is no draft
// - a draft too large for a cookie is not kept
// what a submit does to the kept draft
// - a wait keeps it, a review made ends it, anything else leaves it be

const reference = 'RMB-7K3M9Q';
const form = (fields: Record<string, string>) => (name: string) =>
  fields[name] ?? null;

describe('draftOfPost', () => {
  it('keeps the rating and the words as typed', () => {
    expect(
      draftOfPost(reference, form({ rating: '4', body: '  Lovely.\nTwice. ' })),
    ).toEqual({ reference, rating: 4, body: '  Lovely.\nTwice. ' });
  });

  it.each(['0', '6', '2.5', 'four', ''])(
    'reads a rating of %j as none',
    (rating) => {
      expect(
        draftOfPost(reference, form({ rating, body: 'x' })).rating,
      ).toBeNull();
    },
  );

  it('reads a missing rating and body as none and empty', () => {
    expect(draftOfPost(reference, form({}))).toEqual({
      reference,
      rating: null,
      body: '',
    });
  });

  it('cuts the words to the limit in characters, not code units', () => {
    const body = '🙂'.repeat(reviewLimits.bodyMaxChars + 5);
    const kept = draftOfPost(reference, form({ rating: '5', body })).body;
    expect(Array.from(kept)).toHaveLength(reviewLimits.bodyMaxChars);
  });
});

describe('the cookie value', () => {
  it.each([
    [{ reference, rating: 4, body: 'Great | fun\nand more' }],
    [{ reference, rating: null, body: 'No rating yet' }],
    [{ reference, rating: 1, body: '' }],
  ])('round-trips %j', (draft) => {
    const value = encodeReviewDraft(draft);
    expect(value).not.toBeNull();
    expect(parseReviewDraft(value ?? undefined, reference)).toEqual(draft);
  });

  it.each([
    ['nothing', undefined],
    ['text of the wrong shape', 'hello'],
    ['another order', 'RMB-2H4J6N|4|Fine'],
    ['a rating out of range', `${reference}|9|Fine`],
    [
      'words over the limit',
      `${reference}|4|${'a'.repeat(reviewLimits.bodyMaxChars + 1)}`,
    ],
  ])('is no draft for %s', (_label, raw) => {
    expect(parseReviewDraft(raw, reference)).toBeNull();
  });

  it('is not kept when it would not fit in a cookie', () => {
    const body = '🙂'.repeat(reviewLimits.bodyMaxChars);
    expect(encodeReviewDraft({ reference, rating: 3, body })).toBeNull();
  });

  it('is kept when it is the longest plain text a review can hold', () => {
    const body = 'a'.repeat(reviewLimits.bodyMaxChars);
    expect(encodeReviewDraft({ reference, rating: 3, body })).not.toBeNull();
  });
});

describe('reviewDraftFate', () => {
  it.each([
    ['rate_limited', 'keep'],
    ['created', 'forget'],
    ['invalid', 'leave'],
    ['already_reviewed', 'forget'],
    ['expired', 'forget'],
    ['not_found', 'forget'],
  ] as const)('does %s to the draft: %s', (status, fate) => {
    expect(reviewDraftFate(status)).toBe(fate);
  });
});
