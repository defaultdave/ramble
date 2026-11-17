import { count } from './copy/format';
import { reviewCopy } from './copy/review';
import { textLines } from './displayText';
import { hasEnoughReviews, ratingDescription, type Rating } from './rating';
import { firstNameOr, nameClip } from './text';
import { venueTimeZone } from './venue';
import { zonedDayLabel } from './zonedLabels';

// What an experience page shows of its reviews (PRD-32): none below the rating threshold, then the
// newest few, each with a first name and no more of the person.

/** The most reviews the page lists. There is no sort, no page two, and no reply. */
export const reviewListLimit = 10;

/** What the page reads of one review. The booker's name is the order's lead guest name, which may be missing; the email is never read. */
export type ReviewRow = {
  id: string;
  rating: number;
  body: string;
  createdAt: Date;
  guestName: string | null;
};

type ReviewItem = {
  id: string;
  rating: number;
  /** "Rated 4 out of 5", for a screen reader. */
  ratingText: string;
  author: string;
  dateLabel: string;
  paragraphs: string[];
};

export type ReviewsView = {
  /** "4.6", the mean to one place. */
  average: string;
  /** The mean rounded to a whole number, for the filled stars beside it. */
  stars: number;
  /** "12 reviews". */
  countLabel: string;
  /** What a screen reader says of the mean and the count together. */
  spoken: string;
  items: ReviewItem[];
};

function newestFirst(a: ReviewRow, b: ReviewRow): number {
  const byTime = b.createdAt.getTime() - a.createdAt.getTime();
  if (byTime !== 0) return byTime;
  return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
}

/**
 * The reviews block, or null when the experience has fewer than the threshold of reviews (the page
 * then draws nothing). The newest `reviewListLimit` come first, whatever order they arrive in; two
 * written at the same instant keep a stable order by id. `rating` is the aggregate over every
 * visible review, not over the rows given.
 */
export function reviewsView(
  rating: Rating | null,
  rows: readonly ReviewRow[],
): ReviewsView | null {
  if (rating === null || !hasEnoughReviews(rating)) return null;
  const spoken = ratingDescription(rating);
  if (spoken === null) return null;
  return {
    average: rating.average.toFixed(1),
    stars: Math.round(rating.average),
    countLabel: count(rating.count, 'review'),
    spoken,
    items: rows
      .toSorted(newestFirst)
      .slice(0, reviewListLimit)
      .map((row) => ({
        id: row.id,
        rating: row.rating,
        ratingText: reviewCopy.display.ratedOutOf(row.rating),
        author: firstNameOr(
          row.guestName,
          reviewCopy.display.anonymousGuest,
          nameClip.firstName,
        ),
        dateLabel: zonedDayLabel(row.createdAt, venueTimeZone),
        paragraphs: textLines(row.body),
      })),
  };
}
