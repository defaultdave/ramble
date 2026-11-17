import 'server-only';
import {
  and,
  asc,
  desc,
  eq,
  gt,
  isNull,
  lte,
  sql,
  type SQL,
} from 'drizzle-orm';
import {
  reviewEligibility,
  reviewInviteKeyPrefix,
  reviewInviteWindow,
  reviewSubmitStatus,
  type ReviewFacts,
  type ReviewSubmitStatus,
} from '@/lib/reviews';
import { requireAnyRole, Role, type Caller } from '@/server/auth/caller';
import { db, type Transaction } from './client';
import { currentDatabaseTime, readDatabaseTime } from './time';
import { experiences, hosts, jobs, orders, reviews, sessions } from './schema';

// What review collection reads and writes. The reads decide nothing; src/lib/reviews.ts decides who
// may review and when, and the write below asks it again under the order's lock, so the answer it
// acts on is the one at commit and not the one the page was drawn with.

/** One order as the review page, the invite job, and the submit see it. */
export type ReviewOrder = {
  orderId: string;
  reference: string;
  contactEmail: string;
  leadGuestName: string | null;
  manageTokenVersion: number;
  experienceId: string;
  experienceName: string;
  hostName: string;
  startsAt: Date;
  timeZone: string;
  facts: ReviewFacts;
};

async function readOrder(
  executor: Pick<typeof db, 'select'>,
  where: SQL,
  lock: boolean,
): Promise<ReviewOrder | null> {
  const query = executor
    .select({
      orderId: orders.id,
      reference: orders.reference,
      kind: orders.kind,
      status: orders.status,
      refundedTicketMinor: orders.refundedTicketMinor,
      refundedTaxMinor: orders.refundedTaxMinor,
      contactEmail: orders.contactEmail,
      leadGuestName: orders.leadGuestName,
      manageTokenVersion: orders.manageTokenVersion,
      experienceId: experiences.id,
      experienceName: experiences.name,
      hostName: hosts.name,
      startsAt: sessions.startsAt,
      endsAt: sessions.endsAt,
      timeZone: sessions.timeZone,
      reviewId: reviews.id,
    })
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(hosts, eq(hosts.id, orders.hostId))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .leftJoin(reviews, eq(reviews.orderId, orders.id))
    .where(where);
  // `FOR UPDATE OF orders` locks the order alone, which is the row every writer of its state locks.
  const [row] = await (lock ? query.for('update', { of: orders }) : query);
  if (!row) return null;
  const {
    kind,
    status,
    refundedTicketMinor,
    refundedTaxMinor,
    endsAt,
    reviewId,
    ...rest
  } = row;
  return {
    ...rest,
    facts: {
      kind,
      status,
      refundedTicketMinor,
      refundedTaxMinor,
      endsAt,
      reviewed: reviewId !== null,
    },
  };
}

/** The order with this id, or null. An order with no session (a gift purchase) is not found: it has nothing to review. */
export function readReviewOrder(
  executor: Pick<typeof db, 'select'>,
  orderId: string,
): Promise<ReviewOrder | null> {
  return readOrder(executor, eq(orders.id, orderId), false);
}

/**
 * Writes the review for an order, in the caller's transaction, if the order's booker may review it
 * now. The order is locked first, so a cancel that is committing and this write cannot both
 * succeed on stale facts. A second review of one order, even from a racing request, is
 * `already_reviewed`: the unique index decides it.
 */
export async function insertReview(
  tx: Transaction,
  input: { orderId: string; rating: number; body: string },
): Promise<ReviewSubmitStatus> {
  const order = await readOrder(tx, eq(orders.id, input.orderId), true);
  if (!order) return 'not_found';
  const eligibility = reviewEligibility(
    order.facts,
    await readDatabaseTime(tx),
  );
  if (!eligibility.ok) return reviewSubmitStatus(eligibility);
  const [written] = await tx
    .insert(reviews)
    .values({
      orderId: order.orderId,
      experienceId: order.experienceId,
      rating: input.rating,
      body: input.body,
    })
    .onConflictDoNothing({ target: reviews.orderId })
    .returning({ id: reviews.id });
  return written ? 'created' : 'already_reviewed';
}

/**
 * The bookings a sweep at `now` should invite, oldest session first, at most `limit`: confirmed
 * bookings whose session ended between the window's two bounds, with no review and no invite job
 * ever queued (the job's dedupe key is how the sweep tells). Where an order has had its invite,
 * the next sweep reads past it, so the backlog drains and no sweep starts again at the same rows.
 */
export async function readInvitableOrders(
  tx: Transaction,
  now: Date,
  limit: number,
): Promise<{ orderId: string; endsAt: Date }[]> {
  const window = reviewInviteWindow(now);
  return tx
    .select({ orderId: orders.id, endsAt: sessions.endsAt })
    .from(orders)
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .where(
      and(
        eq(orders.kind, 'booking'),
        eq(orders.status, 'confirmed'),
        lte(sessions.endsAt, window.endedBefore),
        gt(sessions.endsAt, window.endedAfter),
        sql`NOT EXISTS (SELECT 1 FROM ${reviews} WHERE ${reviews.orderId} = ${orders.id})`,
        eq(orders.refundedTicketMinor, 0),
        eq(orders.refundedTaxMinor, 0),
        sql`NOT EXISTS (SELECT 1 FROM ${jobs} WHERE ${jobs.dedupeKey} = ${reviewInviteKeyPrefix}::text || ${orders.id}::text)`,
      ),
    )
    .orderBy(asc(sessions.endsAt), asc(orders.id))
    .limit(limit);
}

export type InvitableOrderRow = {
  orderId: string;
  reference: string;
  experienceName: string;
  endsAt: Date;
};

/** How many orders the test console offers to invite. */
const invitableShown = 25;

/**
 * Confirmed bookings an invite can be sent for now, newest session first: ended, still inside the
 * review window, and not yet reviewed. For the test console, which only ops and admin reach.
 */
export async function readInvitableOrderRows(
  caller: Caller,
): Promise<InvitableOrderRow[]> {
  requireAnyRole(caller, [Role.Ops, Role.Admin], {});
  const window = reviewInviteWindow(await currentDatabaseTime(), 0);
  return db
    .select({
      orderId: orders.id,
      reference: orders.reference,
      experienceName: experiences.name,
      endsAt: sessions.endsAt,
    })
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(sessions, eq(sessions.id, orders.sessionId))
    .leftJoin(reviews, eq(reviews.orderId, orders.id))
    .where(
      and(
        eq(orders.kind, 'booking'),
        eq(orders.status, 'confirmed'),
        eq(orders.refundedTicketMinor, 0),
        eq(orders.refundedTaxMinor, 0),
        isNull(reviews.id),
        lte(sessions.endsAt, window.endedBefore),
        gt(sessions.endsAt, window.endedAfter),
      ),
    )
    .orderBy(desc(sessions.endsAt), desc(orders.id))
    .limit(invitableShown);
}
