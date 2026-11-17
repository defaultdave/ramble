import 'server-only';
import { and, eq, sql } from 'drizzle-orm';
import { splitPage } from '@/lib/pagination';
import {
  buildReviewModerationRows,
  reviewHiddenEntry,
  reviewModerationChanged,
  reviewModerationOutcome,
  reviewStatusAfter,
  reviewUnhiddenEntry,
  type ReviewHideReason,
  type ReviewModerationOutcome,
  type ReviewModerationRow,
  type ReviewStatus,
} from '@/lib/reviewModeration';
import { opsListPageSize } from '@/lib/tableQuery';
import type { Caller } from '@/server/auth/caller';
import { requireOpsUserId, writeAudit } from './audit';
import { db, dbRead } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { experiences, orders, reviews } from './schema';

// For the ops role alone: each function checks it. src/lib/reviewModeration.ts decides what a hide
// or a show does with the row as it stands; the write below asks it again under the row's lock.

export type ReviewModerationPage = {
  rows: ReviewModerationRow[];
  nextCursor: string | null;
};

/** One page of reviews, newest first, optionally only visible or only hidden ones. */
export async function readReviewsForModeration(
  caller: Caller,
  options: { status: ReviewStatus | null; cursor: string | null },
): Promise<ReviewModerationPage> {
  requireOpsUserId(caller);
  const fetched = await dbRead
    .select({
      id: reviews.id,
      experienceName: experiences.name,
      rating: reviews.rating,
      body: reviews.body,
      guestName: orders.leadGuestName,
      status: reviews.status,
      createdAt: reviews.createdAt,
    })
    .from(reviews)
    .innerJoin(experiences, eq(experiences.id, reviews.experienceId))
    .innerJoin(orders, eq(orders.id, reviews.orderId))
    .where(
      and(
        options.status === null
          ? undefined
          : eq(reviews.status, options.status),
        pastKeysetCursor(reviews, reviews.createdAt, 'desc', options.cursor),
      ),
    )
    .orderBy(...byColumnThenId(reviews, reviews.createdAt, 'desc'))
    .limit(opsListPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, opsListPageSize);
  return { rows: buildReviewModerationRows(items), nextCursor };
}

export type ReviewModerationResult = {
  outcome: ReviewModerationOutcome;
  /** Whose pages show the review, for the cache refresh after a change; null when nothing was found. */
  experienceId: string | null;
};

type Change =
  | { action: 'hide'; id: string; reason: ReviewHideReason }
  | { action: 'unhide'; id: string };

/** Hides or shows one review and records who did it, in one transaction. A review already in that state is left as it was. */
export async function setReviewVisibility(
  caller: Caller,
  change: Change,
): Promise<ReviewModerationResult> {
  const userId = requireOpsUserId(caller);
  return db.transaction(async (tx) => {
    const [current] = await tx
      .select({ status: reviews.status, experienceId: reviews.experienceId })
      .from(reviews)
      .where(eq(reviews.id, change.id))
      .for('update');
    const outcome = reviewModerationOutcome(current, change.action);
    if (current === undefined) return { outcome, experienceId: null };
    const experienceId = current.experienceId;
    if (!reviewModerationChanged(outcome)) {
      return { outcome, experienceId };
    }
    await tx
      .update(reviews)
      .set({
        status: reviewStatusAfter[change.action],
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(reviews.id, change.id));
    await writeAudit(
      tx,
      change.action === 'hide'
        ? reviewHiddenEntry(userId, change.id, change.reason)
        : reviewUnhiddenEntry(userId, change.id),
    );
    return { outcome, experienceId };
  });
}
