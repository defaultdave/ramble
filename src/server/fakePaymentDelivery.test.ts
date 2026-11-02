import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fakeDrainLeadMs, fakeDrainWaitMs } from '@/lib/fakePayment';

const mocks = vi.hoisted(() => ({
  after: vi.fn(),
  drainJobs: vi.fn(),
  takePaymentWebhook: vi.fn(),
  confirm: vi.fn(),
  lastEventFor: vi.fn(),
  signWebhook: vi.fn(),
  logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
}));

vi.mock('next/server', () => ({ after: mocks.after }));
vi.mock('@/server/jobs/drain', () => ({ drainJobs: mocks.drainJobs }));
vi.mock('@/server/monitoring/logger', () => ({ logger: mocks.logger }));
vi.mock('@/server/paymentWebhook', () => ({
  takePaymentWebhook: mocks.takePaymentWebhook,
  signatureHeader: 'x-ramble-signature',
}));
vi.mock('@/server/ports/payments/gateway', () => ({
  getFakePayments: () => ({
    confirm: mocks.confirm,
    lastEventFor: mocks.lastEventFor,
    signWebhook: mocks.signWebhook,
  }),
}));
vi.mock('@/server/ports/clock', async () => {
  const { fixedClock } = await vi.importActual<
    typeof import('@/server/ports/clock/fixed')
  >('@/server/ports/clock/fixed');
  return {
    fixedClock,
    systemClock: { now: () => new Date('2026-10-30T12:00:00.000Z') },
  };
});

const { deliverFakeConfirmation } = await import('./fakePaymentDelivery');

// Behaviours under test (the order and the jobs are in tests/db/fake-payment-delivery.db.test.ts):
// - the event the gateway confirmed is signed and sent to the intake as a POST with the signature header and body
// - a 2xx answer starts one drain as a clock the lead ahead of now, hands that same promise to `after`, and waits for it
// - a drain that never finishes holds the reply for the wait and no longer, and leaves no timer behind
// - a drain that finishes leaves no timer behind
// - a drain that fails does not fail the reply, is logged by name only, and `after` gets a promise that resolves
// - an intake outcome other than accepted throws without naming the payment, logs only the kinds, and starts no drain
// - a retried success delivers the event the payment already emitted instead of confirming again
// - a retry that is not a success, or of a payment whose last event is not a success, confirms as usual
// - a confirmation the gateway refuses reaches the intake not at all

const plan = { outcome: 'succeeded', method: 'card' } as const;
const event = { id: 'evt_1', objectId: 'pay_1' };
const delivery = { rawBody: '{"id":"evt_1"}', signature: 't=1,v1=abc' };

beforeEach(() => {
  vi.useFakeTimers();
  for (const mock of [
    mocks.after,
    mocks.drainJobs,
    mocks.takePaymentWebhook,
    mocks.confirm,
    mocks.lastEventFor,
    mocks.signWebhook,
    mocks.logger.error,
  ]) {
    mock.mockReset();
  }
  mocks.confirm.mockResolvedValue({ payment: { id: 'pay_1' }, event });
  mocks.signWebhook.mockReturnValue(delivery);
  mocks.lastEventFor.mockResolvedValue(null);
  mocks.takePaymentWebhook.mockResolvedValue({ kind: 'accepted' });
  mocks.drainJobs.mockResolvedValue({ claimed: 0 });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('deliverFakeConfirmation', () => {
  it('signs the confirmed event and posts it to the intake with its signature', async () => {
    await deliverFakeConfirmation('pay_1', plan);

    expect(mocks.confirm).toHaveBeenCalledWith('pay_1', plan);
    expect(mocks.signWebhook).toHaveBeenCalledWith(event);
    const request = mocks.takePaymentWebhook.mock.calls[0]?.[0] as Request;
    expect(request.method).toBe('POST');
    expect(request.headers.get('x-ramble-signature')).toBe(delivery.signature);
    expect(await request.text()).toBe(delivery.rawBody);
  });

  it('drains as a clock the lead ahead of now and hands that drain to after', async () => {
    const drained = Promise.resolve({ claimed: 1 });
    mocks.drainJobs.mockReturnValue(drained);

    await deliverFakeConfirmation('pay_1', plan);

    expect(mocks.drainJobs).toHaveBeenCalledOnce();
    const [clock] = mocks.drainJobs.mock.calls[0] as [{ now(): Date }];
    expect(clock.now().getTime()).toBe(
      new Date('2026-10-30T12:00:00.000Z').getTime() + fakeDrainLeadMs,
    );
    expect(mocks.after).toHaveBeenCalledExactlyOnceWith(drained);
  });

  it('leaves no timer behind once the drain has finished', async () => {
    await deliverFakeConfirmation('pay_1', plan);

    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops waiting for a drain that never finishes after the wait, and leaves no timer behind', async () => {
    mocks.drainJobs.mockReturnValue(new Promise(() => undefined));
    let replied = false;
    const reply = deliverFakeConfirmation('pay_1', plan).then(() => {
      replied = true;
    });

    await vi.advanceTimersByTimeAsync(fakeDrainWaitMs - 1);
    expect(replied).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await reply;

    expect(replied).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('replies normally when the drain fails, logs its name, and hands after a promise that resolves', async () => {
    mocks.drainJobs.mockReturnValue(
      Promise.reject(new TypeError('connection lost')),
    );

    await expect(
      deliverFakeConfirmation('pay_1', plan),
    ).resolves.toBeUndefined();

    expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith(
      'fake payment drain failed',
      { errorName: 'TypeError' },
    );
    const [handed] = mocks.after.mock.calls[0] as [Promise<unknown>];
    await expect(handed).resolves.toBeUndefined();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('delivers the event a paid payment already emitted when the guest confirms again', async () => {
    const earlier = {
      id: 'evt_1',
      type: 'payment.succeeded',
      objectId: 'pay_1',
    };
    mocks.lastEventFor.mockResolvedValue(earlier);

    await deliverFakeConfirmation('pay_1', plan);

    expect(mocks.confirm).not.toHaveBeenCalled();
    expect(mocks.signWebhook).toHaveBeenCalledWith(earlier);
    expect(mocks.drainJobs).toHaveBeenCalledOnce();
  });

  it.each([
    [
      'a payment whose last event is a decline',
      plan,
      { type: 'payment.failed' },
    ],
    ['a payment with no event', plan, null],
    [
      'a decline, whatever the last event is',
      { outcome: 'declined' },
      { type: 'payment.succeeded' },
    ],
  ])('confirms as usual for %s', async (_name, retryPlan, last) => {
    mocks.lastEventFor.mockResolvedValue(last);

    await deliverFakeConfirmation('pay_1', retryPlan as typeof plan);

    expect(mocks.confirm).toHaveBeenCalledWith('pay_1', retryPlan);
    expect(mocks.signWebhook).toHaveBeenCalledWith(event);
  });

  it.each(['too_large', 'refused', 'over_budget', 'unstorable'] as const)(
    'throws without naming the payment when the intake outcome is %s, and starts no drain',
    async (kind) => {
      mocks.takePaymentWebhook.mockResolvedValue({ kind });

      await expect(deliverFakeConfirmation('pay_1', plan)).rejects.toThrow(
        'The fake payment event was not taken',
      );

      expect(mocks.logger.error).toHaveBeenCalledExactlyOnceWith(
        'fake payment delivery refused',
        { kind: 'delivery_refused', outcome: kind },
      );
      expect(JSON.stringify(mocks.logger.error.mock.calls)).not.toContain(
        'pay_1',
      );
      expect(mocks.drainJobs).not.toHaveBeenCalled();
      expect(mocks.after).not.toHaveBeenCalled();
    },
  );

  it('sends nothing to the intake when the gateway refuses the confirmation', async () => {
    mocks.confirm.mockRejectedValue(new Error('refused'));

    await expect(deliverFakeConfirmation('pay_1', plan)).rejects.toThrow(
      'refused',
    );

    expect(mocks.takePaymentWebhook).not.toHaveBeenCalled();
    expect(mocks.drainJobs).not.toHaveBeenCalled();
  });
});
