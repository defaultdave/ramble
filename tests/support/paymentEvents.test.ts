import { describe, expect, it, vi } from 'vitest';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import { deliverEmittedEvents, type SimulatedDelivery } from './paymentEvents';

const startedAt = new Date('2026-10-29T12:00:00.000Z');
const orderId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';

/** A fake whose clock the test moves, so a late delivery is judged against the time it arrives. */
async function payAfterChallenge() {
  let now = startedAt;
  const fake = createFakePaymentsAdapter({
    webhookSecret: 'whsec_fake_0123456789abcdef',
    now: () => now,
  });
  const payment = await fake.createPayment({
    idempotencyKey: 'pay:simulator:1',
    amountMinor: 13_000,
    currency: 'USD',
    metadata: { orderId, recordId },
  });
  await fake.confirm(payment.id, { outcome: 'requires_action' });
  await fake.confirm(payment.id, { outcome: 'declined' });
  await fake.confirm(payment.id, { outcome: 'succeeded' });
  return {
    fake,
    setNow: (value: Date) => {
      now = value;
    },
  };
}

const collect =
  (into: SimulatedDelivery[]) => (delivery: SimulatedDelivery) => {
    into.push(delivery);
  };

describe('deliverEmittedEvents', () => {
  it('delivers each emitted event once, as sent, with no options but a seed', async () => {
    const { fake } = await payAfterChallenge();
    const seen: SimulatedDelivery[] = [];
    await deliverEmittedEvents(fake, { seed: 1 }, startedAt, collect(seen));
    expect(seen.map((step) => step.event.type)).toEqual([
      'payment.requires_action',
      'payment.failed',
      'payment.succeeded',
    ]);
    expect(seen.map((step) => step.at)).toEqual([
      startedAt,
      startedAt,
      startedAt,
    ]);
  });

  it('repeats every event, carrying the same event id each time', async () => {
    const { fake } = await payAfterChallenge();
    const seen: SimulatedDelivery[] = [];
    await deliverEmittedEvents(
      fake,
      { seed: 1, repeats: 2 },
      startedAt,
      collect(seen),
    );
    expect(seen).toHaveLength(9);
    expect(new Set(seen.map((step) => step.event.id)).size).toBe(3);
    for (const step of seen) {
      expect(JSON.parse(step.delivery.rawBody)).toMatchObject({
        id: step.event.id,
      });
    }
  });

  it('delivers late and out of order, signing each delivery as of the time it arrives', async () => {
    const { fake, setNow } = await payAfterChallenge();
    const arrived: SimulatedDelivery[] = [];
    const verified: string[] = [];
    const orders = new Set<string>();
    for (let seed = 0; seed < 10; seed += 1) {
      const seen: SimulatedDelivery[] = [];
      await deliverEmittedEvents(
        fake,
        { seed, maxDelayMs: 3_600_000 },
        startedAt,
        async (step) => {
          setNow(step.at);
          const result = await fake.verifyWebhook(step.delivery);
          if (result.status === 'event') verified.push(result.event.id);
          seen.push(step);
        },
      );
      orders.add(seen.map((step) => step.sentIndex).join());
      arrived.push(...seen);
      setNow(startedAt);
    }
    expect(orders.size).toBeGreaterThan(1);
    expect(verified).toHaveLength(30);
    const latest = Math.max(...arrived.map((step) => step.at.getTime()));
    expect(latest).toBeLessThanOrEqual(startedAt.getTime() + 3_600_000);
    expect(latest).toBeGreaterThan(startedAt.getTime() + 300_000);
  });

  it('plays the same sequence for the same seed', async () => {
    const { fake } = await payAfterChallenge();
    const run = async (seed: number) => {
      const seen: SimulatedDelivery[] = [];
      await deliverEmittedEvents(
        fake,
        { seed, repeats: 1, maxDelayMs: 60_000 },
        startedAt,
        collect(seen),
      );
      return seen.map((step) => [step.event.id, step.attempt, step.delayMs]);
    };
    expect(await run(5)).toEqual(await run(5));
    expect(await run(5)).not.toEqual(await run(6));
  });

  it('waits for each handler before the next delivery and starts no timers', async () => {
    const { fake } = await payAfterChallenge();
    vi.useFakeTimers();
    try {
      const log: string[] = [];
      await deliverEmittedEvents(
        fake,
        { seed: 1, maxDelayMs: 86_400_000 },
        startedAt,
        async (step) => {
          log.push(`start ${String(step.sentIndex)}`);
          await Promise.resolve();
          log.push(`end ${String(step.sentIndex)}`);
        },
      );
      expect(log.filter((line) => line.startsWith('start'))).toHaveLength(3);
      for (let index = 0; index < log.length; index += 2) {
        expect(log[index]?.replace('start', 'end')).toBe(log[index + 1]);
      }
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('refuses a plan over the caps before delivering anything', async () => {
    const { fake } = await payAfterChallenge();
    const handle = vi.fn();
    await expect(
      deliverEmittedEvents(fake, { seed: 1, repeats: 6 }, startedAt, handle),
    ).rejects.toThrow(RangeError);
    expect(handle).not.toHaveBeenCalled();
  });

  it('stops at the first handler that throws', async () => {
    const { fake } = await payAfterChallenge();
    const handle = vi.fn().mockRejectedValue(new Error('intake down'));
    await expect(
      deliverEmittedEvents(fake, { seed: 1 }, startedAt, handle),
    ).rejects.toThrow('intake down');
    expect(handle).toHaveBeenCalledTimes(1);
  });
});
