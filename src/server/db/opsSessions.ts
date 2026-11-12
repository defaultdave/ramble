import 'server-only';
import { and, asc, eq, gt, ilike, inArray, lte, or } from 'drizzle-orm';
import {
  fanOutHoldStatuses,
  fanOutLimit,
  fanOutOrderStatuses,
  requireWithinFanOut,
} from '@/lib/cancelSession';
import { WriteIdSchema } from '@/lib/catalog';
import { requireAtMost } from '@/lib/holds';
import {
  buildOpsSessionRows,
  buildOpsSessionView,
  cancelBlocked,
  cancelGate,
  impactIsCurrent,
  impactOrders,
  impactView,
  openHeldSeatsBySession,
  opsSessionsPageSize,
  sessionImpact,
  sessionListDirection,
  type Impact,
  type ImpactView,
  type OpsCancelInput,
  type OpsCancelOutcome,
  type OpsSessionRow,
  type OpsSessionView,
  type SessionWhen,
} from '@/lib/opsSessions';
import { containsPattern } from '@/lib/pages/help';
import { splitPage } from '@/lib/pagination';
import { attemptReadLimit } from '@/lib/refunds';
import { sessionsListEntry, sessionViewedEntry } from '@/lib/sessionAudit';
import type { Caller } from '@/server/auth/caller';
import { cancelSession } from './cancelSession';
import { recordAudit, requireOpsUserId } from './audit';
import { db, dbRead } from './client';
import { byColumnThenId, pastKeysetCursor } from './keysetPage';
import { refundableOrderColumns } from './orderColumns';
import {
  experiences,
  holds,
  hosts,
  orders,
  paymentAttempts,
  sessions,
} from './schema';
import { currentDatabaseTime } from './time';

// For the ops role alone: each function checks it before it reads or writes. Every read records its
// audit row. Cancelling is `cancelSession`, which writes its audit rows in the transaction that
// cancels, naming the ops user.

type Executor = Pick<typeof db, 'select'>;

/** The holds a cancellation would release, for the sessions given. */
async function readReleasableHolds(executor: Executor, sessionIds: string[]) {
  if (sessionIds.length === 0) return [];
  return requireWithinFanOut(
    await executor
      .select({
        sessionId: holds.sessionId,
        status: holds.status,
        seats: holds.seats,
        expiresAt: holds.expiresAt,
        payingUntil: holds.payingUntil,
      })
      .from(holds)
      .where(
        and(
          inArray(holds.sessionId, sessionIds),
          inArray(holds.status, fanOutHoldStatuses),
        ),
      )
      .limit(fanOutLimit + 1),
    'releasable holds',
  );
}

/** What cancelling the sessions given would do to their orders and holds, read as it stands now. */
async function readImpact(
  executor: Executor,
  sessionIds: string[],
  at: Date,
): Promise<Impact> {
  const orderRows = requireWithinFanOut(
    await executor
      .select({
        id: orders.id,
        reference: orders.reference,
        ...refundableOrderColumns,
      })
      .from(orders)
      .where(
        and(
          inArray(orders.sessionId, sessionIds),
          inArray(orders.status, fanOutOrderStatuses),
        ),
      )
      .orderBy(asc(orders.reference))
      .limit(fanOutLimit + 1),
    'orders',
  );
  const attempts =
    orderRows.length === 0
      ? []
      : requireAtMost(
          await executor
            .select({
              orderId: paymentAttempts.orderId,
              status: paymentAttempts.status,
              providerPaymentId: paymentAttempts.providerPaymentId,
            })
            .from(paymentAttempts)
            .where(
              inArray(
                paymentAttempts.orderId,
                orderRows.map((order) => order.id),
              ),
            )
            .limit(fanOutLimit * attemptReadLimit + 1),
          fanOutLimit * attemptReadLimit,
          'payment attempts',
        );
  return sessionImpact(
    impactOrders(orderRows, attempts),
    await readReleasableHolds(executor, sessionIds),
    at,
  );
}

export type OpsSessionsPage = {
  rows: OpsSessionRow[];
  nextCursor: string | null;
};

/** One page of sessions, upcoming soonest first and the rest latest first, optionally those whose experience or host name contains the term. */
export async function readOpsSessions(
  caller: Caller,
  options: { when: SessionWhen | null; term: string; cursor: string | null },
): Promise<OpsSessionsPage> {
  const userId = requireOpsUserId(caller);
  const cursor =
    options.cursor === null ? null : WriteIdSchema.parse(options.cursor);
  const at = await currentDatabaseTime();
  const direction = sessionListDirection(options.when);
  const pattern = containsPattern(options.term);
  const fetched = await dbRead
    .select({
      id: sessions.id,
      experienceName: experiences.name,
      hostName: hosts.name,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      status: sessions.status,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(
      and(
        options.when === 'upcoming' ? gt(sessions.startsAt, at) : undefined,
        options.when === 'past' ? lte(sessions.startsAt, at) : undefined,
        options.term === ''
          ? undefined
          : or(ilike(experiences.name, pattern), ilike(hosts.name, pattern)),
        pastKeysetCursor(sessions, sessions.startsAt, direction, cursor),
      ),
    )
    .orderBy(...byColumnThenId(sessions, sessions.startsAt, direction))
    .limit(opsSessionsPageSize + 1);
  const { items, nextCursor } = splitPage(fetched, opsSessionsPageSize);
  const held = openHeldSeatsBySession(
    await readReleasableHolds(
      dbRead,
      items.map((item) => item.id),
    ),
    at,
  );
  await recordAudit(sessionsListEntry(userId));
  return {
    rows: buildOpsSessionRows(
      items.map((item) => ({ ...item, heldSeats: held.get(item.id) ?? 0 })),
    ),
    nextCursor,
  };
}

export type OpsSessionDetail = {
  session: OpsSessionView;
  impact: ImpactView;
};

/** One session with the guest impact of cancelling it, or null when there is none. */
export async function readOpsSession(
  caller: Caller,
  sessionId: string,
): Promise<OpsSessionDetail | null> {
  const userId = requireOpsUserId(caller);
  const id = WriteIdSchema.safeParse(sessionId);
  if (!id.success) return null;
  const at = await currentDatabaseTime();
  const [row] = await db
    .select({
      id: sessions.id,
      experienceId: sessions.experienceId,
      experienceName: experiences.name,
      hostName: hosts.name,
      startsAt: sessions.startsAt,
      timeZone: sessions.timeZone,
      allocation: sessions.allocation,
      seatsSold: sessions.seatsSold,
      status: sessions.status,
    })
    .from(sessions)
    .innerJoin(experiences, eq(experiences.id, sessions.experienceId))
    .innerJoin(hosts, eq(hosts.id, experiences.hostId))
    .where(eq(sessions.id, id.data));
  if (!row) return null;

  const impact = await readImpact(db, [row.id], at);
  await recordAudit(sessionViewedEntry(userId, row.id));
  return {
    session: buildOpsSessionView(
      { ...row, heldSeats: impact.heldSeats },
      at,
      impact,
    ),
    impact: impactView(impact),
  };
}

/**
 * Cancels a session for ops. Refused before anything is written when the session has started, when
 * a booking cannot be refunded in full (`cancelSession` would roll the whole cancellation back on
 * it), or when the impact now is not the impact the person read. The impact is read just before
 * `cancelSession` opens its own transaction, so a booking that confirms in between is cancelled and
 * refunded with the rest, as the cancellation always does.
 */
export async function cancelSessionAsOps(
  caller: Caller,
  input: OpsCancelInput,
): Promise<OpsCancelOutcome> {
  requireOpsUserId(caller);
  const sessionId = WriteIdSchema.parse(input.sessionId);
  const at = await currentDatabaseTime();
  const [session] = await db
    .select({ startsAt: sessions.startsAt })
    .from(sessions)
    .where(eq(sessions.id, sessionId));
  if (!session) return { kind: 'done', result: { status: 'not_found' } };
  if (cancelGate(session, at) === 'ended') return { kind: 'ended' };
  const impact = await readImpact(db, [sessionId], at);
  if (cancelBlocked(impact)) return { kind: 'blocked' };
  if (!impactIsCurrent(input.fingerprint, impact)) return { kind: 'stale' };
  return {
    kind: 'done',
    result: await cancelSession(caller, { sessionId, reason: input.reason }),
  };
}
