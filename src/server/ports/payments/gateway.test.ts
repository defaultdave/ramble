import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  readFakeGatewayState,
  withFakeGatewayState,
} from '@/server/db/fakeGateway';
import { getFakePayments, getPaymentsPort } from './gateway';

vi.mock('@/server/db/fakeGateway', () => ({
  readFakeGatewayState: vi.fn(),
  withFakeGatewayState: vi.fn(),
}));

// Behaviours under test (what needs a database is in tests/db/fake-gateway.db.test.ts):
// - the port the webhook route and the job use is the fake gateway, one object for the whole process
// - signing and checking a delivery touch no database, so a forged delivery costs no query
// - a delivery signed with another secret is refused
// - a write goes through the locked state and a read through the unlocked one

const eventBody = JSON.stringify({
  id: 'evt_x',
  provider: 'fake',
  type: 'ignored.type',
});

const payment = {
  idempotencyKey: 'pay:gateway-test:1',
  amountMinor: 5_000,
  currency: 'USD' as const,
  metadata: {
    orderId: '00000000-0000-4000-8000-0000000000a1',
    recordId: '00000000-0000-4000-8000-0000000000a2',
  },
};

beforeEach(() => {
  vi.mocked(readFakeGatewayState).mockReset();
  vi.mocked(withFakeGatewayState).mockReset();
});

describe('getPaymentsPort', () => {
  it('is the fake gateway until another adapter is configured', () => {
    expect(getPaymentsPort()).toBe(getFakePayments());
    expect(getPaymentsPort().provider).toBe('fake');
  });
});

describe('getFakePayments', () => {
  it('is one gateway for the whole process', () => {
    expect(getFakePayments()).toBe(getFakePayments());
  });

  it('signs deliveries it will verify, and refuses ones signed with another secret', async () => {
    const fake = getFakePayments();
    const delivery = fake.signBody(eventBody);
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

  it('checks a delivery without asking the database anything', async () => {
    const fake = getFakePayments();
    const delivery = fake.signBody(eventBody);
    await fake.verifyWebhook(delivery);
    await expect(
      fake.verifyWebhook({ ...delivery, signature: 'nope' }),
    ).rejects.toMatchObject({ code: 'invalid_signature' });

    expect(readFakeGatewayState).not.toHaveBeenCalled();
    expect(withFakeGatewayState).not.toHaveBeenCalled();
  });

  it('runs a write on the state it holds under the row lock', async () => {
    vi.mocked(withFakeGatewayState).mockImplementation(async (work) => {
      const { createFakePaymentsState } = await import('./fake');
      return work(createFakePaymentsState());
    });

    const created = await getFakePayments().createPayment(payment);

    expect(created).toMatchObject({ provider: 'fake', status: 'created' });
    expect(withFakeGatewayState).toHaveBeenCalledTimes(1);
    expect(readFakeGatewayState).not.toHaveBeenCalled();
  });

  it('reads without the lock, and finds nothing in an empty gateway', async () => {
    const { createFakePaymentsState } = await import('./fake');
    vi.mocked(readFakeGatewayState).mockResolvedValue(
      createFakePaymentsState(),
    );

    await expect(
      getFakePayments().retrieve({ kind: 'payment', id: 'pay_none' }),
    ).resolves.toBeNull();
    await expect(getFakePayments().getBalance()).resolves.toEqual({
      availableMinor: 0,
      currency: 'USD',
    });
    expect(withFakeGatewayState).not.toHaveBeenCalled();
  });

  it('lets a refusal from the state it loaded through, as the adapter words it', async () => {
    vi.mocked(withFakeGatewayState).mockImplementation(async (work) => {
      const { createFakePaymentsState } = await import('./fake');
      return work(createFakePaymentsState());
    });

    await expect(
      getFakePayments().confirm('pay_none', { outcome: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'not_found' });
  });
});
