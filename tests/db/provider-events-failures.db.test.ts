import { describe, expect, it, vi } from 'vitest';
import { dueClock } from '../support/dueClock';
import {
  attemptOf,
  clearJobs,
  drain,
  eventOf,
  handle,
  holdOf,
  incoming,
  jobsFor,
  orderOf,
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
// - failed (a try; the hold reopens only while unexpired; the fifth try cancels and voids; a non-pending order changes the attempt only;
//   a terminal attempt never changes), requires_action (the hold's paying_until extended once), canceled
// - refund, transfer, and dispute events are left alone: no retry job, no alert, no try counted

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
