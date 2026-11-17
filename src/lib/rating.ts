import { z } from 'zod';
import { reviewCopy } from './copy/review';

export type Rating = { average: number; count: number };

/** What the aggregate query returns for one experience: its visible reviews' mean rating and how many there are. */
export const RatingSchema = z.object({
  average: z.number().min(1).max(5),
  count: z.int().positive(),
}) satisfies z.ZodType<Rating>;

/** Reviews, and the rating built from them, show once an experience has at least this many. */
export const minReviewsToShow = 5;

/** Whether an experience has enough reviews for its rating and its reviews to be shown (PRD-32). */
export function hasEnoughReviews({ count }: Pick<Rating, 'count'>): boolean {
  return count >= minReviewsToShow;
}

export function ratingLabel({ average, count }: Rating): string | null {
  if (!hasEnoughReviews({ count })) return null;
  return `${average.toFixed(1)} (${String(count)})`;
}

// What a screen reader says in place of the visible "4.9 (12)".
export function ratingDescription({ average, count }: Rating): string | null {
  if (!hasEnoughReviews({ count })) return null;
  return reviewCopy.display.ratedFrom(average.toFixed(1), count);
}
