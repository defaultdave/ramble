import { randomInt, randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { paymentLimits } from '@/lib/payments';
import {
  ProcessProviderEventPayloadSchema,
  alertAfterEventAttempts,
  processProviderEventKind,
  providerEventRow,
  type IncomingProviderEvent,
} from '@/lib/providerEvents';
import { backoffSeconds } from '@/lib/jobs';
import type { ConfirmOrder } from '@/server/db/confirmOrder';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import { getFakePayments } from '@/server/ports/payments/gateway';
import {
  deliverEmittedEvents,
  type SimulatedDelivery,
} from '../support/paymentEvents';
import { dueClock } from '../support/dueClock';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { insertHold, insertSession, minute } from './holdFixtures';
import { createOrderParents } from './orderParents';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk:
// - intake stores an event once with the ids from its metadata and queues exactly one job; a repeat writes and
//   queues nothing
// - each row of design doc 4.2.3 "What each event does", from a seeded order, attempt, and hold:
//   succeeded on the live attempt (attempt succeeded, confirm called with the amount; the stand-in confirm seam leaves the event
//   unprocessed with no alert; a leftover succeeded attempt is confirmed again; an order already settled is a no-op),
//   succeeded on a canceled attempt and on another payment (one alert, event left for the refund unit),
//   failed (a try; the hold reopens only while unexpired; the fifth try cancels and voids; a non-pending order changes the attempt only;
//   a terminal attempt never changes), requires_action (the hold's paying_until extended once), canceled,
//   a payment matched by record id gets its provider id stored
// - refund, transfer, and dispute events are left alone: no retry job, no alert, no try counted
// - an event with no order id is matched through the provider; still unmatched it is retried with backoff, alerts on the 5th try
//   once, and gives up with a second alert on the last
// - events for one order are processed one at a time: a handler waits for the order's advisory lock and judges the state the
//   lock holder left (fails if the lock or the locked read is removed), and the session and hold locks are held while it
//   waits for the order row (the one lock order)
// - late, out of order, and repeated delivery through the simulator ends in the same state as in-order delivery

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let dbEvents: typeof import('@/server/db/providerEvents');
let jobModule: typeof import('@/server/jobs/providerEvents');
let schema: typeof import('@/server/db/schema');
let drain: typeof import('@/server/jobs/drain');
let clockModule: typeof import('@/server/ports/clock');
let side: Pool;
const parents = {
  hostId: '',
  experienceId: '',
  tierId: '',
  guestId: '',
  priceOptionId: '',
  termsDocumentId: '',
};

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  const handlerUrl = new URL(fresh.url);
  handlerUrl.searchParams.set('application_name', fresh.schema);
  vi.stubEnv('DATABASE_URL', handlerUrl.toString());
  client = await import('@/server/db/client');
  dbEvents = await import('@/server/db/providerEvents');
  jobModule = await import('@/server/jobs/providerEvents');
  schema = await import('@/server/db/schema');
  drain = await import('@/server/jobs/drain');
  clockModule = await import('@/server/ports/clock');
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

type World = {
  orderId: string;
  attemptId: string;
  holdId: string;
  sessionId: string;
  paymentId: string;
};

/** A booking order with one attempt and the hold it pays under, in the states the test names. */
async function seedWorld(
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
function incoming(
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
async function store(event: IncomingProviderEvent): Promise<string> {
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

const confirmed = vi.fn<ConfirmOrder>();

/** A stand-in for U-049's confirm step: it confirms the order, so the rest of the handler can be seen. */
const confirmsOrder: ConfirmOrder = async (tx, input) => {
  void confirmed(tx, input);
  await tx
    .update(schema.orders)
    .set({ status: 'confirmed', confirmedAt: sql`clock_timestamp()` })
    .where(eq(schema.orders.id, input.orderId));
  return { status: 'confirmed', reference: 'RMB-TEST01' };
};

/** A confirm step that cannot confirm, as the seam was before the confirm step existed: the event keeps its mark and retries. */
const unavailable: ConfirmOrder = () =>
  Promise.resolve({ status: 'unavailable' });

async function run(
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

async function handle(
  world: World,
  type: IncomingProviderEvent['type'],
  over: Partial<IncomingProviderEvent> = {},
) {
  const id = await store(incoming(world, type, over));
  await run(id);
  return id;
}

async function attemptOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  if (!row) throw new Error('no attempt');
  return row;
}

async function orderOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  if (!row) throw new Error('no order');
  return row;
}

async function holdOf(world: World) {
  const [row] = await client.db
    .select()
    .from(schema.holds)
    .where(eq(schema.holds.id, world.holdId));
  if (!row) throw new Error('no hold');
  return row;
}

async function eventOf(id: string) {
  const [row] = await client.db
    .select()
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.id, id));
  if (!row) throw new Error('no event');
  return row;
}

async function clearJobs() {
  await client.db.execute(sql`DELETE FROM jobs`);
}

async function jobsFor(eventId: string) {
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

describe('intake', () => {
  it('stores an event once with its metadata ids and queues one job; a repeat writes and queues nothing', async () => {
    const world = await seedWorld();
    const event = incoming(world, 'payment.succeeded');
    const row = providerEventRow(event);
    if (!row) throw new Error('not storable');

    expect(await dbEvents.recordProviderEvent(row)).toBe('stored');
    expect(await dbEvents.recordProviderEvent(row)).toBe('repeat');
    expect(await dbEvents.recordProviderEvent(row)).toBe('repeat');

    const { rows } = await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM provider_events WHERE provider_event_id = ${event.id}`,
    );
    expect(rows[0]?.n).toBe(1);
    const [stored] = await client.db
      .select()
      .from(schema.providerEvents)
      .where(eq(schema.providerEvents.providerEventId, event.id));
    expect(stored).toMatchObject({
      provider: 'fake',
      type: 'payment.succeeded',
      objectId: world.paymentId,
      rambleOrderId: world.orderId,
      rambleRecordId: world.attemptId,
      amountMinor: 18509,
      currency: 'USD',
      processedAt: null,
      attempts: 0,
    });
    expect(stored?.payload).toMatchObject({
      feeMinor: 560,
      method: 'google_pay',
    });
    const jobs = await jobsFor(stored?.id ?? '');
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ status: 'pending' });
  });
});

describe('payment.succeeded', () => {
  it('moves the live attempt to succeeded, hands the amount to confirm, and marks the event processed', async () => {
    confirmed.mockClear();
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await handle(world, 'payment.succeeded');

    expect(await attemptOf(world)).toMatchObject({
      status: 'succeeded',
      method: 'google_pay',
    });
    expect(confirmed).toHaveBeenCalledTimes(1);
    expect(confirmed.mock.calls[0]?.[1]).toMatchObject({
      orderId: world.orderId,
      attemptId: world.attemptId,
      providerPaymentId: world.paymentId,
      amountMinor: 18509,
      currency: 'USD',
      feeMinor: 560,
    });
    expect((await eventOf(id)).processedAt).not.toBeNull();
    expect(raise).not.toHaveBeenCalled();
  });

  it('with a confirm seam that is unavailable, keeps the succeeded mark, schedules a retry, and alerts nobody; a working seam then confirms the order', async () => {
    await clearJobs();
    const world = await seedWorld();
    const id = await store(incoming(world, 'payment.succeeded'));
    const { jobRegistry } = await import('@/server/jobs/registry');
    const registryWith = (seam: ConfirmOrder) => ({
      ...jobRegistry,
      [processProviderEventKind]: {
        ...jobRegistry[processProviderEventKind],
        handleIdempotent: (
          context: Parameters<
            (typeof jobRegistry)[typeof processProviderEventKind]['handleIdempotent']
          >[0],
        ) =>
          jobModule.handleProviderEvent(
            {
              ...context,
              payload: ProcessProviderEventPayloadSchema.parse(context.payload),
            },
            { confirmOrder: seam },
          ),
      },
    });
    const report = await drain.drainJobs(dueClock, registryWith(unavailable));

    expect(report).toMatchObject({ succeeded: 1, retried: 0, dead: 0 });
    expect(await attemptOf(world)).toMatchObject({ status: 'succeeded' });
    expect((await orderOf(world)).status).toBe('pending_payment');
    expect(await eventOf(id)).toMatchObject({
      processedAt: null,
      attempts: 1,
      lastError: 'Order confirmation is not available yet',
    });
    const jobs = await jobsFor(id);
    expect(jobs).toHaveLength(2);
    const retry = jobs.find((job) => job.dedupe_key.endsWith(':1'));
    expect(retry?.status).toBe('pending');
    expect(new Date(retry?.run_after ?? 0).getTime()).toBeGreaterThan(
      Date.now(),
    );
    expect(raise).not.toHaveBeenCalled();

    await client.db.execute(
      sql`UPDATE jobs SET run_after = now() - interval '1 minute' WHERE id = ${retry?.id}`,
    );
    await drain.drainJobs(dueClock, registryWith(confirmsOrder));

    expect((await orderOf(world)).status).toBe('confirmed');
    expect(await attemptOf(world)).toMatchObject({ status: 'succeeded' });
    expect((await eventOf(id)).processedAt).not.toBeNull();
    expect(raise).not.toHaveBeenCalled();
  });

  it('gives up on a success that could not be confirmed with one alert and no more jobs', async () => {
    const world = await seedWorld({ attempt: { status: 'succeeded' } });
    const id = await store(incoming(world, 'payment.succeeded'));
    await client.db
      .update(schema.providerEvents)
      .set({ attempts: paymentLimits.maxEventAttempts - 1 })
      .where(eq(schema.providerEvents.id, id));
    await run(id, { confirmOrder: unavailable });

    expect((await eventOf(id)).attempts).toBe(paymentLimits.maxEventAttempts);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(
      'payment-confirm-unavailable',
      'error',
      `event:${id}:gave-up`,
      { eventId: id, tries: paymentLimits.maxEventAttempts },
    );
    expect(await jobsFor(id)).toHaveLength(1);
  });

  it('confirms again, without moving the attempt, when an earlier run left it succeeded and the order unconfirmed', async () => {
    confirmed.mockClear();
    const world = await seedWorld({ attempt: { status: 'succeeded' } });
    const id = await handle(world, 'payment.succeeded');

    expect(confirmed).toHaveBeenCalledTimes(1);
    expect((await orderOf(world)).status).toBe('confirmed');
    expect((await eventOf(id)).processedAt).not.toBeNull();
  });

  it('is a no-op for an attempt already succeeded on a confirmed order (a repeat)', async () => {
    confirmed.mockClear();
    const world = await seedWorld({
      orderStatus: 'confirmed',
      attempt: { status: 'succeeded' },
    });
    const id = await handle(world, 'payment.succeeded');

    expect(confirmed).not.toHaveBeenCalled();
    expect(await attemptOf(world)).toMatchObject({ status: 'succeeded' });
    expect((await eventOf(id)).processedAt).not.toBeNull();
    expect(raise).not.toHaveBeenCalled();
  });

  it('alerts once and leaves the event for the refund unit when the attempt was canceled', async () => {
    confirmed.mockClear();
    const world = await seedWorld({
      attempt: { status: 'canceled', failedTries: 5 },
    });
    const id = await handle(world, 'payment.succeeded');

    expect(confirmed).not.toHaveBeenCalled();
    expect(await attemptOf(world)).toMatchObject({ status: 'canceled' });
    expect((await eventOf(id)).processedAt).toBeNull();
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(
      'payment-duplicate',
      'error',
      `event:${id}`,
      { eventId: id, orderId: world.orderId },
    );
  });

  it('alerts once for a success of another payment on the order', async () => {
    confirmed.mockClear();
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await handle(world, 'payment.succeeded', {
      objectId: `pay_${randomUUID()}`,
    });

    expect(confirmed).not.toHaveBeenCalled();
    expect(await attemptOf(world)).toMatchObject({ status: 'processing' });
    expect((await eventOf(id)).processedAt).toBeNull();
    expect(raise).toHaveBeenCalledTimes(1);
  });

  it('stores the provider id on an attempt it matched by record id', async () => {
    const world = await seedWorld({
      attempt: { status: 'processing', providerPaymentId: null },
    });
    await handle(world, 'payment.succeeded');

    expect(await attemptOf(world)).toMatchObject({
      status: 'succeeded',
      providerPaymentId: world.paymentId,
    });
  });
});

describe('payment.failed', () => {
  it('records a try, moves the order to payment_failed, and reopens the paying hold', async () => {
    const world = await seedWorld();
    const id = await handle(world, 'payment.failed');

    expect(await attemptOf(world)).toMatchObject({
      status: 'failed_try',
      failedTries: 1,
      failureCode: 'card_declined',
    });
    expect((await orderOf(world)).status).toBe('payment_failed');
    expect(await holdOf(world)).toMatchObject({
      status: 'active',
      payingUntil: null,
    });
    expect((await eventOf(id)).processedAt).not.toBeNull();
  });

  it('leaves an expired hold as it was', async () => {
    const world = await seedWorld({ holdExpired: true });
    await handle(world, 'payment.failed');

    expect((await orderOf(world)).status).toBe('payment_failed');
    expect((await holdOf(world)).status).toBe('paying');
  });

  it('cancels the attempt and voids the order on the fifth try', async () => {
    const world = await seedWorld({
      attempt: { status: 'failed_try', failedTries: 4 },
    });
    await handle(world, 'payment.failed');

    expect(await attemptOf(world)).toMatchObject({
      status: 'canceled',
      failedTries: 5,
    });
    expect((await orderOf(world)).status).toBe('void');
  });

  it('changes only the attempt when the order is not pending payment', async () => {
    const world = await seedWorld({
      orderStatus: 'payment_failed',
      attempt: { status: 'failed_try', failedTries: 1 },
    });
    await handle(world, 'payment.failed');

    expect(await attemptOf(world)).toMatchObject({ failedTries: 2 });
    expect((await orderOf(world)).status).toBe('payment_failed');
    expect((await holdOf(world)).status).toBe('paying');
  });

  it('never changes a terminal attempt', async () => {
    const world = await seedWorld({
      orderStatus: 'confirmed',
      attempt: { status: 'succeeded' },
    });
    const id = await handle(world, 'payment.failed');

    expect(await attemptOf(world)).toMatchObject({
      status: 'succeeded',
      failedTries: 0,
    });
    expect((await orderOf(world)).status).toBe('confirmed');
    expect((await eventOf(id)).processedAt).not.toBeNull();
  });
});

describe('payment.requires_action and payment.canceled', () => {
  it('moves the attempt to requires_action and extends the paying hold once', async () => {
    const world = await seedWorld({ holdExpired: true, payingMinutes: 1 });
    const before = await holdOf(world);
    const first = await handle(world, 'payment.requires_action');
    const extended = await holdOf(world);

    expect(await attemptOf(world)).toMatchObject({ status: 'requires_action' });
    expect(extended.payingUntil?.getTime()).toBeGreaterThan(
      before.payingUntil?.getTime() ?? 0,
    );
    expect((await eventOf(first)).processedAt).not.toBeNull();

    await handle(world, 'payment.requires_action');
    expect((await holdOf(world)).payingUntil).toEqual(extended.payingUntil);
  });

  it('cancels the attempt and leaves the order alone', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await handle(world, 'payment.canceled');

    expect(await attemptOf(world)).toMatchObject({ status: 'canceled' });
    expect((await orderOf(world)).status).toBe('pending_payment');
    expect((await eventOf(id)).processedAt).not.toBeNull();
  });
});

describe('events that belong to later units', () => {
  it.each(['refund.succeeded', 'transfer.paid', 'dispute.opened'] as const)(
    'leaves %s unprocessed with no retry, no alert, and no try counted',
    async (type) => {
      await clearJobs();
      const world = await seedWorld({
        orderStatus: 'confirmed',
        attempt: { status: 'succeeded' },
      });
      const id = await store(incoming(world, type));
      const report = await drain.drainJobs(dueClock);

      expect(report).toMatchObject({ succeeded: 1, retried: 0, dead: 0 });
      expect(await eventOf(id)).toMatchObject({
        processedAt: null,
        attempts: 0,
        lastError: null,
      });
      expect(await jobsFor(id)).toHaveLength(1);
      expect(raise).not.toHaveBeenCalled();
    },
  );
});

describe('events that match nothing', () => {
  const unmatchedEvent = (
    over: Partial<IncomingProviderEvent> = {},
  ): IncomingProviderEvent => ({
    ...incoming(
      {
        orderId: randomUUID(),
        attemptId: randomUUID(),
        paymentId: `pay_${randomUUID()}`,
      },
      'payment.succeeded',
    ),
    metadata: null,
    ...over,
  });

  it('matches by metadata through the provider when the event carried none', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await store(unmatchedEvent({ objectId: world.paymentId }));
    await run(id, {
      prepared: { orderId: world.orderId, recordId: world.attemptId },
    });

    expect(await eventOf(id)).toMatchObject({
      rambleOrderId: world.orderId,
      rambleRecordId: world.attemptId,
    });
    expect(await attemptOf(world)).toMatchObject({ status: 'succeeded' });
  });

  it('looks up the ids at the provider before the transaction, only for an event that needs it', async () => {
    const fake = getFakePayments();
    const recordId = randomUUID();
    const orderId = randomUUID();
    const payment = await fake.createPayment({
      idempotencyKey: `pay:${orderId}:1`,
      amountMinor: 5_000,
      currency: 'USD',
      metadata: { orderId, recordId },
    });
    const bare = await store(unmatchedEvent({ objectId: payment.id }));
    expect(await jobModule.prepareProviderEvent({ eventId: bare })).toEqual({
      orderId,
      recordId,
    });

    const unknown = await store(unmatchedEvent());
    expect(
      await jobModule.prepareProviderEvent({ eventId: unknown }),
    ).toBeNull();

    const world = await seedWorld();
    const named = await store(incoming(world, 'payment.failed'));
    expect(await jobModule.prepareProviderEvent({ eventId: named })).toBeNull();
  });

  it('refuses to look up an event of a provider the port is not', async () => {
    const id = await store(unmatchedEvent({ provider: 'stripe' }));

    await expect(
      jobModule.prepareProviderEvent({ eventId: id }),
    ).rejects.toThrow('No payments adapter for this provider');
  });

  it('counts the try, queues a retry after a backoff, and does not alert on the first', async () => {
    const id = await store(unmatchedEvent());
    await run(id);

    expect(await eventOf(id)).toMatchObject({
      attempts: 1,
      lastError: 'No matching payment attempt',
      processedAt: null,
    });
    const jobs = await jobsFor(id);
    expect(jobs).toHaveLength(2);
    const retry = jobs.find((job) => job.dedupe_key.endsWith(':1'));
    const wait = new Date(retry?.run_after ?? 0).getTime() - Date.now();
    expect(wait).toBeGreaterThan((backoffSeconds(1, id) - 5) * 1000);
    expect(wait).toBeLessThanOrEqual(backoffSeconds(1, id) * 1000 + 1000);
    expect(raise).not.toHaveBeenCalled();
  });

  it('alerts once on the fifth try and keeps retrying', async () => {
    const id = await store(unmatchedEvent());
    for (let tries = 1; tries <= alertAfterEventAttempts + 1; tries += 1) {
      await run(id);
    }

    expect((await eventOf(id)).attempts).toBe(alertAfterEventAttempts + 1);
    expect(raise).toHaveBeenCalledTimes(1);
    expect(raise).toHaveBeenCalledWith(
      'payment-event-unmatched',
      'error',
      `event:${id}`,
      {
        eventId: id,
        tries: alertAfterEventAttempts,
      },
    );
    expect(await jobsFor(id)).toHaveLength(alertAfterEventAttempts + 2);
  });

  it('gives up with a second alert on the last try and queues nothing more', async () => {
    const id = await store(unmatchedEvent());
    await client.db
      .update(schema.providerEvents)
      .set({ attempts: paymentLimits.maxEventAttempts - 1 })
      .where(eq(schema.providerEvents.id, id));
    await run(id);

    expect((await eventOf(id)).attempts).toBe(paymentLimits.maxEventAttempts);
    expect(raise).toHaveBeenCalledWith(
      'payment-event-unmatched',
      'error',
      `event:${id}:gave-up`,
      { eventId: id, tries: paymentLimits.maxEventAttempts },
    );
    expect(await jobsFor(id)).toHaveLength(1);
  });

  it('retries an event whose order does not exist', async () => {
    const missing = {
      orderId: randomUUID(),
      attemptId: randomUUID(),
      paymentId: `pay_${randomUUID()}`,
    };
    const id = await store(incoming(missing, 'payment.failed'));
    await run(id);

    expect(await eventOf(id)).toMatchObject({ attempts: 1, processedAt: null });
  });

  it('retries an event whose order has no matching attempt', async () => {
    const world = await seedWorld();
    const id = await handle(world, 'payment.failed', {
      objectId: `pay_${randomUUID()}`,
      metadata: { orderId: world.orderId, recordId: randomUUID() },
    });

    expect(await eventOf(id)).toMatchObject({ attempts: 1, processedAt: null });
    expect(await attemptOf(world)).toMatchObject({ failedTries: 0 });
  });

  it('does nothing for an event already processed', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await handle(world, 'payment.canceled');
    await run(id);

    expect(await eventOf(id)).toMatchObject({ attempts: 0 });
    expect(await jobsFor(id)).toHaveLength(1);
  });
});

async function waitUntilBlocked(count: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await side.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND application_name = $1`,
      [fresh.schema],
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline)
      throw new Error('the handler never waited for a lock');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('one order at a time', () => {
  it('waits for the order events lock and judges the state its holder left', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await store(incoming(world, 'payment.succeeded'));
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `order-events:${world.orderId}`,
    ]);

    confirmed.mockClear();
    const handled = run(id);
    await waitUntilBlocked(1);
    expect(confirmed).not.toHaveBeenCalled();
    await holder.query(
      `UPDATE payment_attempts SET status = 'canceled' WHERE id = $1`,
      [world.attemptId],
    );
    await holder.query('COMMIT');
    holder.release();
    await handled;

    expect(confirmed).not.toHaveBeenCalled();
    expect(await attemptOf(world)).toMatchObject({ status: 'canceled' });
    expect(raise).toHaveBeenCalledWith(
      'payment-duplicate',
      'error',
      `event:${id}`,
      expect.anything(),
    );
  });

  it('lets two handlers on one event act once: the second re-reads processed_at after the lock', async () => {
    const world = await seedWorld({ attempt: { status: 'created' } });
    const id = await store(incoming(world, 'payment.failed'));
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [
      `order-events:${world.orderId}`,
    ]);

    const both = Promise.all([run(id), run(id)]);
    await waitUntilBlocked(2);
    await holder.query('COMMIT');
    holder.release();
    await both;

    expect(await attemptOf(world)).toMatchObject({
      status: 'failed_try',
      failedTries: 1,
    });
    expect((await eventOf(id)).processedAt).not.toBeNull();
  });

  it('holds the session and hold locks while it waits for the order row', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const id = await store(incoming(world, 'payment.canceled'));
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT id FROM orders WHERE id = $1 FOR UPDATE`, [
      world.orderId,
    ]);

    const handled = run(id);
    await waitUntilBlocked(1);
    const probe = await side.connect();
    await expect(
      probe.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE NOWAIT`, [
        world.sessionId,
      ]),
    ).rejects.toMatchObject({ code: '55P03' });
    await expect(
      probe.query(`SELECT id FROM holds WHERE id = $1 FOR UPDATE NOWAIT`, [
        world.holdId,
      ]),
    ).rejects.toMatchObject({ code: '55P03' });
    probe.release();
    await holder.query('COMMIT');
    holder.release();
    await handled;

    expect(await attemptOf(world)).toMatchObject({ status: 'canceled' });
  });

  it('runs concurrent events for one order one at a time, to one consistent state', async () => {
    const world = await seedWorld({ attempt: { status: 'processing' } });
    const ids = await Promise.all([
      store(incoming(world, 'payment.failed')),
      store(incoming(world, 'payment.succeeded')),
      store(incoming(world, 'payment.requires_action')),
      store(incoming(world, 'payment.canceled')),
    ]);
    await Promise.all(ids.map((id) => run(id)));

    const attempt = await attemptOf(world);
    const processed = await Promise.all(ids.map((id) => eventOf(id)));
    expect(['succeeded', 'canceled']).toContain(attempt.status);
    expect(attempt.failedTries).toBeLessThanOrEqual(1);
    for (const event of processed) {
      expect(event.attempts).toBe(0);
    }
  });
});

describe('late, out of order, and repeated delivery', () => {
  const startedAt = new Date();

  /** One order paid after a challenge and a decline, delivered as `options` say; returns where it ended. */
  async function deliver(options: Parameters<typeof deliverEmittedEvents>[1]) {
    const world = await seedWorld({ attempt: { status: 'created' } });
    let now = startedAt;
    const fake = createFakePaymentsAdapter({
      webhookSecret: 'whsec_fake_0123456789abcdef',
      now: () => now,
    });
    const payment = await fake.createPayment({
      idempotencyKey: `pay:${world.orderId}:1`,
      amountMinor: 18509,
      currency: 'USD',
      metadata: { orderId: world.orderId, recordId: world.attemptId },
    });
    await client.db
      .update(schema.paymentAttempts)
      .set({ providerPaymentId: payment.id })
      .where(eq(schema.paymentAttempts.id, world.attemptId));
    await fake.confirm(payment.id, { outcome: 'requires_action' });
    await fake.confirm(payment.id, { outcome: 'declined' });
    await fake.confirm(payment.id, { outcome: 'succeeded' });

    await deliverEmittedEvents(
      fake,
      options,
      startedAt,
      async (delivery: SimulatedDelivery) => {
        now = delivery.at;
        const verified = await fake.verifyWebhook(delivery.delivery);
        if (verified.status !== 'event') throw new Error('not an event');
        const row = providerEventRow(verified.event);
        if (!row) throw new Error('not storable');
        if ((await dbEvents.recordProviderEvent(row)) === 'repeat') return;
        const [stored] = await client.db
          .select({ id: schema.providerEvents.id })
          .from(schema.providerEvents)
          .where(
            eq(schema.providerEvents.providerEventId, row.providerEventId),
          );
        await run(stored?.id ?? '');
      },
    );
    return {
      attempt: (await attemptOf(world)).status,
      order: (await orderOf(world)).status,
    };
  }

  it('ends where in-order delivery ends, however the events are late, shuffled, or repeated', async () => {
    const inOrder = await deliver({ seed: 1 });
    expect(inOrder).toEqual({ attempt: 'succeeded', order: 'confirmed' });

    for (const options of [
      { seed: 2, maxDelayMs: 3_600_000 },
      { seed: 3, repeats: 2 },
      { seed: 4, repeats: 3, maxDelayMs: 3_600_000 },
      { seed: 5, repeats: 1, maxDelayMs: 60_000 },
    ]) {
      expect(await deliver(options)).toEqual(inOrder);
    }
    expect(raise).not.toHaveBeenCalled();
  });
});
