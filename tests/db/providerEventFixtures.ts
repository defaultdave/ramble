import { randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import { afterAll, beforeAll, beforeEach, expect, vi } from 'vitest';
import {
  providerEventRow,
  processProviderEventKind,
  type IncomingProviderEvent,
} from '@/lib/providerEvents';
import type { ConfirmOrder } from '@/server/db/confirmOrder';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { insertHold, insertSession, minute } from './holdFixtures';
import { createOrderParents } from './orderParents';

let fresh: FreshDatabase;
export let client: typeof import('@/server/db/client');
export let dbEvents: typeof import('@/server/db/providerEvents');
export let jobModule: typeof import('@/server/jobs/providerEvents');
export let schema: typeof import('@/server/db/schema');
export let drain: typeof import('@/server/jobs/drain');
let clockModule: typeof import('@/server/ports/clock');
export let gateway: typeof import('@/server/ports/payments/gateway');
export let side: Pool;
const parents = {
  hostId: '',
  experienceId: '',
  tierId: '',
  guestId: '',
  priceOptionId: '',
  termsDocumentId: '',
};

/** Registers the hooks that give a test file its own database; `raise` is the file's mocked alert. */
export function setupProviderEventsDatabase(raise: { mockClear: () => void }) {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    dbEvents = await import('@/server/db/providerEvents');
    jobModule = await import('@/server/jobs/providerEvents');
    schema = await import('@/server/db/schema');
    drain = await import('@/server/jobs/drain');
    clockModule = await import('@/server/ports/clock');
    gateway = await import('@/server/ports/payments/gateway');
    Object.assign(parents, await createOrderParents(client.db, 'events'));
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

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const reference = () =>
  `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;

type AttemptSeed = {
  status?:
    | 'created'
    | 'requires_action'
    | 'processing'
    | 'failed_try'
    | 'succeeded'
    | 'canceled';
  failedTries?: number;
  providerPaymentId?: string | null;
};

export type World = {
  orderId: string;
  attemptId: string;
  holdId: string;
  sessionId: string;
  paymentId: string;
};

/** A booking order with one attempt and the hold it pays under, in the states the test names. */
export async function seedWorld(
  options: {
    orderStatus?: 'pending_payment' | 'payment_failed' | 'confirmed' | 'void';
    holdExpired?: boolean;
    payingMinutes?: number;
    holdStatus?: 'active' | 'paying';
    attempt?: AttemptSeed;
  } = {},
): Promise<World> {
  const { db } = client;
  const session = await insertSession(db, parents.experienceId);
  const expired = options.holdExpired ?? false;
  const holdStatus = options.holdStatus ?? 'paying';
  const hold = await insertHold(db, session.id, {
    status: holdStatus,
    ...(expired ? { createdAt: new Date(Date.now() - 30 * minute) } : {}),
    ...(holdStatus === 'paying'
      ? {
          payingUntil: sql`now() + make_interval(mins => ${options.payingMinutes ?? 12})`,
        }
      : {}),
  });
  const orderStatus = options.orderStatus ?? 'pending_payment';
  const [order] = await db
    .insert(schema.orders)
    .values({
      reference: reference(),
      kind: 'booking',
      status: orderStatus,
      idempotencyKey: `book:${hold.id}`,
      holdId: hold.id,
      sessionId: session.id,
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      leadGuestName: 'Pat Smith',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: 17000,
      taxTreatment: 'taxable',
      taxRatePpm: 88750,
      taxMinor: 1509,
      totalMinor: 18509,
      amountDueMinor: 18509,
      commissionRateBps: 1500,
      commissionMinor: 2550,
      cancellationTierId: parents.tierId,
      ...(orderStatus === 'confirmed'
        ? { confirmedAt: sql`clock_timestamp()` }
        : {}),
    })
    .returning({ id: schema.orders.id });
  if (!order) throw new Error('no order');
  const paymentId = `pay_${randomUUID()}`;
  const seed = options.attempt ?? {};
  const [attempt] = await db
    .insert(schema.paymentAttempts)
    .values({
      orderId: order.id,
      attemptNo: 1,
      provider: 'fake',
      providerKey: `pay:${order.id}:1`,
      providerPaymentId:
        seed.providerPaymentId === undefined
          ? paymentId
          : seed.providerPaymentId,
      amountMinor: 18509,
      status: seed.status ?? 'created',
      failedTries: seed.failedTries ?? 0,
    })
    .returning({ id: schema.paymentAttempts.id });
  if (!attempt) throw new Error('no attempt');
  return {
    orderId: order.id,
    attemptId: attempt.id,
    holdId: hold.id,
    sessionId: session.id,
    paymentId,
  };
}

let eventCounter = 0;
export function incoming(
  world: Pick<World, 'orderId' | 'attemptId' | 'paymentId'>,
  type: IncomingProviderEvent['type'],
  over: Partial<IncomingProviderEvent> = {},
): IncomingProviderEvent {
  eventCounter += 1;
  return {
    id: `evt_${String(eventCounter)}_${randomUUID()}`,
    provider: 'fake',
    type,
    objectId: world.paymentId,
    metadata: { orderId: world.orderId, recordId: world.attemptId },
    amountMinor: 18509,
    currency: 'USD',
    feeMinor: type === 'payment.succeeded' ? 560 : null,
    failureCode: type === 'payment.failed' ? 'card_declined' : null,
    method: type === 'payment.succeeded' ? 'google_pay' : null,
    occurredAt: new Date(),
    ...over,
  };
}

/** Stores an event the way the route does and returns its row id. */
export async function store(event: IncomingProviderEvent): Promise<string> {
  const row = providerEventRow(event);
  if (!row) throw new Error('event not storable');
  expect(await dbEvents.recordProviderEvent(row)).toBe('stored');
  const [stored] = await client.db
    .select({ id: schema.providerEvents.id })
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.providerEventId, event.id));
  if (!stored) throw new Error('event not stored');
  return stored.id;
}

export const confirmed = vi.fn<ConfirmOrder>();

/** A ConfirmOrder that only marks the order confirmed, so the rest of the handler can be seen without the real confirm step. */
export const confirmsOrder: ConfirmOrder = async (tx, input) => {
  void confirmed(tx, input);
  await tx
    .update(schema.orders)
    .set({ status: 'confirmed', confirmedAt: sql`clock_timestamp()` })
    .where(eq(schema.orders.id, input.orderId));
  return { status: 'confirmed', reference: 'RMB-TEST01' };
};

/** A confirm step that cannot confirm, as the seam was before the confirm step existed: the event keeps its mark and retries. */
export const unavailable: ConfirmOrder = () =>
  Promise.resolve({ status: 'unavailable' });

export async function run(
  eventId: string,
  options: {
    confirmOrder?: ConfirmOrder;
    prepared?: { orderId: string; recordId: string } | null;
  } = {},
) {
  await client.db.transaction((tx) =>
    jobModule.handleProviderEvent(
      {
        tx,
        payload: { eventId },
        prepared: options.prepared ?? null,
        jobId: randomUUID(),
        clock: clockModule.systemClock,
      },
      { confirmOrder: options.confirmOrder ?? confirmsOrder },
    ),
  );
}

export async function handle(
  world: World,
  type: IncomingProviderEvent['type'],
  over: Partial<IncomingProviderEvent> = {},
) {
  const id = await store(incoming(world, type, over));
  await run(id);
  return id;
}

export async function attemptOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  if (!row) throw new Error('no attempt');
  return row;
}

export async function orderOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  if (!row) throw new Error('no order');
  return row;
}

export async function holdOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.holds)
    .where(eq(schema.holds.id, world.holdId));
  if (!row) throw new Error('no hold');
  return row;
}

export async function eventOf(id: string) {
  const [row] = await client.db
    .select()
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.id, id));
  if (!row) throw new Error('no event');
  return row;
}

export async function clearJobs() {
  await client.db.execute(sql`DELETE FROM jobs`);
}

export async function jobsFor(eventId: string) {
  const { rows } = await client.db.execute<{
    id: string;
    status: string;
    run_after: string;
    dedupe_key: string;
  }>(
    sql`SELECT id, status, run_after, dedupe_key FROM jobs WHERE kind = ${processProviderEventKind} AND payload->>'eventId' = ${eventId} ORDER BY created_at, dedupe_key`,
  );
  return rows;
}
