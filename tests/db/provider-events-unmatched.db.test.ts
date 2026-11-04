import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { paymentLimits } from '@/lib/payments';
import {
  alertAfterEventAttempts,
  type IncomingProviderEvent,
} from '@/lib/providerEvents';
import { backoffSeconds } from '@/lib/jobs';
import {
  attemptOf,
  client,
  eventOf,
  gateway,
  handle,
  incoming,
  jobModule,
  jobsFor,
  run,
  schema,
  seedWorld,
  setupProviderEventsDatabase,
  store,
} from './providerEventFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupProviderEventsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - an event with no order id is matched through the provider; still unmatched it is retried with backoff, alerts on the 5th try
//   once, and gives up with a second alert on the last

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
    const fake = gateway.getFakePayments();
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
