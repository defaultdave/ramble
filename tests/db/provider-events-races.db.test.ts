import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { providerEventRow } from '@/lib/providerEvents';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import {
  deliverEmittedEvents,
  type SimulatedDelivery,
} from '../support/paymentEvents';
import { backendPid, waitUntilBlocked } from './harness';
import {
  attemptOf,
  client,
  confirmed,
  dbEvents,
  eventOf,
  incoming,
  orderOf,
  run,
  schema,
  seedWorld,
  setupProviderEventsDatabase,
  side,
  store,
} from './providerEventFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupProviderEventsDatabase(raise);

// Behaviours under test, one per decision, branch, or risk:
// - events for one order are processed one at a time: a handler waits for the order's advisory lock and judges the state the
//   lock holder left (fails if the lock or the locked read is removed), and the session and hold locks are held while it
//   waits for the order row (the one lock order)
// - late, out of order, and repeated delivery through the simulator ends in the same state as in-order delivery

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
    await waitUntilBlocked(side, {
      blockedBy: await backendPid(holder),
    });
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
    await waitUntilBlocked(side, {
      blockedBy: await backendPid(holder),
      count: 2,
    });
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
    await waitUntilBlocked(side, {
      blockedBy: await backendPid(holder),
    });
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
