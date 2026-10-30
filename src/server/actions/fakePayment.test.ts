import { beforeEach, describe, expect, it, vi } from 'vitest';
import { deliverFakeConfirmation } from '@/server/fakePaymentDelivery';
import { PaymentsError } from '@/server/ports/payments';
import { getFakePayments } from '@/server/ports/payments/gateway';

vi.mock('@/server/fakePaymentDelivery', () => ({
  deliverFakeConfirmation: vi.fn(),
}));
vi.mock('@/server/ports/payments/gateway', () => ({
  getFakePayments: vi.fn(),
}));

const { confirmFakePayment } = await import('./fakePayment');

// Behaviours under test (the events and the order are in tests/db/fake-payment-delivery.db.test.ts):
// - a payment the caller holds the client secret of is handed to the delivery with the guest's plan, and the
//   answer follows the plan
// - an unknown payment and a wrong secret get the same answer, and nothing is delivered
// - a payment that cannot take another try, or has vanished, is answered `refused`
// - any other failure is thrown, so the form treats the answer as lost
// - input that does not parse is rejected before the gateway is asked anything

const payment = { id: 'pay_abc', clientSecret: 'pay_abc_secret_xyz' };
const retrieve = vi.fn();

const paying = (plan: unknown, clientSecret = payment.clientSecret) => ({
  paymentId: payment.id,
  clientSecret,
  plan,
});

beforeEach(() => {
  retrieve.mockReset().mockResolvedValue(payment);
  vi.mocked(getFakePayments)
    .mockReset()
    .mockReturnValue({
      retrieve,
    } as unknown as ReturnType<typeof getFakePayments>);
  vi.mocked(deliverFakeConfirmation).mockReset().mockResolvedValue(undefined);
});

describe('confirmFakePayment', () => {
  it.each([
    [{ outcome: 'succeeded', method: 'card' }, { status: 'succeeded' }],
    [{ outcome: 'succeeded', method: 'apple_pay' }, { status: 'succeeded' }],
    [
      { outcome: 'declined', failureCode: 'expired_card' },
      { status: 'declined', failureCode: 'expired_card' },
    ],
    [{ outcome: 'requires_action' }, { status: 'requires_action' }],
  ])('delivers %j and answers %j', async (plan, answer) => {
    await expect(confirmFakePayment(paying(plan))).resolves.toEqual(answer);

    expect(retrieve).toHaveBeenCalledWith({ kind: 'payment', id: payment.id });
    expect(deliverFakeConfirmation).toHaveBeenCalledExactlyOnceWith(
      payment.id,
      plan,
    );
  });

  it('answers a payment that is not there and a wrong secret the same way, and delivers nothing', async () => {
    const plan = { outcome: 'succeeded', method: 'card' };
    retrieve.mockResolvedValueOnce(null);
    const missing = await confirmFakePayment(paying(plan));
    const wrongSecret = await confirmFakePayment(
      paying(plan, `${payment.clientSecret}x`),
    );

    expect(missing).toEqual({ status: 'refused' });
    expect(wrongSecret).toEqual(missing);
    expect(deliverFakeConfirmation).not.toHaveBeenCalled();
  });

  it.each(['not_found', 'invalid_state'] as const)(
    'answers refused when the gateway says %s',
    async (code) => {
      vi.mocked(deliverFakeConfirmation).mockRejectedValueOnce(
        new PaymentsError(code),
      );
      await expect(
        confirmFakePayment(paying({ outcome: 'requires_action' })),
      ).resolves.toEqual({ status: 'refused' });
    },
  );

  it.each([
    ['a provider fault', new PaymentsError('provider_unavailable')],
    ['an event the intake did not take', new Error('not taken')],
  ])(
    'throws on %s, so the form treats the answer as lost',
    async (_name, error) => {
      vi.mocked(deliverFakeConfirmation).mockRejectedValueOnce(error);
      await expect(
        confirmFakePayment(paying({ outcome: 'requires_action' })),
      ).rejects.toBe(error);
    },
  );

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
    await expect(confirmFakePayment(input)).rejects.toThrow();
    expect(getFakePayments).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });
});
