import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { Payment } from '@/server/ports/payments';
import { setEnv } from '../email/testEnv';
import { dueClock } from '../support/dueClock';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { seedBooking } from './confirmOrderFixtures';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
const scheduled = vi.hoisted((): (() => Promise<void>)[] => []);
const logged = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
const intake = vi.hoisted(() => ({ budget: vi.fn() }));
const drainer = vi.hoisted(() => ({ drainJobs: vi.fn() }));

vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise: vi.fn() } }));
vi.mock('@/server/monitoring/logger', () => ({ logger: logged }));
vi.mock('@/server/db/refundPath', () => ({
  takeRefundPath: vi.fn().mockResolvedValue({ status: 'unavailable' }),
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
// A request would run the task after its response; the test runs it when it says so.
vi.mock('next/server', async (original) => ({
  ...(await original<typeof import('next/server')>()),
  after: (task: () => Promise<void>) => scheduled.push(task),
}));
// A clock a few seconds ahead, so a job enqueued on the database's clock is due when the drain looks.
vi.mock('@/server/ports/clock', async (original) => ({
  ...(await original<typeof import('@/server/ports/clock')>()),
  systemClock: (await import('../support/dueClock')).dueClock,
}));
vi.mock('@/server/ports/rate-limit', async (original) => {
  const actual = await original<typeof import('@/server/ports/rate-limit')>();
  intake.budget.mockImplementation(actual.consumeRateLimit);
  return { ...actual, consumeRateLimit: intake.budget };
});
vi.mock('@/server/jobs/drain', async (original) => {
  const actual = await original<typeof import('@/server/jobs/drain')>();
  drainer.drainJobs.mockImplementation(actual.drainJobs);
  return { ...actual, drainJobs: drainer.drainJobs };
});

// What happens after a guest taps Pay on the fake gateway, through `confirmFakePayment` and the real intake, jobs, and
// order confirmation. The task `after` would run is run by the test. Behaviours under test, one per decision or risk:
// - a payment that succeeds: the action returns with the order still pending and one task scheduled; running the task
//   confirms the order with its seat, hold, ledger rows, transfer, and the guest and host emails, from one stored event
// - a second Pay on the same payment is refused and adds no event, no stored event, and no task
// - a decline delivers payment.failed (the attempt records the failed try and the order is not confirmed) and the
//   guest's next try then confirms the order
// - 3-D Secure delivers payment.requires_action, then the success confirms the order
// - a delivery the intake refuses throws without naming the payment or the body in the log, schedules no drain, and
//   leaves the fake holding the payment with its event
// - a drain that fails does not fail the action and is logged by kind alone; the job stays due for the next drain

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let action: typeof import('@/server/actions/fakePayment');
let gateway: typeof import('@/server/ports/payments/gateway');
let data: typeof import('@/server/db/fakeGateway');
let schema: typeof import('@/server/db/schema');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  action = await import('@/server/actions/fakePayment');
  gateway = await import('@/server/ports/payments/gateway');
  data = await import('@/server/db/fakeGateway');
  schema = await import('@/server/db/schema');
  parents = await createOrderParents(client.db, 'delivery');
  await client.db
    .update(schema.hosts)
    .set({ notificationEmail: 'bookings@harborlight.example' })
    .where(eq(schema.hosts.id, parents.hostId));
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
});

beforeEach(async () => {
  scheduled.length = 0;
  logged.warn.mockClear();
  logged.error.mockClear();
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM messages`);
  await client.db.execute(sql`DELETE FROM provider_events`);
  await client.db.execute(sql`DELETE FROM fake_gateway_state`);
});

type World = Awaited<ReturnType<typeof seedBooking>>;

/** A booking whose guest has been handed the payment form: an attempt, and the fake's payment for it. */
async function atThePaymentForm() {
  const world = await seedBooking(client.db, parents);
  await client.db
    .update(schema.paymentAttempts)
    .set({ status: 'created', providerPaymentId: null })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  const payment = await gateway.getFakePayments().createPayment({
    idempotencyKey: `pay:${world.orderId}:1`,
    amountMinor: world.amountDueMinor,
    currency: 'USD',
    metadata: { orderId: world.orderId, recordId: world.attemptId },
  });
  await client.db
    .update(schema.paymentAttempts)
    .set({ providerPaymentId: payment.id })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  return { world, payment };
}

const pay = (payment: Payment, plan: unknown) =>
  action.confirmFakePayment({
    paymentId: payment.id,
    clientSecret: payment.clientSecret,
    plan,
  });
const card = { outcome: 'succeeded', method: 'card' };

/** Runs what the response left for after it, as the server does, one task at a time. */
async function runAfterTasks() {
  for (const task of scheduled.splice(0)) await task();
}

async function orderOf(world: World) {
  const [order] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  const [attempt] = await client.db
    .select()
    .from(schema.paymentAttempts)
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  const [session] = await client.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, world.sessionId));
  if (!order || !attempt || !session) throw new Error('missing rows');
  return { order, attempt, session };
}

const storedEvents = () =>
  client.db
    .select({
      type: schema.providerEvents.type,
      processedAt: schema.providerEvents.processedAt,
    })
    .from(schema.providerEvents);

describe('after Pay', () => {
  it('confirms the paid order from one stored event once the scheduled drain has run', async () => {
    const { world, payment } = await atThePaymentForm();

    await expect(pay(payment, card)).resolves.toEqual({ status: 'succeeded' });

    expect((await orderOf(world)).order.status).toBe('pending_payment');
    expect(await storedEvents()).toMatchObject([
      { type: 'payment.succeeded', processedAt: null },
    ]);
    expect(scheduled).toHaveLength(1);

    await runAfterTasks();

    const { order, attempt, session } = await orderOf(world);
    expect(order.status).toBe('confirmed');
    expect(attempt.status).toBe('succeeded');
    expect(session.seatsSold).toBe(2);
    const [hold] = await client.db
      .select({ status: schema.holds.status })
      .from(schema.holds)
      .where(eq(schema.holds.id, world.holdId));
    expect(hold?.status).toBe('converted');
    const ledger = await client.db
      .select({ entryType: schema.ledgerEntries.entryType })
      .from(schema.ledgerEntries)
      .where(eq(schema.ledgerEntries.orderId, world.orderId));
    expect(ledger.map((row) => row.entryType)).toEqual(
      expect.arrayContaining(['processing_fee']),
    );
    expect(ledger.length).toBeGreaterThan(1);
    expect(
      await client.db
        .select()
        .from(schema.transfers)
        .where(eq(schema.transfers.orderId, world.orderId)),
    ).toHaveLength(1);
    const emailJobs = await client.db.execute<{ status: string }>(
      sql`SELECT status FROM jobs WHERE payload->>'orderId' = ${world.orderId}`,
    );
    expect(emailJobs.rows).toHaveLength(2);
    expect(emailJobs.rows.every((row) => row.status === 'succeeded')).toBe(
      true,
    );
    const mail = await client.db.select().from(schema.messages);
    expect(mail.map((m) => m.recipient).toSorted()).toEqual([
      'bookings@harborlight.example',
      'pat@example.com',
    ]);
    expect(await storedEvents()).toHaveLength(1);
  });

  it('refuses a second Pay on a paid payment and adds no event', async () => {
    const { world, payment } = await atThePaymentForm();
    await pay(payment, card);
    await runAfterTasks();

    await expect(pay(payment, card)).resolves.toEqual({ status: 'refused' });

    expect(scheduled).toHaveLength(0);
    expect(await storedEvents()).toHaveLength(1);
    expect((await data.readFakeGatewayState()).events).toHaveLength(1);
    expect((await orderOf(world)).order.status).toBe('confirmed');
  });

  it('delivers a decline, leaves the order open, and confirms it on the guest next try', async () => {
    const { world, payment } = await atThePaymentForm();

    await expect(
      pay(payment, { outcome: 'declined', failureCode: 'expired_card' }),
    ).resolves.toEqual({ status: 'declined', failureCode: 'expired_card' });
    await runAfterTasks();

    const declined = await orderOf(world);
    expect(declined.attempt).toMatchObject({
      status: 'failed_try',
      failedTries: 1,
      failureCode: 'expired_card',
    });
    expect(declined.order.status).not.toBe('confirmed');
    expect(await storedEvents()).toMatchObject([{ type: 'payment.failed' }]);

    await expect(pay(payment, card)).resolves.toEqual({ status: 'succeeded' });
    await runAfterTasks();

    expect((await orderOf(world)).order.status).toBe('confirmed');
    expect(
      (await storedEvents()).map((event) => event.type).toSorted(),
    ).toEqual(['payment.failed', 'payment.succeeded']);
  });

  it('delivers a 3-D Secure challenge, then the success that follows it', async () => {
    const { world, payment } = await atThePaymentForm();

    await expect(pay(payment, { outcome: 'requires_action' })).resolves.toEqual(
      { status: 'requires_action' },
    );
    await runAfterTasks();

    const challenged = await orderOf(world);
    expect(challenged.attempt.status).toBe('requires_action');
    expect(challenged.order.status).not.toBe('confirmed');

    await expect(pay(payment, card)).resolves.toEqual({ status: 'succeeded' });
    await runAfterTasks();

    expect((await orderOf(world)).order.status).toBe('confirmed');
    expect(
      (await storedEvents()).map((event) => event.type).toSorted(),
    ).toEqual(['payment.requires_action', 'payment.succeeded']);
  });

  it('throws when the intake refuses the delivery, logging only the kind, and drains nothing', async () => {
    const { world, payment } = await atThePaymentForm();
    intake.budget.mockResolvedValueOnce({
      allowed: false,
      retryAfterSeconds: 7,
    });

    await expect(pay(payment, card)).rejects.toThrow(
      'The fake payment event was not taken',
    );

    expect(logged.error).toHaveBeenCalledExactlyOnceWith(
      'fake payment delivery refused',
      { kind: 'delivery_refused', status: 429 },
    );
    const logs = JSON.stringify([
      logged.error.mock.calls,
      logged.warn.mock.calls,
    ]);
    expect(logs).not.toContain(payment.id);
    expect(logs).not.toContain(payment.clientSecret);
    expect(scheduled).toHaveLength(0);
    expect(await storedEvents()).toEqual([]);
    expect((await orderOf(world)).order.status).toBe('pending_payment');
    const held = await data.readFakeGatewayState();
    expect(held.payments.get(payment.id)?.status).toBe('succeeded');
    expect(held.events).toHaveLength(1);
  });

  it('does not fail the action when the drain fails, and leaves the job due', async () => {
    const { world, payment } = await atThePaymentForm();
    drainer.drainJobs.mockRejectedValueOnce(new TypeError('connection lost'));

    await expect(pay(payment, card)).resolves.toEqual({ status: 'succeeded' });
    await expect(runAfterTasks()).resolves.toBeUndefined();

    expect(logged.error).toHaveBeenCalledExactlyOnceWith(
      'fake payment drain failed',
      { errorKind: 'TypeError' },
    );
    expect(JSON.stringify(logged.error.mock.calls)).not.toContain(
      'connection lost',
    );
    expect((await orderOf(world)).order.status).toBe('pending_payment');
    const due = await client.db.execute<{ status: string }>(
      sql`SELECT status FROM jobs WHERE kind = 'process-provider-event'`,
    );
    expect(due.rows).toMatchObject([{ status: 'pending' }]);

    await drainer.drainJobs(dueClock);
    expect((await orderOf(world)).order.status).toBe('confirmed');
  });
});
