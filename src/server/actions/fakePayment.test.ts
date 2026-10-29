import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createFakePaymentsAdapter } from '@/server/ports/payments/fake';
import type { Payment } from '@/server/ports/payments';

const fixedNow = new Date('2026-10-29T12:00:00.000Z');
let fake = makeFake();

function makeFake() {
  return createFakePaymentsAdapter({
    webhookSecret: 'whsec_fake_0123456789abcdef',
    now: () => fixedNow,
  });
}

vi.mock('@/server/ports/payments/gateway', () => ({
  getFakePayments: () => fake,
}));

const { confirmFakePayment } = await import('./fakePayment');

const orderId = '00000000-0000-4000-8000-000000000001';
const recordId = '00000000-0000-4000-8000-000000000002';

async function createPayment(key = 'pay:one:1'): Promise<Payment> {
  return fake.createPayment({
    idempotencyKey: key,
    amountMinor: 13_000,
    currency: 'USD',
    metadata: { orderId, recordId },
  });
}

const paying = (payment: Payment, plan: unknown) => ({
  paymentId: payment.id,
  clientSecret: payment.clientSecret,
  plan,
});

beforeEach(() => {
  fake = makeFake();
});

describe('confirmFakePayment', () => {
  it('records a card payment and emits payment.succeeded', async () => {
    const payment = await createPayment();
    const result = await confirmFakePayment(
      paying(payment, { outcome: 'succeeded', method: 'card' }),
    );
    expect(result).toEqual({ status: 'succeeded' });
    expect(fake.emittedEvents()).toMatchObject([
      { type: 'payment.succeeded', objectId: payment.id, method: 'card' },
    ]);
  });

  it.each(['apple_pay', 'google_pay'] as const)(
    'records a %s payment with its method',
    async (method) => {
      const payment = await createPayment();
      await confirmFakePayment(
        paying(payment, { outcome: 'succeeded', method }),
      );
      expect(fake.emittedEvents()[0]).toMatchObject({ method });
    },
  );

  it('records a decline with its reason and keeps the payment open for a retry', async () => {
    const payment = await createPayment();
    const result = await confirmFakePayment(
      paying(payment, { outcome: 'declined', failureCode: 'expired_card' }),
    );
    expect(result).toEqual({ status: 'declined', failureCode: 'expired_card' });
    expect(fake.emittedEvents()).toMatchObject([
      { type: 'payment.failed', failureCode: 'expired_card' },
    ]);
    await expect(
      confirmFakePayment(
        paying(payment, { outcome: 'succeeded', method: 'card' }),
      ),
    ).resolves.toEqual({ status: 'succeeded' });
  });

  it('records a 3-D Secure challenge and then its completion', async () => {
    const payment = await createPayment();
    expect(
      await confirmFakePayment(paying(payment, { outcome: 'requires_action' })),
    ).toEqual({ status: 'requires_action' });
    expect(
      await confirmFakePayment(
        paying(payment, { outcome: 'succeeded', method: 'card' }),
      ),
    ).toEqual({ status: 'succeeded' });
    expect(fake.emittedEvents().map((event) => event.type)).toEqual([
      'payment.requires_action',
      'payment.succeeded',
    ]);
  });

  it('answers a payment that is not there and a wrong secret the same way, and records nothing', async () => {
    const payment = await createPayment();
    const plan = { outcome: 'succeeded', method: 'card' };
    const missing = await confirmFakePayment({
      paymentId: 'pay_000000000000000000000000',
      clientSecret: payment.clientSecret,
      plan,
    });
    const wrongSecret = await confirmFakePayment({
      paymentId: payment.id,
      clientSecret: `${payment.clientSecret}x`,
      plan,
    });
    expect(missing).toEqual({ status: 'refused' });
    expect(wrongSecret).toEqual(missing);
    expect(fake.emittedEvents()).toEqual([]);
  });

  it('refuses a payment that has already succeeded, so a second tap cannot pay twice', async () => {
    const payment = await createPayment();
    const plan = { outcome: 'succeeded', method: 'card' };
    await confirmFakePayment(paying(payment, plan));
    await expect(confirmFakePayment(paying(payment, plan))).resolves.toEqual({
      status: 'refused',
    });
    expect(fake.emittedEvents()).toHaveLength(1);
  });

  it('refuses another try once the payment has used them all', async () => {
    const payment = await createPayment();
    const decline = { outcome: 'declined', failureCode: 'card_declined' };
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await confirmFakePayment(paying(payment, decline));
    }
    await expect(confirmFakePayment(paying(payment, decline))).resolves.toEqual(
      { status: 'refused' },
    );
  });

  it('rethrows what it cannot explain, so the form treats the answer as lost', async () => {
    const payment = await createPayment();
    vi.spyOn(fake, 'confirm').mockRejectedValueOnce(new Error('boom'));
    await expect(
      confirmFakePayment(
        paying(payment, { outcome: 'succeeded', method: 'card' }),
      ),
    ).rejects.toThrow('boom');
  });

  it.each([
    ['nothing', undefined],
    [
      'a decline without a reason',
      { paymentId: 'p', clientSecret: 's', plan: { outcome: 'declined' } },
    ],
    [
      'an unknown outcome',
      { paymentId: 'p', clientSecret: 's', plan: { outcome: 'refunded' } },
    ],
  ])('rejects %s before touching the gateway', async (_name, input) => {
    const retrieve = vi.spyOn(fake, 'retrieve');
    await expect(confirmFakePayment(input)).rejects.toThrow();
    expect(retrieve).not.toHaveBeenCalled();
  });
});
