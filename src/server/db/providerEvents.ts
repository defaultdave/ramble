import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import {
  paymentLimits,
  ProviderEventSchema,
  type AttemptStatus,
} from '@/lib/payments';
import {
  afterConfirm,
  extendedPayingUntil,
  isPaymentEventType,
  matchEventAttempt,
  needsMetadataLookup,
  payloadFacts,
  processEventDedupeKey,
  processProviderEventKind,
  providerEventAction,
  requireAttemptTransition,
  requireOrderTransition,
  eventIds,
  eventRetry,
  type EventFacts,
  type EventMetadata,
  type EventOrder,
  type FailedTryAction,
  type PaymentEventType,
  type ProviderEventResult,
  type ProviderEventRow,
  type RetryReason,
} from '@/lib/providerEvents';
import { enqueue } from '@/server/jobs/enqueue';
import { db, type Transaction } from './client';
import type { ConfirmOrder } from './confirmOrder';
import {
  lockHoldRow,
  lockOrderEvents,
  lockOrderById,
  lockSessionRow,
} from './locks';
import { holds, orders, paymentAttempts, providerEvents } from './schema';
import { readHoldSettings } from './settings';
import { readDatabaseTime } from './time';

// The webhook's side of design doc 4.2.3. The route holds no `Caller`: the provider's signature
// is the capability, checked before anything here runs (architecture rule B6, by design). Writes
// here take their times from `clock_timestamp()`, so a row never reads as older than the row it
// follows. Every decision is a function in `src/lib/providerEvents.ts`; this file locks, reads,
// and writes what those functions say.

/**
 * Stores a verified event once and queues its processing, in one transaction. A repeat delivery
 * finds the row and writes nothing, so it enqueues nothing either.
 */
export async function recordProviderEvent(
  row: ProviderEventRow,
): Promise<'stored' | 'repeat'> {
  return db.transaction(async (tx) => {
    const [inserted] = await tx
      .insert(providerEvents)
      .values(row)
      .onConflictDoNothing({
        target: [providerEvents.provider, providerEvents.providerEventId],
      })
      .returning({ id: providerEvents.id });
    if (!inserted) return 'repeat';
    await enqueue(tx, {
      kind: processProviderEventKind,
      payload: { eventId: inserted.id },
      dedupeKey: processEventDedupeKey(inserted.id, 0),
    });
    return 'stored';
  });
}

async function readProviderEvent(tx: Transaction, eventId: string) {
  const [row] = await tx
    .select()
    .from(providerEvents)
    .where(eq(providerEvents.id, eventId));
  return row && ProviderEventSchema.parse(row);
}

/**
 * The event a job is about to handle, when its Ramble ids must be asked of the provider first. Read
 * outside any transaction, so the provider call that follows holds no connection.
 */
export async function readEventToLookUp(
  eventId: string,
): Promise<{ provider: string; objectId: string } | null> {
  const [row] = await db
    .select({
      provider: providerEvents.provider,
      objectId: providerEvents.objectId,
      type: providerEvents.type,
      rambleOrderId: providerEvents.rambleOrderId,
      processedAt: providerEvents.processedAt,
    })
    .from(providerEvents)
    .where(eq(providerEvents.id, eventId));
  return row && needsMetadataLookup(row)
    ? { provider: row.provider, objectId: row.objectId }
    : null;
}

type ProcessInput = {
  eventId: string;
  /** The Ramble ids the provider reported for an event that carried none (rule 7), looked up before the transaction. */
  metadata: EventMetadata | null;
  confirmOrder: ConfirmOrder;
};

const markProcessed = (tx: Transaction, eventId: string) =>
  tx
    .update(providerEvents)
    .set({ processedAt: sql`clock_timestamp()` })
    .where(eq(providerEvents.id, eventId));

/** One more try that did not finish the event: counted, and the next job queued after a backoff. */
async function recordRetry(
  tx: Transaction,
  event: { id: string; attempts: number },
  reason: RetryReason,
): Promise<ProviderEventResult> {
  const now = await readDatabaseTime(tx);
  const retry = eventRetry(reason, event.attempts, event.id, now);
  await tx
    .update(providerEvents)
    .set({ attempts: retry.tries, lastError: retry.lastError })
    .where(eq(providerEvents.id, event.id));
  if (retry.runAfter !== null) {
    await enqueue(tx, {
      kind: processProviderEventKind,
      payload: { eventId: event.id },
      dedupeKey: processEventDedupeKey(event.id, retry.tries),
      runAfter: retry.runAfter,
    });
  }
  return { status: 'retry', reason, tries: retry.tries, alert: retry.alert };
}

function readAttempts(tx: Transaction, orderId: string) {
  return tx
    .select({
      id: paymentAttempts.id,
      status: paymentAttempts.status,
      failedTries: paymentAttempts.failedTries,
      providerPaymentId: paymentAttempts.providerPaymentId,
      method: paymentAttempts.method,
    })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(asc(paymentAttempts.attemptNo))
    .limit(paymentLimits.maxAttemptNo + 1);
}

function eventFacts(
  payload: Record<string, unknown>,
  event: { objectId: string },
  type: PaymentEventType,
  recordId: string | null,
): EventFacts {
  const { method, failureCode } = payloadFacts(payload);
  return {
    type,
    objectId: event.objectId,
    rambleRecordId: recordId,
    method,
    failureCode,
  };
}

/**
 * Takes the session, hold, and order locks in their one order, after the events lock, and returns
 * what the decision needs. Null when the order does not exist. The ids are read first without a lock.
 */
async function lockOrderRows(
  tx: Transaction,
  orderId: string,
): Promise<EventOrder | null> {
  const [unlocked] = await tx
    .select({ holdId: orders.holdId, sessionId: orders.sessionId })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!unlocked) return null;
  if (unlocked.sessionId !== null) await lockSessionRow(tx, unlocked.sessionId);
  const hold =
    unlocked.holdId === null
      ? undefined
      : await lockHoldRow(tx, unlocked.holdId);
  const order = await lockOrderById(tx, orderId);
  if (!order) return null;
  return {
    id: order.id,
    status: order.status,
    hold: hold
      ? {
          id: hold.id,
          status: hold.status,
          expiresAt: hold.expiresAt,
          payingUntil: hold.payingUntil,
        }
      : null,
  };
}

const setAttempt = (
  tx: Transaction,
  attemptId: string,
  from: AttemptStatus,
  to: AttemptStatus,
  values: Partial<typeof paymentAttempts.$inferInsert>,
) => {
  requireAttemptTransition(from, to);
  return tx
    .update(paymentAttempts)
    .set({ ...values, status: to, updatedAt: sql`clock_timestamp()` })
    .where(eq(paymentAttempts.id, attemptId));
};

async function applyFailedTry(
  tx: Transaction,
  action: FailedTryAction,
  providerPaymentId: string,
) {
  await setAttempt(
    tx,
    action.attemptId,
    action.attemptFrom,
    action.attemptStatus,
    {
      failedTries: action.failedTries,
      failureCode: action.failureCode,
      providerPaymentId,
    },
  );
  if (action.orderMove) {
    requireOrderTransition(action.orderMove.from, action.orderMove.to);
    await tx
      .update(orders)
      .set({ status: action.orderMove.to })
      .where(eq(orders.id, action.orderMove.id));
  }
  if (action.reopenHoldId) {
    await tx
      .update(holds)
      .set({
        status: 'active',
        payingUntil: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(holds.id, action.reopenHoldId));
  }
}

/**
 * Handles one stored event, inside the job's transaction. The order's events lock comes first
 * (rule 8), then the session, hold, and order locks in their one order (rule 1), and everything the
 * decision rests on is read after them, the event row included. Time for the decision is read after
 * the locks too (rule 2).
 */
export async function processProviderEvent(
  tx: Transaction,
  input: ProcessInput,
): Promise<ProviderEventResult> {
  const first = await readProviderEvent(tx, input.eventId);
  if (!first) throw new Error('The provider event does not exist');
  if (first.processedAt !== null) return { status: 'already_processed' };
  const type = first.type;
  if (!isPaymentEventType(type)) {
    return {
      status: 'left',
      reason: 'deferred_type',
      orderId: first.rambleOrderId,
    };
  }

  const ids = eventIds(first, input.metadata);
  if (ids.adopted) {
    await tx
      .update(providerEvents)
      .set({ rambleOrderId: ids.orderId, rambleRecordId: ids.recordId })
      .where(eq(providerEvents.id, first.id));
  }

  let event = first;
  let order: EventOrder | null = null;
  if (ids.orderId !== null) {
    await lockOrderEvents(tx, ids.orderId);
    const reread = await readProviderEvent(tx, input.eventId);
    if (!reread) throw new Error('The provider event does not exist');
    if (reread.processedAt !== null) return { status: 'already_processed' };
    event = reread;
    order = await lockOrderRows(tx, ids.orderId);
  }

  const now = await readDatabaseTime(tx);
  const attempts = order === null ? [] : await readAttempts(tx, order.id);
  const facts = eventFacts(event.payload, event, type, ids.recordId);
  const action = providerEventAction(
    facts,
    matchEventAttempt(facts, attempts),
    order,
    now,
  );

  switch (action.kind) {
    case 'unmatched':
      return recordRetry(tx, event, 'unmatched');
    case 'duplicate_payment':
      return {
        status: 'left',
        reason: 'duplicate_payment',
        orderId: ids.orderId,
      };
    case 'noop':
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    case 'confirm': {
      if (action.markSucceeded) {
        await setAttempt(
          tx,
          action.attemptId,
          action.attemptFrom,
          'succeeded',
          {
            method: action.method,
            providerPaymentId: event.objectId,
          },
        );
      }
      const result = await input.confirmOrder(tx, {
        orderId: action.orderId,
        attemptId: action.attemptId,
        providerEventId: event.id,
        providerPaymentId: event.objectId,
        amountMinor: event.amountMinor,
        currency: event.currency,
        feeMinor: payloadFacts(event.payload).feeMinor,
        now,
      });
      if (afterConfirm(result.status) === 'retry') {
        return recordRetry(tx, event, 'confirm_unavailable');
      }
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
    case 'payment_failed':
      await applyFailedTry(tx, action, event.objectId);
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    case 'requires_action': {
      await setAttempt(
        tx,
        action.attemptId,
        action.attemptFrom,
        'requires_action',
        {
          providerPaymentId: event.objectId,
        },
      );
      if (action.extendHold) {
        const { paymentGraceMinutes: grace } = await readHoldSettings(tx);
        await tx
          .update(holds)
          .set({
            payingUntil: extendedPayingUntil(
              action.extendHold.payingUntil,
              now,
              grace,
            ),
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(holds.id, action.extendHold.id));
      }
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
    case 'cancel_attempt':
      await setAttempt(tx, action.attemptId, action.attemptFrom, 'canceled', {
        providerPaymentId: event.objectId,
      });
      await markProcessed(tx, event.id);
      return { status: 'processed' };
  }
}
