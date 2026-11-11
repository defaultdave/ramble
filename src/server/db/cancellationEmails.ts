import 'server-only';
import { and, count, eq, gt, ne } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import type { ExperienceAddress } from '@/lib/routes';
import type { Transaction } from './client';
import { experiences, orders, refunds, sessions } from './schema';
import { readDatabaseTime } from './time';

// What the refund email job reads. Apart from ./orderCancel, which enqueues jobs: the job files
// import this, and `enqueue` imports the job registry that imports them.

export type RefundForEmail = {
  orderId: string;
  status: string;
  reason: string;
  amountMinor: number;
};

/** Null when there is no such refund. */
export async function readRefundForEmail(
  tx: Transaction,
  refundId: string,
): Promise<RefundForEmail | null> {
  const id = WriteIdSchema.parse(refundId);
  const [row] = await tx
    .select({
      orderId: refunds.orderId,
      status: refunds.status,
      reason: refunds.reason,
      amountMinor: refunds.amountMinor,
    })
    .from(refunds)
    .where(eq(refunds.id, id));
  return row ?? null;
}

export type OtherDatesFacts = {
  experience: ExperienceAddress;
  /** Scheduled sessions of the booking's experience that start after now, the booking's own not counted. */
  otherUpcomingSessions: number;
};

/** What the cancellation email needs to point a guest at another date. Null when there is no such booking. */
export async function readOtherDatesFacts(
  tx: Transaction,
  orderId: string,
): Promise<OtherDatesFacts | null> {
  const id = WriteIdSchema.parse(orderId);
  const [booking] = await tx
    .select({
      experienceId: experiences.id,
      slug: experiences.slug,
      sessionId: orders.sessionId,
    })
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .where(eq(orders.id, id));
  if (!booking || booking.sessionId === null) return null;
  const at = await readDatabaseTime(tx);
  const [others] = await tx
    .select({ total: count() })
    .from(sessions)
    .where(
      and(
        eq(sessions.experienceId, booking.experienceId),
        ne(sessions.id, booking.sessionId),
        eq(sessions.status, 'scheduled'),
        gt(sessions.startsAt, at),
      ),
    );
  return {
    experience: { slug: booking.slug, id: booking.experienceId },
    otherUpcomingSessions: others?.total ?? 0,
  };
}
