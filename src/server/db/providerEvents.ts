import 'server-only';
import { asc, eq, sql } from 'drizzle-orm';
import type { OrderStatus } from '@/lib/orders';
import {
  paymentLimits,
  ProviderEventSchema,
  type AttemptStatus,
} from '@/lib/payments';
import {
  extendedPayingUntil,
  isDeferredEventType,
  matchEventAttempt,
  orderEventsLockKey,
  payloadFacts,
  processEventDedupeKey,
  processProviderEventKind,
  providerEventAction,
  requireAttemptTransition,
  requireOrderTransition,
  unmatchedOutcome,
  type EventFacts,
  type EventOrder,
  type FailedTryAction,
  type ProviderEventRow,
} from '@/lib/providerEvents';
import { enqueue } from '@/server/jobs/enqueue';
import { db, type Transaction } from './client';
import type { ConfirmOrder } from './confirmOrder';
import { lockFor, lockHoldRow, lockOrderRow, lockSessionRow } from './locks';
import {
  holds,
  orders,
  paymentAttempts,
  providerEvents,
  settings,
} from './schema';
import { readDatabaseTime } from './time';

// The webhook's side of design doc 4.2.3. The route holds no `Caller`: the provider's signature
// is the capability, checked before anything here runs (architecture rule B6, by design). Writes
// here take their times from `clock_timestamp()`, so a row never reads as older than the row it
// follows.

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

type StoredEvent = NonNullable<Awaited<ReturnType<typeof readProviderEvent>>>;

export type EventMetadata = { orderId: string; recordId: string };

export type EventProcessing =
  | { status: 'processed' }
  | { status: 'already_processed' }
  /** Left unprocessed for the unit that owns it; the job is done. */
  | {
      status: 'left';
      reason: 'deferred_type' | 'confirm_unavailable' | 'duplicate_payment';
      orderId: string | null;
    }
  | {
      status: 'unmatched';
      tries: number;
      alert: 'unmatched' | 'gave_up' | null;
    };

type ProcessInput = {
  eventId: string;
  /** Asks the provider for the payment's Ramble ids when the event carried none (rule 7). */
  lookupMetadata: (event: StoredEvent) => Promise<EventMetadata | null>;
  confirmOrder: ConfirmOrder;
};

const markProcessed = (tx: Transaction, eventId: string) =>
  tx
    .update(providerEvents)
    .set({ processedAt: sql`clock_timestamp()` })
    .where(eq(providerEvents.id, eventId));

/** One more failed match: counted, and the next try queued after a backoff. */
async function recordUnmatched(
  tx: Transaction,
  event: StoredEvent,
): Promise<EventProcessing> {
  const tries = event.attempts + 1;
  await tx
    .update(providerEvents)
    .set({ attempts: tries, lastError: 'No matching payment attempt' })
    .where(eq(providerEvents.id, event.id));
  const outcome = unmatchedOutcome(tries, event.id);
  if (outcome.retryAfterSeconds !== null) {
    const now = await readDatabaseTime(tx);
    await enqueue(tx, {
      kind: processProviderEventKind,
      payload: { eventId: event.id },
      dedupeKey: processEventDedupeKey(event.id, tries),
      runAfter: new Date(now.getTime() + outcome.retryAfterSeconds * 1000),
    });
  }
  return { status: 'unmatched', tries, alert: outcome.alert };
}

/** The hold's grace for a challenge; the settings row is configuration, read with a plain SELECT. */
async function readPaymentGraceMinutes(tx: Transaction): Promise<number> {
  const [row] = await tx
    .select({ minutes: settings.paymentGraceMinutes })
    .from(settings)
    .where(eq(settings.id, true));
  if (!row) throw new Error('The settings row is missing');
  return row.minutes;
}

async function readAttempts(tx: Transaction, orderId: string) {
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

function attemptOf<T extends { id: string }>(attempts: T[], id: string): T {
  const attempt = attempts.find((candidate) => candidate.id === id);
  if (!attempt) throw new Error('The matched attempt is missing');
  return attempt;
}

function eventFacts(event: StoredEvent): EventFacts {
  const { method, failureCode } = payloadFacts(event.payload);
  return {
    type: event.type,
    objectId: event.objectId,
    rambleRecordId: event.rambleRecordId,
    method,
    failureCode,
  };
}

async function failedTry(
  tx: Transaction,
  action: FailedTryAction,
  context: {
    attempt: { status: AttemptStatus };
    order: { id: string; status: OrderStatus };
    holdId: string | null;
    providerPaymentId: string;
  },
) {
  requireAttemptTransition(context.attempt.status, action.attemptStatus);
  await tx
    .update(paymentAttempts)
    .set({
      status: action.attemptStatus,
      failedTries: action.failedTries,
      failureCode: action.failureCode,
      providerPaymentId: context.providerPaymentId,
      updatedAt: sql`clock_timestamp()`,
    })
    .where(eq(paymentAttempts.id, action.attemptId));
  if (action.orderStatus !== null) {
    requireOrderTransition(context.order.status, action.orderStatus);
    await tx
      .update(orders)
      .set({ status: action.orderStatus })
      .where(eq(orders.id, context.order.id));
  }
  if (action.reopenHold && context.holdId !== null) {
    await tx
      .update(holds)
      .set({
        status: 'active',
        payingUntil: null,
        updatedAt: sql`clock_timestamp()`,
      })
      .where(eq(holds.id, context.holdId));
  }
}

/**
 * Handles one stored event, inside the job's transaction. The order's events lock comes first
 * (rule 8), then the session, hold, and order locks in their one order (rule 1), and everything the
 * decision rests on is read after them. Time for the decision is read after the locks too (rule 2).
 */
export async function processProviderEvent(
  tx: Transaction,
  input: ProcessInput,
): Promise<EventProcessing> {
  const first = await readProviderEvent(tx, input.eventId);
  if (!first) throw new Error('The provider event does not exist');
  if (first.processedAt !== null) return { status: 'already_processed' };
  if (isDeferredEventType(first.type)) {
    return {
      status: 'left',
      reason: 'deferred_type',
      orderId: first.rambleOrderId,
    };
  }

  let { rambleOrderId: orderId, rambleRecordId: recordId } = first;
  if (orderId === null) {
    const found = await input.lookupMetadata(first);
    if (found) {
      orderId = found.orderId.toLowerCase();
      recordId = found.recordId.toLowerCase();
      await tx
        .update(providerEvents)
        .set({ rambleOrderId: orderId, rambleRecordId: recordId })
        .where(eq(providerEvents.id, first.id));
    }
  }
  if (orderId === null) return recordUnmatched(tx, first);

  await lockFor(tx, orderEventsLockKey(orderId));
  const event = await readProviderEvent(tx, input.eventId);
  if (!event) throw new Error('The provider event does not exist');
  if (event.processedAt !== null) return { status: 'already_processed' };

  const [unlocked] = await tx
    .select({ holdId: orders.holdId, sessionId: orders.sessionId })
    .from(orders)
    .where(eq(orders.id, orderId));
  if (!unlocked) return recordUnmatched(tx, event);
  if (unlocked.sessionId !== null) await lockSessionRow(tx, unlocked.sessionId);
  const hold =
    unlocked.holdId === null
      ? undefined
      : await lockHoldRow(tx, unlocked.holdId);
  const order = await lockOrderRow(tx, orderId);
  if (!order) return recordUnmatched(tx, event);

  const now = await readDatabaseTime(tx);
  const attempts = await readAttempts(tx, orderId);
  const facts = eventFacts({ ...event, rambleRecordId: recordId });
  const match = matchEventAttempt(facts, attempts);
  const eventOrder: EventOrder = {
    status: order.status,
    hold: hold ? { status: hold.status, expiresAt: hold.expiresAt } : null,
  };
  const action = providerEventAction(facts, match, eventOrder, now);

  switch (action.kind) {
    case 'wait':
      return { status: 'left', reason: 'deferred_type', orderId };
    case 'unmatched':
      return recordUnmatched(tx, event);
    case 'duplicate_payment':
      return { status: 'left', reason: 'duplicate_payment', orderId };
    case 'noop':
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    case 'confirm': {
      const attempt = attemptOf(attempts, action.attemptId);
      if (action.markSucceeded) {
        requireAttemptTransition(attempt.status, 'succeeded');
        await tx
          .update(paymentAttempts)
          .set({
            status: 'succeeded',
            method: action.method ?? attempt.method,
            providerPaymentId: event.objectId,
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(paymentAttempts.id, attempt.id));
      }
      const { feeMinor } = payloadFacts(event.payload);
      const result = await input.confirmOrder(tx, {
        orderId,
        attemptId: attempt.id,
        providerEventId: event.id,
        providerPaymentId: event.objectId,
        amountMinor: event.amountMinor,
        currency: event.currency,
        feeMinor,
        now,
      });
      if (result.status === 'unavailable') {
        return { status: 'left', reason: 'confirm_unavailable', orderId };
      }
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
    case 'payment_failed': {
      const attempt = attemptOf(attempts, action.attemptId);
      await failedTry(tx, action, {
        attempt,
        order,
        holdId: unlocked.holdId,
        providerPaymentId: event.objectId,
      });
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
    case 'requires_action': {
      const attempt = attemptOf(attempts, action.attemptId);
      requireAttemptTransition(attempt.status, 'requires_action');
      await tx
        .update(paymentAttempts)
        .set({
          status: 'requires_action',
          providerPaymentId: event.objectId,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(paymentAttempts.id, attempt.id));
      if (action.extendPaying && hold) {
        const grace = await readPaymentGraceMinutes(tx);
        await tx
          .update(holds)
          .set({
            payingUntil: extendedPayingUntil(hold.payingUntil, now, grace),
            updatedAt: sql`clock_timestamp()`,
          })
          .where(eq(holds.id, hold.id));
      }
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
    case 'cancel_attempt': {
      const attempt = attemptOf(attempts, action.attemptId);
      requireAttemptTransition(attempt.status, 'canceled');
      await tx
        .update(paymentAttempts)
        .set({
          status: 'canceled',
          providerPaymentId: event.objectId,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(paymentAttempts.id, attempt.id));
      await markProcessed(tx, event.id);
      return { status: 'processed' };
    }
  }
}
