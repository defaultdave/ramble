import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { StartPaymentInput } from '@/lib/checkout';
import type { StartedPayment } from '@/server/db/checkout';
import { PaymentsError, type Payment } from '@/server/ports/payments';
import { testDevice } from '../../tests/deviceFixture';

const mocks = vi.hoisted(() => ({
  consumeRateLimit: vi.fn(),
  startPaymentTx: vi.fn(),
  recordProviderPayment: vi.fn(),
  createPayment: vi.fn(),
  retrieve: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}));

vi.mock(
  'next/headers',
  async () => (await import('../../tests/deviceFixture')).nextHeadersMock,
);
vi.mock('@/server/ports/rate-limit', () => ({
  consumeRateLimit: mocks.consumeRateLimit,
}));
vi.mock('@/server/db/checkout', () => ({
  startPaymentTx: mocks.startPaymentTx,
  recordProviderPayment: mocks.recordProviderPayment,
}));
vi.mock('@/server/ports/payments/gateway', () => ({
  getFakePayments: () => ({
    provider: 'fake',
    createPayment: mocks.createPayment,
    retrieve: mocks.retrieve,
  }),
}));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: mocks.warn, error: mocks.error },
}));

import { startCheckoutPayment } from './checkout';

// Behaviours under test, one per decision, branch or risk:
// - one try is spent on the payment_tries surface for the hold id; a try over the limit is too_many_tries and
//   reaches no data layer or provider; a failed limit store rejects, so nothing is paid (fail closed)
// - a refusal from the data layer is returned as it is, with no provider call
// - an attempt with a provider payment is read again by its id, spends no create, and is not stored again; a
//   payment id the provider no longer knows rejects and creates nothing
// - an attempt an earlier call left without a payment is looked up by Ramble's ids first and created only if
//   the provider has none; a new attempt is created with its key, amount, currency, and Ramble's ids, and stored
// - the provider failing rejects, stores nothing, and returns no secret
// - a failed or refused store of the payment id still returns the client secret and logs the kind and attempt only
// - the answer carries the order, the secret, the provider, and the order token

const device = await testDevice('checkout-door');
const holdId = '3f2504e0-4f89-41d3-9a0c-0305e82c3301';
const input: StartPaymentInput = {
  holdId,
  contact: { email: 'pat@example.com' },
  leadGuestName: 'Pat Smith',
  attendees: {},
  termsDocumentId: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
  newsletterOptIn: false,
};
const order = {
  id: '5a3b7c2e-4f61-4d0e-8a35-9d2f6c1b7e44',
  reference: 'RMB-7K2M9P',
  amountDueMinor: 22_864,
};
const attemptId = 'c9bf9e57-1685-4c89-bafb-ff5af830be8a';
const payment = {
  id: 'pay_1',
  provider: 'fake',
  clientSecret: 'pay_1_secret',
} as Payment;

const started = (
  attempt: Partial<Extract<StartedPayment, { done: false }>['attempt']> = {},
): StartedPayment => ({
  done: false,
  order,
  orderToken: 'order-token',
  attempt: {
    id: attemptId,
    providerKey: `pay:${order.id}:1`,
    amountMinor: 22_864,
    providerPaymentId: null,
    existed: false,
    ...attempt,
  },
});

beforeEach(() => {
  vi.resetAllMocks();
  mocks.consumeRateLimit.mockResolvedValue({ allowed: true, remaining: 4 });
  mocks.startPaymentTx.mockResolvedValue(started());
  mocks.recordProviderPayment.mockResolvedValue(true);
  mocks.createPayment.mockResolvedValue(payment);
  mocks.retrieve.mockResolvedValue(payment);
});

describe('the tries limit', () => {
  it('spends one try for the hold id and passes the parsed form, the device, and the provider on', async () => {
    await startCheckoutPayment(device, input);

    expect(mocks.consumeRateLimit).toHaveBeenCalledWith(
      'payment_tries',
      holdId,
    );
    expect(mocks.startPaymentTx).toHaveBeenCalledWith(
      device,
      expect.objectContaining({ holdId }),
      'fake',
    );
  });

  it('answers too_many_tries over the limit, reaching nothing', async () => {
    mocks.consumeRateLimit.mockResolvedValue({
      allowed: false,
      retryAfterSeconds: 60,
    });

    await expect(startCheckoutPayment(device, input)).resolves.toEqual({
      status: 'too_many_tries',
    });
    expect(mocks.startPaymentTx).not.toHaveBeenCalled();
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
  });

  it('rejects when the limit store fails, so nothing is paid', async () => {
    mocks.consumeRateLimit.mockRejectedValue(new Error('store down'));

    await expect(startCheckoutPayment(device, input)).rejects.toThrow(
      'store down',
    );
    expect(mocks.startPaymentTx).not.toHaveBeenCalled();
  });
});

describe('a refusal from the data layer', () => {
  it('is returned as it is, with no provider call', async () => {
    const result = { status: 'hold_expired', canRehold: true, spacesLeft: 3 };
    mocks.startPaymentTx.mockResolvedValue({ done: true, result });

    await expect(startCheckoutPayment(device, input)).resolves.toBe(result);
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.recordProviderPayment).not.toHaveBeenCalled();
  });
});

describe('the provider', () => {
  it('reads an attempt’s payment by its id and stores nothing', async () => {
    mocks.startPaymentTx.mockResolvedValue(
      started({ providerPaymentId: 'pay_1', existed: true }),
    );

    const result = await startCheckoutPayment(device, input);

    expect(mocks.retrieve).toHaveBeenCalledWith({
      kind: 'payment',
      id: 'pay_1',
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.recordProviderPayment).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'requires_payment' });
  });

  it('rejects, and creates nothing, for a payment id the provider does not know', async () => {
    mocks.startPaymentTx.mockResolvedValue(
      started({ providerPaymentId: 'pay_gone', existed: true }),
    );
    mocks.retrieve.mockResolvedValue(null);

    await expect(startCheckoutPayment(device, input)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.recordProviderPayment).not.toHaveBeenCalled();
  });

  it('looks an earlier call’s attempt up by Ramble’s ids and stores what it finds, creating nothing', async () => {
    mocks.startPaymentTx.mockResolvedValue(started({ existed: true }));

    await startCheckoutPayment(device, input);

    expect(mocks.retrieve).toHaveBeenCalledWith({
      kind: 'payment',
      metadata: { orderId: order.id, recordId: attemptId },
    });
    expect(mocks.createPayment).not.toHaveBeenCalled();
    expect(mocks.recordProviderPayment).toHaveBeenCalledWith(
      device,
      attemptId,
      'pay_1',
    );
  });

  it('creates for an earlier call’s attempt the provider has no payment for', async () => {
    mocks.startPaymentTx.mockResolvedValue(started({ existed: true }));
    mocks.retrieve.mockResolvedValue(null);

    await startCheckoutPayment(device, input);

    expect(mocks.createPayment).toHaveBeenCalledTimes(1);
  });

  it('creates for a new attempt with its key, amount, currency, and Ramble’s ids, and stores the id', async () => {
    await startCheckoutPayment(device, input);

    expect(mocks.retrieve).not.toHaveBeenCalled();
    expect(mocks.createPayment).toHaveBeenCalledWith({
      idempotencyKey: `pay:${order.id}:1`,
      amountMinor: 22_864,
      currency: 'USD',
      metadata: { orderId: order.id, recordId: attemptId },
    });
    expect(mocks.recordProviderPayment).toHaveBeenCalledWith(
      device,
      attemptId,
      'pay_1',
    );
  });

  it('rejects when the provider fails, storing nothing', async () => {
    mocks.createPayment.mockRejectedValue(
      new PaymentsError('provider_unavailable'),
    );

    await expect(startCheckoutPayment(device, input)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(mocks.recordProviderPayment).not.toHaveBeenCalled();
  });
});

describe('storing the payment id', () => {
  it('still returns the client secret when the write fails, logging the kind and the attempt only', async () => {
    mocks.recordProviderPayment.mockRejectedValue(
      new TypeError('secret detail: params ($1, $2)'),
    );

    const result = await startCheckoutPayment(device, input);

    expect(result).toMatchObject({
      status: 'requires_payment',
      payment: { clientSecret: 'pay_1_secret' },
    });
    expect(mocks.error).toHaveBeenCalledTimes(1);
    expect(mocks.error).toHaveBeenCalledWith('Provider payment id not stored', {
      attemptId,
      errorKind: 'TypeError',
    });
  });

  it('still returns the client secret when the write is refused, with a warning', async () => {
    mocks.recordProviderPayment.mockResolvedValue(false);

    const result = await startCheckoutPayment(device, input);

    expect(result).toMatchObject({ status: 'requires_payment' });
    expect(mocks.warn).toHaveBeenCalledWith('Provider payment id not stored', {
      attemptId,
    });
    expect(mocks.error).not.toHaveBeenCalled();
  });
});

describe('the answer', () => {
  it('carries the order, the provider, the secret, the amount, and the order token', async () => {
    await expect(startCheckoutPayment(device, input)).resolves.toEqual({
      status: 'requires_payment',
      orderId: order.id,
      reference: order.reference,
      payment: { provider: 'fake', clientSecret: 'pay_1_secret' },
      amountDueMinor: 22_864,
      orderToken: 'order-token',
    });
  });
});
