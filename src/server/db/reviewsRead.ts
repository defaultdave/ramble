import 'server-only';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { RatingRowSchema, type RatingRow } from '@/lib/experienceCards';
import { reviewListLimit, type ReviewRow } from '@/lib/reviewList';
import { dbRead } from './client';
import { orders, reviews } from './schema';

// What guests see of reviews, read on the HTTP client. The reads decide nothing: `src/lib/rating.ts`
// and `src/lib/reviewList.ts` decide when a rating or a list shows. Only visible reviews count, so
// a review that is hidden later leaves both the mean and the list.

/** The mean rating and the count of the visible reviews of each of these experiences. One with no reviews has no row. */
export async function readRatings(
  experienceIds: readonly string[],
): Promise<RatingRow[]> {
  if (experienceIds.length === 0) return [];
  const rows = await dbRead
    .select({
      experienceId: reviews.experienceId,
      average: sql<number>`avg(${reviews.rating})::float8`,
      count: sql<number>`count(*)::int`,
    })
    .from(reviews)
    .where(
      and(
        inArray(reviews.experienceId, [...experienceIds]),
        eq(reviews.status, 'visible'),
      ),
    )
    .groupBy(reviews.experienceId);
  return RatingRowSchema.array().parse(rows);
}

/**
 * The newest visible reviews of an experience, at most `reviewListLimit`, with the first name's
 * source (the order's lead guest name). The booker's email is not selected.
 */
export async function listReviewRows(
  experienceId: string,
): Promise<ReviewRow[]> {
  return dbRead
    .select({
      id: reviews.id,
      rating: reviews.rating,
      body: reviews.body,
      createdAt: reviews.createdAt,
      guestName: orders.leadGuestName,
    })
    .from(reviews)
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(
      and(
        eq(reviews.experienceId, experienceId),
        eq(reviews.status, 'visible'),
      ),
    )
    .orderBy(desc(reviews.createdAt), desc(reviews.id))
    .limit(reviewListLimit);
}
