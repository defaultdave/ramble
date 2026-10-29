import { describe, expect, it } from 'vitest';
import { getFakePayments } from './gateway';

describe('getFakePayments', () => {
  it('is one gateway for the whole process', () => {
    expect(getFakePayments()).toBe(getFakePayments());
  });

  it('is the fake provider, and holds the payments it creates', async () => {
    const fake = getFakePayments();
    const payment = await fake.createPayment({
      idempotencyKey: 'pay:gateway-test:1',
      amountMinor: 5_000,
      currency: 'USD',
      metadata: {
        orderId: '00000000-0000-4000-8000-0000000000a1',
        recordId: '00000000-0000-4000-8000-0000000000a2',
      },
    });
    expect(fake.provider).toBe('fake');
    await expect(
      getFakePayments().retrieve({ kind: 'payment', id: payment.id }),
    ).resolves.toMatchObject({ id: payment.id });
  });

  it('signs deliveries it will verify, and refuses ones signed with another secret', async () => {
    const fake = getFakePayments();
    const delivery = fake.signBody(
      JSON.stringify({ id: 'evt_x', provider: 'fake', type: 'ignored.type' }),
    );
    await expect(fake.verifyWebhook(delivery)).resolves.toMatchObject({
      status: 'ignored',
    });
    const forged = {
      ...delivery,
      signature: delivery.signature.replace(/v1=.{4}/, 'v1=0000'),
    };
    await expect(fake.verifyWebhook(forged)).rejects.toMatchObject({
      code: 'invalid_signature',
    });
  });
});
