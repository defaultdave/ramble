import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { paymentLimits } from '@/lib/payments';
import {
  ProcessProviderEventPayloadSchema,
  processProviderEventKind,
  providerEventRow,
} from '@/lib/providerEvents';
import type { ConfirmOrder } from '@/server/db/confirmOrder';
import { dueClock } from '../support/dueClock';
import {
  attemptOf,
  clearJobs,
  client,
  confirmed,
  confirmsOrder,
  dbEvents,
  drain,
  eventOf,
  handle,
  incoming,
  jobModule,
  jobsFor,
  orderOf,
  run,
  schema,
  seedWorld,
  setupProviderEventsDatabase,
  store,
  unavailable,
} from './providerEventFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupProviderEventsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - intake stores an event once with the ids from its metadata and queues exactly one job; a repeat writes and
//   queues nothing
// - payment.succeeded from a seeded order, attempt, and hold (design doc 4.2.3 "What each event does"):
//   on the live attempt (attempt succeeded, confirm called with the amount; the stand-in confirm seam leaves the event
//   unprocessed with no alert; a leftover succeeded attempt is confirmed again; an order already settled is a no-op),
//   on a canceled attempt and on another payment (one alert, event left for the refund unit),
//   a payment matched by record id gets its provider id stored

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
