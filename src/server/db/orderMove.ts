import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import type { z } from 'zod';
import { moveEmailKey } from '@/lib/bookingEmails';
import type { CapabilityTokenKind } from '@/lib/capabilityTokens';
import {
  MoveOrderInputSchema,
  moveAuditEntry,
  moveCacheChanges,
  movePlan,
  moveStart,
  type MoveBookingResult,
  type MovePlan,
} from '@/lib/moveBooking';
import { locksCoverOrder, type LockedAttempt } from '@/lib/orderLocks';
import { revalidateTagsForChanges } from '@/server/cache/invalidate';
import { enqueue } from '@/server/jobs/enqueue';
import { db, type Transaction } from './client';
import { writeAudit } from './audit';
import { untilLocksCoverOrder } from './lockRetry';
import {
  lockHoldRow,
  lockOrderById,
  lockSessionRow,
  readOrderLockIds,
} from './locks';
import type { ResolvedManageToken } from './orderTokens';
import { readMoveSubject, readMoveTarget } from './ordersMoveFacts';
import { holds, orders, sessions } from './schema';
import { readDatabaseTime } from './time';

// Moving a booking to another date by its manage link. Every decision (whether the booking is
// inside the terms, whether the date takes it, the new deadline, what a refusal answers) is a
// function in `src/lib/moveBooking.ts`; this file locks, reads, writes, and executes what it says.

type Moved = { result: MoveBookingResult; plan: MovePlan };

async function moveInTransaction(
  tx: Transaction,
  parsed: z.output<typeof MoveOrderInputSchema>,
  tokenKind: CapabilityTokenKind,
): Promise<LockedAttempt<Moved>> {
  const start = moveStart({
    tokenKind,
    ids: await readOrderLockIds(tx, parsed.orderId),
    targetSessionId: parsed.targetSessionId,
  });
  if (start.kind === 'stop') {
    return { kind: 'done', value: { result: start.result, plan: start } };
  }
  // Lock order: the sessions (in id order), hold, order (db/locks.ts).
  for (const sessionId of start.sessionIds) await lockSessionRow(tx, sessionId);
  await lockHoldRow(tx, start.holdId);
  const locked = await lockOrderById(tx, parsed.orderId);
  // Another move can change the order's session between the read and the lock; these locks are then the old session's.
  if (
    !locksCoverOrder(
      { sessionId: start.fromSessionId, holdId: start.holdId },
      locked,
    )
  ) {
    return { kind: 'stale' };
  }

  const now = await readDatabaseTime(tx);
  const plan = movePlan({
    subject: await readMoveSubject(tx, parsed.orderId),
    target: await readMoveTarget(tx, parsed.targetSessionId, now),
    openedTokenVersion: parsed.openedTokenVersion,
    now,
  });
  if (plan.kind === 'stop') {
    return { kind: 'done', value: { result: plan.result, plan } };
  }

  const { fromSessionId, toSessionId, seats } = plan;
  const movedOrder = await tx
    .update(orders)
    .set({ sessionId: toSessionId, freeCancelUntil: plan.freeCancelUntil })
    .where(
      and(
        eq(orders.id, parsed.orderId),
        eq(orders.status, 'confirmed'),
        eq(orders.sessionId, fromSessionId),
      ),
    )
    .returning({ id: orders.id });
  const movedHold = await tx
    .update(holds)
    .set({ sessionId: toSessionId })
    .where(and(eq(holds.id, start.holdId), eq(holds.sessionId, fromSessionId)))
    .returning({ id: holds.id });
  if (movedOrder.length !== 1 || movedHold.length !== 1) {
    throw new Error('The booking changed while it was being moved');
  }
  await tx
    .update(sessions)
    .set({ seatsSold: sql`${sessions.seatsSold} - ${seats}` })
    .where(eq(sessions.id, fromSessionId));
  await tx
    .update(sessions)
    .set({ seatsSold: sql`${sessions.seatsSold} + ${seats}` })
    .where(eq(sessions.id, toSessionId));

  await writeAudit(
    tx,
    moveAuditEntry({
      orderId: parsed.orderId,
      fromSessionId,
      toSessionId,
      seats,
    }),
  );
  const moveId = randomUUID();
  await enqueue(tx, {
    kind: 'guest-move-confirmation',
    payload: { orderId: parsed.orderId, moveId },
    dedupeKey: moveEmailKey(moveId),
  });
  return { kind: 'done', value: { result: { status: 'moved' }, plan } };
}

/**
 * Moves the booking a manage token opened onto another date of its experience, as the system: the
 * token is the guest's right, and the only way to hold one here is `resolveManageToken`, so the
 * order and the version it was opened at come from it and not from the caller. Both sessions, the
 * hold, and the order are locked and the move is judged again under them, so a move that lost a
 * race to a cancellation or another move answers its refusal and writes nothing. The order, the
 * hold, both sessions' seats, the audit row, and the email job commit together or not at all.
 */
export async function moveBookingOrder(input: {
  token: ResolvedManageToken;
  targetSessionId: string;
}): Promise<MoveBookingResult> {
  const parsed = MoveOrderInputSchema.parse({
    orderId: input.token.id,
    openedTokenVersion: input.token.version,
    targetSessionId: input.targetSessionId,
  });
  const { result, plan } = await untilLocksCoverOrder(() =>
    db.transaction((tx) => moveInTransaction(tx, parsed, input.token.kind)),
  );
  revalidateTagsForChanges(moveCacheChanges(plan));
  return result;
}
