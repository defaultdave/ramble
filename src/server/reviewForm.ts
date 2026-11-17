import 'server-only';
import {
  openReviewGate,
  reviewRefusalFor,
  reviewSummary,
  type ReviewInput,
  type ReviewRead,
  type ReviewSubmitStatus,
  type ReviewSummary,
} from '@/lib/reviews';
import { db } from '@/server/db/client';
import { insertReview, readReviewOrder } from '@/server/db/reviews';
import { readDatabaseTime } from '@/server/db/time';
import { consumeRateLimit } from '@/server/ports/rate-limit';
import { resolveToken } from '@/server/tokens';

// The booking behind a review link. The link is the booker's right, so it is checked first, and a
// malformed link, an unknown one, and one from before a token bump all end the same way (`invalid`).
// The link shares the `manage` try count: both are capability links, and a guest who holds one holds the other.

function openReviewLink(reference: string, token: string) {
  return openReviewGate(
    { reference, token },
    {
      spendTry: (checked) => consumeRateLimit('manage', checked),
      open: (checkedReference, checkedToken) =>
        resolveToken('review', checkedToken, checkedReference),
    },
  );
}

export type ReviewPage = {
  read: ReviewRead;
  summary: ReviewSummary | null;
};

/**
 * What the review page shows for a link. Each view spends one try, and a link of the wrong shape
 * spends none and reaches no database. The order and the database's clock are read in one
 * snapshot, so the state the page decides on is the state it read.
 */
export async function readReviewPage(
  reference: string,
  token: string,
): Promise<ReviewPage> {
  const gate = await openReviewLink(reference, token);
  if (gate.kind === 'refused') {
    return { read: reviewRefusalFor(gate).read, summary: null };
  }
  const { id } = gate.row;
  const read = await db.transaction(async (tx) => ({
    order: await readReviewOrder(tx, id),
    now: await readDatabaseTime(tx),
  }));
  if (!read.order) return { read: { kind: 'invalid' }, summary: null };
  return {
    read: { kind: 'found', facts: read.order.facts, now: read.now },
    summary: reviewSummary(read.order),
  };
}

/**
 * Writes the review a posted form carries, if its link opens an order the booker may review now.
 * The write itself re-checks under the order's lock. A failed rate-limit store or lookup throws, so
 * the action fails closed.
 */
export async function submitReview(
  input: ReviewInput,
): Promise<ReviewSubmitStatus> {
  const gate = await openReviewLink(input.reference, input.token);
  if (gate.kind === 'refused') return reviewRefusalFor(gate).submit;
  return db.transaction((tx) =>
    insertReview(tx, {
      orderId: gate.row.id,
      rating: input.rating,
      body: input.body,
    }),
  );
}
