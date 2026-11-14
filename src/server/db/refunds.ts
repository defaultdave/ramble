import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import { refundEmailDecision, refundEmailKey } from '@/lib/bookingEmails';
import { isSimulatedPayment } from '@/lib/confirmOrder';
import {
  RefundRequestSchema,
  RefundSchema,
  attemptReadLimit,
  processRefundDedupeKey,
  processRefundKind,
  providerRefundIdAction,
  refundCashPostIsFirst,
  refundAttemptId,
  refundEventAction,
  refundEventRoute,
  refundIdFromDigest,
  refundProviderKey,
  refundRequestIdentity,
  refundRequestVerdict,
  refundToSend,
  requireRefundTransition,
  totalsAfterFailure,
  totalsAfterRequest,
  type RefundEventAction,
  type RefundEventFacts,
  type RefundEventType,
  type RefundToSend,
  type RefundRequestInput,
  type RefundRequestRefusal,
} from '@/lib/refunds';
import { refundFailed, refundRequested, refundSucceeded } from '@/lib/ledger';
import { sha256Hex } from '@/server/hash';
import { enqueue } from '@/server/jobs/enqueue';
import type { AuditEntryInput } from '@/lib/audit';
import { writeAudit } from './audit';
import { db, type Transaction } from './client';
import { postEntries } from './ledger';
import { lockOrderById } from './locks';
import { refundableOrderColumns } from './orderColumns';
import { orders, paymentAttempts, refunds } from './schema';
import { readDatabaseTime } from './time';

// Refunds, from the request to the provider's answer (design doc 4.2.3, Refunds). Every decision
// (the split, what an order refuses, what an event does to a refund) is a function in
// `src/lib/refunds.ts`; this file locks, reads, writes, and posts what those functions say. Like the
// ledger writes, it runs as the system and takes no `Caller`: the paths that call it (cancellation,
// session cancellation, the confirm step's refund path, the provider's signed event) have already
// checked their own subject.

type RefundRow = typeof refunds.$inferSelect;

/** The id of the refund a request names: the same order, reason, and key are always the same refund. */
export function refundIdFor(input: RefundRequestInput): string {
  return refundIdFromDigest(
    sha256Hex(refundRequestIdentity(RefundRequestSchema.parse(input))),
  );
}

export type RequestedRefund = {
  refundId: string;
  ticketMinor: number;
  taxMinor: number;
  commissionReturnedMinor: number;
  amountMinor: number;
};

export type RequestRefundResult =
  | { status: 'requested' | 'already_requested'; refund: RequestedRefund }
  | {
      status: 'refused';
      reason: RefundRequestRefusal;
      /** What the order's ticket part still holds, or null when the order was not found. */
      remainingTicketMinor: number | null;
    };

const requestedRefund = (row: RefundRow): RequestedRefund => ({
  refundId: row.id,
  ticketMinor: row.ticketMinor,
  taxMinor: row.taxMinor,
  commissionReturnedMinor: row.commissionReturnedMinor,
  amountMinor: row.amountMinor,
});

const refused = (
  reason: RefundRequestRefusal,
  remainingTicketMinor: number | null = null,
): RequestRefundResult => ({ status: 'refused', reason, remainingTicketMinor });

/**
 * Asks for a refund of an order, in the caller's transaction: the refund row (`pending`), the order's
 * running refund totals, the liability postings (`refundRequested`; no cash moves yet, rule 5), and
 * the job that sends it to the provider all commit with the change that caused them, or not at all.
 * Cancelling a booking, cancelling a session, and the confirm step's refund path call this.
 *
 * Idempotent per `(orderId, reason, key)`: those three values name one refund, so a repeat finds it
 * under the order's lock and answers `already_requested`, writing nothing, even when the order has
 * since changed. A repeat that asks for a different ticket part is refused (`request_changed`).
 *
 * Takes the order's lock itself (lock 4 of the one lock order), and the caller takes the session and
 * hold locks before it when it holds any. The split is computed from the locked row's totals, so two
 * refunds of one order are judged one after the other and together never pass what it holds. A
 * refusal writes nothing and is a typed answer, never a throw; a database or order data that does not
 * add up throws and the caller's transaction rolls back.
 */
export async function requestRefund(
  tx: Transaction,
  input: RefundRequestInput,
): Promise<RequestRefundResult> {
  const request = RefundRequestSchema.parse(input);
  const refundId = refundIdFor(request);

  const locked = await lockOrderById(tx, request.orderId);
  const [existing] = locked
    ? await tx.select().from(refunds).where(eq(refunds.id, refundId))
    : [];
  const [order] = locked
    ? await tx
        .select({
          ...refundableOrderColumns,
          hostId: orders.hostId,
        })
        .from(orders)
        .where(eq(orders.id, request.orderId))
    : [];
  const attempts = locked
    ? await tx
        .select({
          id: paymentAttempts.id,
          status: paymentAttempts.status,
          provider: paymentAttempts.provider,
          providerPaymentId: paymentAttempts.providerPaymentId,
        })
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, request.orderId))
        .orderBy(asc(paymentAttempts.attemptNo))
        .limit(attemptReadLimit)
    : [];

  const verdict = refundRequestVerdict({
    request,
    order: order ?? null,
    existing: existing ?? null,
    attempts,
  });
  if (verdict.kind === 'refused') {
    return refused(verdict.reason, verdict.remainingTicketMinor);
  }
  if (verdict.kind === 'already_requested') {
    if (!existing) throw new Error('The repeated refund disappeared');
    return { status: 'already_requested', refund: requestedRefund(existing) };
  }
  if (!order) throw new Error('The locked order disappeared');
  const { split, attempt } = verdict;

  const at = await readDatabaseTime(tx);
  const [row] = await tx
    .insert(refunds)
    .values({
      id: refundId,
      orderId: request.orderId,
      paymentAttemptId: attempt.id,
      ticketMinor: split.ticketMinor,
      taxMinor: split.taxMinor,
      commissionReturnedMinor: split.commissionReturnedMinor,
      amountMinor: split.amountMinor,
      reason: request.reason,
      initiatedBy: request.initiatedBy,
      providerKey: refundProviderKey(refundId),
      status: 'pending',
    })
    .returning();
  if (!row) throw new Error('The refund was not written');
  await tx
    .update(orders)
    .set(totalsAfterRequest(order, split))
    .where(eq(orders.id, request.orderId));
  await postEntries(
    tx,
    refundRequested({
      occurredAt: at,
      simulated: isSimulatedPayment(attempt.provider),
      orderId: request.orderId,
      hostId: order.hostId,
      refundId,
      paymentAttemptId: attempt.id,
      split: {
        ticketMinor: split.ticketMinor,
        commissionMinor: split.commissionReturnedMinor,
        taxMinor: split.taxMinor,
      },
    }),
  );
  await enqueue(tx, {
    kind: processRefundKind,
    payload: { refundId },
    dedupeKey: processRefundDedupeKey(refundId),
  });
  return { status: 'requested', refund: requestedRefund(row) };
}

/**
 * `requestRefund` and, when it wrote a new refund, the audit row for it, in the caller's transaction:
 * a repeat of a request and a refusal write no audit row.
 */
export async function requestAuditedRefund(
  tx: Transaction,
  input: RefundRequestInput,
  auditEntry: (refundId: string) => AuditEntryInput,
): Promise<RequestRefundResult> {
  const result = await requestRefund(tx, input);
  if (result.status === 'requested') {
    await writeAudit(tx, auditEntry(result.refund.refundId));
  }
  return result;
}

/** Takes the order out of the refund-failed queue; `applyRefundEvent` is the only other writer of the flag. */
export async function clearRefundFailed(
  tx: Transaction,
  orderId: string,
): Promise<void> {
  await tx
    .update(orders)
    .set({ refundFailed: false })
    .where(eq(orders.id, orderId));
}

type RefundSend = Extract<RefundToSend, { kind: 'send' }>;

/**
 * What the refund job sends to the provider, read outside any transaction so the provider call holds
 * no connection. Null when the refund is no longer `pending` (the provider already answered). A
 * refund that does not exist, or whose payment has no provider id, throws: the job fails and retries.
 */
export async function readRefundToSend(
  refundId: string,
): Promise<RefundSend | null> {
  const [row] = await db
    .select({
      refund: refunds,
      providerPaymentId: paymentAttempts.providerPaymentId,
    })
    .from(refunds)
    .leftJoin(paymentAttempts, eq(paymentAttempts.id, refunds.paymentAttemptId))
    .where(eq(refunds.id, refundId));
  if (!row) throw new Error('The refund to send does not exist');
  const toSend = refundToSend(
    RefundSchema.parse(row.refund),
    row.providerPaymentId,
  );
  if (toSend.kind === 'skip') return null;
  if (toSend.kind === 'invalid') {
    throw new Error('The refund has no provider payment to go back to');
  }
  return toSend;
}

/**
 * Keeps the provider's id for a refund the job sent. The refund's row is locked first, so this and the
 * provider's event (which also keeps the id) take turns; an id that differs from the one kept throws.
 */
export async function recordProviderRefundId(
  tx: Transaction,
  refundId: string,
  providerRefundId: string,
): Promise<void> {
  const [row] = await tx
    .select({ providerRefundId: refunds.providerRefundId })
    .from(refunds)
    .where(eq(refunds.id, refundId))
    .for('update');
  if (!row) throw new Error('The refund does not exist');
  const action = providerRefundIdAction(row.providerRefundId, providerRefundId);
  if (action === 'keep') return;
  if (action === 'conflict') {
    throw new Error('The refund already has a different provider id');
  }
  await tx
    .update(refunds)
    .set({ providerRefundId })
    .where(eq(refunds.id, refundId));
}

type RefundEventRow = {
  type: RefundEventType;
  objectId: string;
  amountMinor: number | null;
  rambleOrderId: string | null;
  rambleRecordId: string | null;
};

/**
 * Applies a provider's refund event, inside the event job's transaction and after the order's events
 * lock. Takes the order lock, then the refund's, and decides from the rows read after both. On
 * `refund.succeeded` the refund is `succeeded` and the cash leaves `platform_cash` under the provider's
 * refund id (rule 5). On `refund.failed` the refund is `failed`, the pending postings are reversed,
 * the order's refund totals give the parts back, and `orders.refund_failed` is set for ops. Returns the
 * action `refundEventAction` chose; `unmatched` and `conflict` write nothing.
 */
export async function applyRefundEvent(
  tx: Transaction,
  event: RefundEventRow,
): Promise<RefundEventAction> {
  const { rambleOrderId: orderId, rambleRecordId: refundId } = event;
  const orderRow =
    orderId === null ? undefined : await lockOrderById(tx, orderId);
  const [locked] =
    orderRow && refundId !== null
      ? await tx
          .select()
          .from(refunds)
          .where(eq(refunds.id, refundId))
          .for('update')
      : [];
  const refund = locked ? RefundSchema.parse(locked) : null;

  const facts: RefundEventFacts = {
    type: event.type,
    objectId: event.objectId,
    amountMinor: event.amountMinor,
    orderId,
    recordId: refundId,
  };
  const action = refundEventAction(facts, refund);
  if (refundEventRoute(action) !== 'write') return action;
  if (!refund || orderId === null) {
    throw new Error('A refund event to write names no refund');
  }

  const [order] = await tx
    .select({
      ...refundableOrderColumns,
      hostId: orders.hostId,
    })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!order) throw new Error('The locked order disappeared');
  const paymentAttemptId = refundAttemptId(refund);
  const [attempt] = await tx
    .select({ provider: paymentAttempts.provider })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.id, paymentAttemptId));
  if (!attempt)
    throw new Error('The refund names a payment attempt that is gone');
  const simulated = isSimulatedPayment(attempt.provider);
  const at = await readDatabaseTime(tx);

  if (action.kind === 'succeed') {
    requireRefundTransition(refund.status, 'succeeded');
    await tx
      .update(refunds)
      .set({
        status: 'succeeded',
        providerRefundId: event.objectId,
        // Not `at`: that is whole milliseconds, which can read earlier than the refund's microsecond `created_at`.
        succeededAt: sql`clock_timestamp()`,
      })
      .where(eq(refunds.id, refund.id));
    const posted = await postEntries(
      tx,
      refundSucceeded({
        occurredAt: at,
        simulated,
        orderId,
        hostId: order.hostId,
        refundId: refund.id,
        paymentAttemptId,
        providerObjectId: event.objectId,
        amountMinor: refund.amountMinor,
      }),
    );
    if (!refundCashPostIsFirst(posted.status)) {
      throw new Error('The refund cash was posted before the refund succeeded');
    }
    if (
      refundEmailDecision({ status: 'succeeded', reason: refund.reason }) ===
      'send'
    ) {
      await enqueue(tx, {
        kind: 'guest-refund',
        payload: { refundId: refund.id },
        dedupeKey: refundEmailKey(refund.id),
      });
    }
    return action;
  }

  requireRefundTransition(refund.status, 'failed');
  await tx
    .update(refunds)
    .set({ status: 'failed', providerRefundId: event.objectId })
    .where(eq(refunds.id, refund.id));
  await tx
    .update(orders)
    .set({ ...totalsAfterFailure(order, refund), refundFailed: true })
    .where(eq(orders.id, orderId));
  await postEntries(
    tx,
    refundFailed({
      occurredAt: at,
      simulated,
      orderId,
      hostId: order.hostId,
      refundId: refund.id,
      paymentAttemptId,
      split: {
        ticketMinor: refund.ticketMinor,
        commissionMinor: refund.commissionReturnedMinor,
        taxMinor: refund.taxMinor,
      },
    }),
  );
  return action;
}
