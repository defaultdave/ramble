import 'server-only';
import { randomInt } from 'node:crypto';
import { desc, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { WriteIdSchema } from '@/lib/catalog';
import {
  StartPaymentInputSchema,
  acceptedDocumentIds,
  alreadyConfirmedResult,
  amountDueNow,
  childCount,
  inputIssues,
  invalidStartPayment,
  lapsedOutcome,
  newOrderReference,
  newsletterConsent,
  orderFields,
  orderItemRows,
  orderSnapshot,
  orderTokenFor,
  priceHold,
  referenceTries,
  startPaymentDecision,
  statusOnRetry,
  storeProviderPayment,
  unknownHold,
  type HeldItem,
  type StartDecision,
  type StartPaymentInput,
  type StartPaymentResult,
} from '@/lib/checkout';
import { isHoldOfDevice, payingHold, remainingSpaces } from '@/lib/holds';
import {
  OrderItemSchema,
  OrderSchema,
  bookingIdempotencyKey,
} from '@/lib/orders';
import {
  PaymentAttemptSchema,
  ProviderIdSchema,
  attemptProviderKey,
  type PaymentProvider,
} from '@/lib/payments';
import { MAX_LINES } from '@/lib/pricing';
import type { Device } from '@/server/device';
import { minAmountMinor, maxAmountMinor } from '@/server/ports/payments';
import { capabilityToken } from '@/server/tokens';
import { db, type Transaction } from './client';
import { findOrCreateGuest, recordConsent } from './guests';
import { readAlternatives, readOpenHeldSeats } from './holds';
import {
  getCurrentLegalDocument,
  getPublishedLegalDocument,
  recordOrderAcceptances,
} from './legal';
import {
  lockAttemptRow,
  lockHoldRow,
  lockOrderRow,
  lockSessionRow,
} from './locks';
import {
  cancellationTiers,
  holdItems,
  holds,
  orderItems,
  orders,
  paymentAttempts,
  priceOptions,
} from './schema';
import { readHoldSettings } from './settings';
import { readDatabaseTime } from './time';

/**
 * What the first transaction leaves for the provider step: the order, its token for the device
 * that holds it, and the attempt to ask the provider about. `existed` is false only for an attempt
 * this call made, which the provider cannot have heard of.
 */
export type StartedPayment =
  | { done: true; result: StartPaymentResult }
  | {
      done: false;
      order: { id: string; reference: string; amountDueMinor: number };
      orderToken: string | undefined;
      attempt: {
        id: string;
        providerKey: string;
        amountMinor: number;
        providerPaymentId: string | null;
        existed: boolean;
      };
    };

type Outcome =
  | StartedPayment
  | {
      soldOut: { experienceId: string; sessionId: string; seats: number };
    };

type PublishedLegal = Awaited<ReturnType<typeof readPublishedLegal>>;

/** The terms version a guest may accept now, and the waiver version they named, as published. */
async function readPublishedLegal(request: {
  waiverDocumentId?: string | undefined;
}) {
  const [terms, waiver] = await Promise.all([
    getCurrentLegalDocument('terms'),
    request.waiverDocumentId === undefined
      ? null
      : getPublishedLegalDocument(request.waiverDocumentId),
  ]);
  return { terms, waiver };
}

async function readHeldItems(
  tx: Transaction,
  holdId: string,
): Promise<HeldItem[]> {
  return tx
    .select({
      priceOptionId: holdItems.priceOptionId,
      kind: priceOptions.kind,
      quantity: holdItems.quantity,
      unitPriceMinor: holdItems.unitPriceMinor,
      usesSpace: holdItems.usesSpace,
    })
    .from(holdItems)
    .innerJoin(priceOptions, eq(priceOptions.id, holdItems.priceOptionId))
    .where(eq(holdItems.holdId, holdId))
    .limit(MAX_LINES + 1);
}

async function readLatestAttempt(tx: Transaction, orderId: string) {
  const [row] = await tx
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(desc(paymentAttempts.attemptNo))
    .limit(1);
  return row ? PaymentAttemptSchema.parse(row) : null;
}

/**
 * `startPayment`, first transaction (design doc 4.2.3, Orders). The form is parsed, then the hold's
 * session id is read with no lock, then the session, the hold, and the order are locked in that
 * order and everything is judged again under them, at database time. A refusal returns before any
 * write. `sold_out` leaves the transaction because other dates are looked up after the lock is gone.
 * The provider is not called here (rule 6); the caller does that with what this returns, then
 * `recordProviderPayment`.
 * TODO(U-086): the checkout start event, in this transaction.
 */
export async function startPaymentTx(
  device: Device,
  input: StartPaymentInput,
  provider: PaymentProvider,
): Promise<StartedPayment> {
  const parsed = StartPaymentInputSchema.safeParse(input);
  if (!parsed.success) {
    return { done: true, result: invalidStartPayment(parsed.error.issues) };
  }
  const request = parsed.data;
  const published = await readPublishedLegal(request);

  const outcome = await db.transaction((tx) =>
    placePayment(tx, device, request, provider, published),
  );
  if ('soldOut' in outcome) {
    return {
      done: true,
      result: {
        status: 'sold_out',
        alternatives: await readAlternatives(outcome.soldOut),
      },
    };
  }
  return outcome;
}

async function placePayment(
  tx: Transaction,
  device: Device,
  request: z.output<typeof StartPaymentInputSchema>,
  provider: PaymentProvider,
  published: PublishedLegal,
): Promise<Outcome> {
  const [read] = await tx
    .select({ sessionId: holds.sessionId, deviceKey: holds.deviceKey })
    .from(holds)
    .where(eq(holds.id, request.holdId));
  // A missing hold and another device's hold end here alike, before any lock is taken.
  if (!isHoldOfDevice(read, device.deviceKey)) {
    return { done: true, result: unknownHold };
  }

  const locked = await lockSessionRow(tx, read.sessionId);
  const hold = await lockHoldRow(tx, request.holdId);
  const lockedOrder = await lockOrderRow(
    tx,
    bookingIdempotencyKey(request.holdId),
  );
  const at = await readDatabaseTime(tx);

  const order = lockedOrder ? OrderSchema.parse(lockedOrder) : null;
  const setting = await readHoldSettings(tx);
  const items = hold ? await readHeldItems(tx, hold.id) : [];
  const priced =
    hold && locked
      ? priceHold(items, locked.taxTreatment, setting.taxRatePpm)
      : null;
  const latestAttempt = order ? await readLatestAttempt(tx, order.id) : null;

  const decision = startPaymentDecision({
    deviceKey: device.deviceKey,
    readSessionId: read.sessionId,
    hold: hold ?? null,
    subject: locked
      ? {
          experienceStatus: locked.experienceStatus,
          sessionStatus: locked.session.status,
          startsAt: locked.session.startsAt,
        }
      : null,
    order,
    latestAttempt,
    issues: locked
      ? inputIssues(locked, request, childCount(items), published)
      : {},
    amountDueMinor: amountDueNow(order, priced),
    chargeLimits: { minMinor: minAmountMinor, maxMinor: maxAmountMinor },
    at,
  });

  if (decision.kind === 'refuse')
    return { done: true, result: decision.result };
  if (!hold || !locked || !priced) {
    throw new Error('A payment was allowed for a hold that was not found');
  }
  if (decision.kind === 'already_confirmed') {
    if (!order) throw new Error('A confirmed order was not found');
    return {
      done: true,
      result: alreadyConfirmedResult(
        order.reference,
        orderTokenFor(hold, device.deviceKey, () =>
          capabilityToken('order', order.id, order.manageTokenVersion),
        ),
      ),
    };
  }
  if (decision.kind === 'lapsed') {
    const left = remainingSpaces(
      locked.session,
      await readOpenHeldSeats(tx, locked.session.id, at),
    );
    const lapsed = lapsedOutcome(hold.seats, left);
    return lapsed.kind === 'result'
      ? { done: true, result: lapsed.result }
      : {
          soldOut: {
            experienceId: locked.session.experienceId,
            sessionId: locked.session.id,
            seats: hold.seats,
          },
        };
  }

  const guest = await findOrCreateGuest(tx, request.contact.email);
  if (guest.status !== 'ok') {
    throw new Error('The checkout email was refused after it passed the form');
  }
  const grant = newsletterConsent(guest.guest.id, request.newsletterOptIn);
  if (grant) {
    const consent = await recordConsent(tx, grant);
    if (
      consent.status === 'invalid' ||
      consent.status === 'guest_unavailable'
    ) {
      throw new Error('The newsletter consent was refused');
    }
  }
  const fields = orderFields(request, guest.guest.id);

  let current: z.output<typeof OrderSchema>;
  if (order) {
    // A reused order follows the latest form, so a name fixed after a decline is not lost; the
    // money on it never changes.
    const [updated] = await tx
      .update(orders)
      .set({ ...fields, status: statusOnRetry(order.status) })
      .where(eq(orders.id, order.id))
      .returning();
    if (!updated) throw new Error('The order update returned no row');
    current = OrderSchema.parse(updated);
  } else {
    const [tier] = await tx
      .select({
        id: cancellationTiers.id,
        fullRefundHoursBefore: cancellationTiers.fullRefundHoursBefore,
      })
      .from(cancellationTiers)
      .where(eq(cancellationTiers.id, locked.cancellationTierId));
    if (!tier) throw new Error('The experience has no cancellation tier');
    current = await insertOrder(tx, (reference) =>
      orderSnapshot({
        reference,
        holdId: hold.id,
        session: locked.session,
        hostId: locked.hostId,
        taxTreatment: locked.taxTreatment,
        tier,
        priced,
        fields,
        attribution: request.attribution,
        at,
      }),
    );
    await tx
      .insert(orderItems)
      .values(
        orderItemRows(current.id, priced).map((row) =>
          OrderItemSchema.parse(row),
        ),
      );
  }

  const accepted = await recordOrderAcceptances(tx, device, {
    orderId: current.id,
    legalDocumentIds: acceptedDocumentIds(request),
  });
  if (accepted.status === 'refused') {
    throw new Error('The checkout acceptances were refused');
  }

  const attempt = await attemptFor(
    tx,
    decision,
    current,
    latestAttempt,
    provider,
  );

  const paying = payingHold(hold, at, setting.paymentGraceMinutes);
  if (paying) {
    await tx
      .update(holds)
      .set({
        status: 'paying',
        payingUntil: paying.payingUntil,
        updatedAt: at,
      })
      .where(eq(holds.id, hold.id));
  }

  return {
    done: false,
    order: {
      id: current.id,
      reference: current.reference,
      amountDueMinor: current.amountDueMinor,
    },
    orderToken: orderTokenFor(hold, device.deviceKey, () =>
      capabilityToken('order', current.id, current.manageTokenVersion),
    ),
    attempt,
  };
}

/** Inserts the order under a fresh reference, trying again on a clash with an existing one. */
async function insertOrder(
  tx: Transaction,
  snapshot: (reference: string) => typeof orders.$inferInsert,
) {
  for (let tries = 0; tries < referenceTries; tries += 1) {
    const [row] = await tx
      .insert(orders)
      .values(snapshot(newOrderReference(randomInt)))
      .onConflictDoNothing({ target: orders.reference })
      .returning();
    if (row) return OrderSchema.parse(row);
  }
  throw new Error(`No free order reference in ${String(referenceTries)} tries`);
}

type Decision = Exclude<
  StartDecision,
  { kind: 'refuse' | 'already_confirmed' | 'lapsed' }
>;

/** The attempt the provider step works on: the live one the decision found, or the next one. */
async function attemptFor(
  tx: Transaction,
  decision: Decision,
  order: { id: string; amountDueMinor: number },
  latest: Awaited<ReturnType<typeof readLatestAttempt>>,
  provider: PaymentProvider,
) {
  if (decision.kind === 'in_flight' || decision.kind === 'resume') {
    if (!latest) throw new Error('The live attempt was not found');
    return {
      id: latest.id,
      providerKey: latest.providerKey,
      amountMinor: latest.amountMinor,
      providerPaymentId: latest.providerPaymentId,
      existed: true,
    };
  }
  const { attemptNo } = decision;
  const [row] = await tx
    .insert(paymentAttempts)
    .values({
      orderId: order.id,
      attemptNo,
      provider,
      providerKey: attemptProviderKey(order.id, attemptNo),
      amountMinor: order.amountDueMinor,
    })
    .returning();
  if (!row) throw new Error('The attempt insert returned no row');
  const attempt = PaymentAttemptSchema.parse(row);
  return {
    id: attempt.id,
    providerKey: attempt.providerKey,
    amountMinor: attempt.amountMinor,
    providerPaymentId: null,
    existed: false,
  };
}

/**
 * `startPayment`, second transaction (design doc 4.2.3, Orders, step 6): stores the provider's
 * payment id on the attempt, once, and only while the attempt is live. The attempt is checked
 * against the calling device through its order's hold. True when the id is stored afterwards (now,
 * or by an earlier call); false when nothing was written. If this write fails the order stays
 * matchable by the metadata the payment carries.
 */
export async function recordProviderPayment(
  device: Device,
  attemptId: string,
  providerPaymentId: string,
): Promise<boolean> {
  const ids = z
    .object({ attemptId: WriteIdSchema, providerPaymentId: ProviderIdSchema })
    .parse({ attemptId, providerPaymentId });
  return db.transaction(async (tx) => {
    const row = await lockAttemptRow(tx, ids.attemptId);
    if (!isHoldOfDevice(row, device.deviceKey)) return false;
    const attempt = PaymentAttemptSchema.parse(row.attempt);
    const verdict = storeProviderPayment(attempt, ids.providerPaymentId);
    if (verdict.write) {
      await tx
        .update(paymentAttempts)
        .set({
          providerPaymentId: ids.providerPaymentId,
          updatedAt: sql`clock_timestamp()`,
        })
        .where(eq(paymentAttempts.id, attempt.id));
    }
    return verdict.stored;
  });
}
