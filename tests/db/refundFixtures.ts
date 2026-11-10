import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import { accountBalances, bookingPaid } from '@/lib/ledger';
import {
  providerEventRow,
  type IncomingProviderEvent,
} from '@/lib/providerEvents';
import type { RefundRequestInput } from '@/lib/refunds';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { seedBooking } from './confirmOrderFixtures';
import { insertGift } from './giftFixtures';
import { createOrderParents } from './orderParents';

let fresh: FreshDatabase;
export let client: typeof import('@/server/db/client');
export let schema: typeof import('@/server/db/schema');
let refundData: typeof import('@/server/db/refunds');
let eventData: typeof import('@/server/db/providerEvents');
let eventJob: typeof import('@/server/jobs/providerEvents');
export let refundJob: typeof import('@/server/jobs/refund');
let ledgerData: typeof import('@/server/db/ledger');
export let drain: typeof import('@/server/jobs/drain');
export let gateway: typeof import('@/server/ports/payments/gateway');
export let side: Pool;
let clock: typeof import('@/server/ports/clock');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

/** Registers the hooks that give a test file its own database; `raise` is the file's mocked alert. */
export function setupRefundsDatabase(raise: { mockClear: () => void }) {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    schema = await import('@/server/db/schema');
    refundData = await import('@/server/db/refunds');
    eventData = await import('@/server/db/providerEvents');
    eventJob = await import('@/server/jobs/providerEvents');
    refundJob = await import('@/server/jobs/refund');
    ledgerData = await import('@/server/db/ledger');
    drain = await import('@/server/jobs/drain');
    gateway = await import('@/server/ports/payments/gateway');
    clock = await import('@/server/ports/clock');
    parents = await createOrderParents(client.db, 'refunds');
    side = new Pool({ connectionString: fresh.url, max: 4 });
  });

  afterAll(async () => {
    await side.end();
    await client.db.$client.end();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(() => {
    raise.mockClear();
  });
}

export type PaidOrder = {
  orderId: string;
  attemptId: string;
  paymentId: string;
  hostId: string;
  totalMinor: number;
  commissionMinor: number;
  taxMinor: number;
};

type Seed = {
  /** $170 with tax (the default is $130 without). */
  taxable?: boolean;
  status?:
    'confirmed' | 'cancelled' | 'refunded_after_lapse' | 'pending_payment';
  /** A succeeded attempt, or none, or a payment the order's attempt never had an id for. */
  attempt?: 'succeeded' | 'none';
  /** The card paid only this much, a gift the rest. */
  amountDueMinor?: number;
  /** Also make the payment at the fake gateway, so the refund job has one to refund. */
  gatewayPayment?: boolean;
};

/** A booking order paid in full: confirmed, a succeeded attempt, and the ledger rows the confirm step writes. */
export async function seedPaidOrder(seed: Seed = {}): Promise<PaidOrder> {
  const world = await seedBooking(client.db, parents, {
    taxable: seed.taxable ?? false,
  });
  const gift =
    seed.amountDueMinor === undefined
      ? null
      : await insertGift(client.db, parents);
  const [order] = await client.db
    .update(schema.orders)
    .set({
      status: seed.status ?? 'confirmed',
      confirmedAt:
        seed.status === 'pending_payment' ? null : sql`clock_timestamp()`,
      ...(seed.amountDueMinor === undefined
        ? {}
        : {
            giftAppliedMinor: world.amountDueMinor - seed.amountDueMinor,
            amountDueMinor: seed.amountDueMinor,
            giftId: gift?.id ?? null,
          }),
    })
    .where(eq(schema.orders.id, world.orderId))
    .returning();
  if (!order) throw new Error('no order');
  let paymentId = world.paymentId;
  if (seed.gatewayPayment) {
    const fake = gateway.getFakePayments();
    const created = await fake.createPayment({
      idempotencyKey: `pay:${order.id}:1`,
      amountMinor: order.amountDueMinor,
      currency: 'USD',
      metadata: { orderId: order.id, recordId: world.attemptId },
    });
    await fake.confirm(created.id, { outcome: 'succeeded' });
    paymentId = created.id;
  }
  await client.db
    .update(schema.paymentAttempts)
    .set({
      status: seed.attempt === 'none' ? 'canceled' : 'succeeded',
      providerPaymentId: paymentId,
    })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  await client.db.transaction((tx) =>
    ledgerData.postEntries(
      tx,
      bookingPaid({
        occurredAt: new Date(),
        simulated: true,
        orderId: order.id,
        hostId: order.hostId,
        paymentAttemptId: world.attemptId,
        providerObjectId: paymentId,
        split: {
          ticketMinor: order.ticketSubtotalMinor,
          commissionMinor: order.commissionMinor,
          taxMinor: order.taxMinor,
        },
      }),
    ),
  );
  return {
    orderId: order.id,
    attemptId: world.attemptId,
    paymentId,
    hostId: order.hostId,
    totalMinor: order.totalMinor,
    commissionMinor: order.commissionMinor,
    taxMinor: order.taxMinor,
  };
}

/** `requestRefund` in a transaction of its own. */
export function ask(
  world: Pick<PaidOrder, 'orderId'>,
  over: Partial<RefundRequestInput> = {},
) {
  return client.db.transaction((tx) =>
    refundData.requestRefund(tx, {
      orderId: world.orderId,
      reason: 'guest_cancel',
      key: 'cancel',
      ticketMinor: 'remaining',
      ...over,
    }),
  );
}

export async function refundsOf(world: Pick<PaidOrder, 'orderId'>) {
  return client.db
    .select()
    .from(schema.refunds)
    .where(eq(schema.refunds.orderId, world.orderId))
    .orderBy(schema.refunds.createdAt);
}

export async function orderOf(world: Pick<PaidOrder, 'orderId'>) {
  const [row] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  if (!row) throw new Error('no order');
  return row;
}

export async function ledgerOf(world: Pick<PaidOrder, 'orderId'>) {
  return client.db
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.orderId, world.orderId))
    .orderBy(schema.ledgerEntries.id);
}

export async function balancesOf(world: Pick<PaidOrder, 'orderId'>) {
  return accountBalances(
    (await ledgerOf(world)).map((row) => ({
      debitAccount: row.debitAccount,
      creditAccount: row.creditAccount,
      amountMinor: row.amountMinor,
    })),
  );
}

export async function jobsOfKind(kind: string) {
  const { rows } = await client.db.execute<{
    payload: unknown;
    dedupe_key: string;
    status: string;
  }>(
    sql`SELECT payload, dedupe_key, status FROM jobs WHERE kind = ${kind} ORDER BY created_at`,
  );
  return rows;
}

export async function clearJobs() {
  await client.db.execute(sql`DELETE FROM jobs`);
}

let eventCounter = 0;

/** A refund event from the provider for a refund of Ramble's, with the ids the provider echoes. */
export function refundEvent(
  world: Pick<PaidOrder, 'orderId'>,
  refund: { id: string; amountMinor: number },
  type: 'refund.succeeded' | 'refund.failed',
  over: Partial<IncomingProviderEvent> = {},
): IncomingProviderEvent {
  eventCounter += 1;
  return {
    id: `evt_refund_${String(eventCounter)}_${randomUUID()}`,
    provider: 'fake',
    type,
    objectId: `re_${refund.id.replaceAll('-', '').slice(0, 24)}`,
    metadata: { orderId: world.orderId, recordId: refund.id },
    amountMinor: refund.amountMinor,
    currency: 'USD',
    feeMinor: null,
    failureCode: type === 'refund.failed' ? 'refund_declined' : null,
    method: null,
    occurredAt: new Date(),
    ...over,
  };
}

/** Stores an event the way the webhook intake does and returns its row id. */
export async function storeEvent(event: IncomingProviderEvent) {
  const row = providerEventRow(event);
  if (!row) throw new Error('event not storable');
  await eventData.recordProviderEvent(row);
  const [stored] = await client.db
    .select({ id: schema.providerEvents.id })
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.providerEventId, event.id));
  if (!stored) throw new Error('event not stored');
  return stored.id;
}

/** The event job's handler on one stored event, in a transaction. */
export async function handleEvent(eventId: string) {
  await client.db.transaction((tx) =>
    eventJob.handleProviderEvent({
      tx,
      payload: { eventId },
      prepared: null,
      jobId: randomUUID(),
      clock: clock.systemClock,
    }),
  );
}

export async function eventRow(eventId: string) {
  const [row] = await client.db
    .select()
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.id, eventId));
  if (!row) throw new Error('no event');
  return row;
}
