import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { EntityIdSchema } from '@/lib/catalog';
import { RatingRowSchema, type RatingRow } from '@/lib/experienceCards';
import {
  reviewListLimit,
  ReviewRowSchema,
  type ReviewRow,
} from '@/lib/reviewList';
import { dbRead } from './client';
import { orders, reviews } from './schema';

// What guests see of reviews, read on the HTTP client. The reads decide nothing: `src/lib/rating.ts`
// and `src/lib/reviewList.ts` decide when a rating or a list shows. Only visible reviews count, so
// a review that is hidden later leaves both the mean and the list.

/** The reviews guests see: a hidden one is in neither the mean nor the list. */
const visibleReview = eq(reviews.status, 'visible');

/** The mean rating and the count of the visible reviews of each of these experiences. One with no reviews has no row, and a malformed ID reads nothing. */
export async function readRatings(
  experienceIds: readonly string[],
): Promise<RatingRow[]> {
  const ids = EntityIdSchema.array().safeParse(experienceIds);
  if (!ids.success || ids.data.length === 0) return [];
  const rows = await dbRead
    .select({
      experienceId: reviews.experienceId,
      average: sql<number>`avg(${reviews.rating})::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(and(inArray(reviews.experienceId, ids.data), visibleReview))
    .groupBy(reviews.experienceId);
  return RatingRowSchema.array().parse(rows);
}

/**
 * The newest visible reviews of an experience, at most `reviewListLimit`, with the first name's
 * source (the order's lead guest name). The booker's email is not selected. A malformed ID reads
 * nothing.
 */
export async function listReviewRows(
  experienceId: string,
): Promise<ReviewRow[]> {
  const id = EntityIdSchema.safeParse(experienceId);
  if (!id.success) return [];
  const rows = await dbRead
    .select({
      id: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      guestName: orders.leadGuestName,
    })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(and(eq(reviews.experienceId, id.data), visibleReview))
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(reviewListLimit);
  return ReviewRowSchema.array().parse(rows);
}
