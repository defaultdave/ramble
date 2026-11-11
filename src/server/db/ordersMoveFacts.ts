import 'server-only';
import { and, asc, eq, gt, ne } from 'drizzle-orm';
import { WriteIdSchema } from '@/lib/catalog';
import {
  moveChoiceLimit,
  type MoveSubject,
  type MoveTarget,
} from '@/lib/moveBooking';
import { remainingSpaces } from '@/lib/holds';
import type { Transaction } from './client';
import { readOpenHeldSeats } from './holds';
import { readCancelFacts } from './ordersCancelFacts';
import { cancellationTiers, experiences, orders, sessions } from './schema';

// What the move reads, apart from ./orderMove, which enqueues jobs: the manage page reads these too
// and stays free of jobs and the monitoring SDK. Nothing here decides; `src/lib/moveBooking.ts` does.

/** The booking with the experience and tier it was made under; null when the order is not a booking. */
export async function readMoveSubject(
  tx: Transaction,
  orderId: string,
): Promise<MoveSubject | null> {
  const id = WriteIdSchema.parse(orderId);
  const booking = await readCancelFacts(tx, id);
  if (booking === null) return null;
  const [terms] = await tx
    .select({
      experienceId: orders.experienceId,
      experienceStatus: experiences.status,
      fullRefundHoursBefore: cancellationTiers.fullRefundHoursBefore,
    })
    .from(orders)
    .innerJoin(experiences, eq(experiences.id, orders.experienceId))
    .innerJoin(
      cancellationTiers,
      eq(cancellationTiers.id, orders.cancellationTierId),
    )
    .where(eq(orders.id, id));
  if (!terms) return null;
  return { facts: booking.facts, sessionId: booking.sessionId, ...terms };
}

const targetColumns = {
  id: sessions.id,
  experienceId: sessions.experienceId,
  status: sessions.status,
  startsAt: sessions.startsAt,
  timeZone: sessions.timeZone,
  allocation: sessions.allocation,
  seatsSold: sessions.seatsSold,
};

type TargetRow = Omit<MoveTarget, 'spacesLeft'> & {
  allocation: number;
  seatsSold: number;
};

async function withSpacesLeft(
  tx: Transaction,
  row: TargetRow,
  at: Date,
): Promise<MoveTarget> {
  const { allocation, seatsSold, ...rest } = row;
  const held = await readOpenHeldSeats(tx, row.id, at);
  return {
    ...rest,
    spacesLeft: remainingSpaces({ allocation, seatsSold }, held),
  };
}

/** The session as a date to move to, as of `at`; null when there is no such session. Read after the session's lock. */
export async function readMoveTarget(
  tx: Transaction,
  sessionId: string,
  at: Date,
): Promise<MoveTarget | null> {
  const [row] = await tx
    .select(targetColumns)
    .from(sessions)
    .where(eq(sessions.id, WriteIdSchema.parse(sessionId)));
  return row ? withSpacesLeft(tx, row, at) : null;
}

/**
 * The next dates of the booking's experience other than its own, soonest first, for the picker.
 * A read without locks: the move judges the date again under them.
 */
export async function readMoveCandidates(
  tx: Transaction,
  subject: Pick<MoveSubject, 'experienceId' | 'sessionId'>,
  at: Date,
): Promise<MoveTarget[]> {
  const rows = await tx
    .select(targetColumns)
    .from(sessions)
    .where(
      and(
        eq(sessions.experienceId, subject.experienceId),
        ne(sessions.id, subject.sessionId),
        eq(sessions.status, 'scheduled'),
        gt(sessions.startsAt, at),
      ),
    )
    .orderBy(asc(sessions.startsAt))
    .limit(moveChoiceLimit);
  return Promise.all(rows.map((row) => withSpacesLeft(tx, row, at)));
}
