import { count, eq } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import type { StartPaymentResult } from '@/lib/checkout';
import { orders, paymentAttempts } from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  PaymentsError,
  type Payment,
  type PaymentsPort,
} from '@/server/ports/payments';
import {
  createFakePaymentsAdapter,
  type FakePaymentsAdapter,
} from '@/server/ports/payments/fake';
import {
  formFor,
  holdFor,
  ordersFor,
  publishLegal,
  type Bookable,
} from './checkoutFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { seedBookable } from './holdFixtures';
import { testDevice } from '../deviceFixture';

// The startPayment action against a real database and the fake payment gateway. Behaviours under test:
// - two calls on one hold (two tabs) give one order, one attempt, one provider payment, and one client secret,
//   and the provider's payment id is stored on the attempt
// - a call after a decline reuses the attempt and the provider payment
// - the sixth call on one hold answers too_many_tries and writes nothing and asks the provider for nothing
// - the provider failing before it answers leaves the order and the attempt; the next call makes the provider
//   payment, and when the provider did create it the next call finds it by Ramble's ids instead of creating
// - a failed second transaction does not fail the call: the client secret is returned, the failure is logged
//   by kind and attempt only, and the next call finds the payment by Ramble's ids
// - a payment id the provider no longer knows is an error, never a second payment
// - another device's hold is answered as a hold that does not exist, with no write and no provider call
// - the order token comes back to the holding device, and a confirmed order answers already_confirmed
// - a form that does not parse is invalid and spends no try

const gateway = vi.hoisted(() => ({ port: null as null | PaymentsPort }));
vi.mock('@/server/ports/payments/gateway', () => ({
  getFakePayments: () => gateway.port,
}));

const logged = vi.hoisted(() => ({ warn: vi.fn(), error: vi.fn() }));
vi.mock('@/server/monitoring/logger', () => ({ logger: logged }));

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let action: typeof import('@/server/actions/checkout');
let tokens: typeof import('@/server/tokens');
let guestA: Device;
let termsId: string;
let fake: FakePaymentsAdapter;
let createPayment: ReturnType<typeof vi.fn<PaymentsPort['createPayment']>>;
let retrieve: ReturnType<typeof vi.fn<PaymentsPort['retrieve']>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  action = await import('@/server/actions/checkout');
  tokens = await import('@/server/tokens');
  guestA = await testDevice('checkout-action-a');
  await testDevice('checkout-action-b');
  termsId = (await publishLegal(client.db, 'terms', 1)).id;
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  fake = createFakePaymentsAdapter({
    webhookSecret: 'w'.repeat(32),
    now: () => new Date(),
  });
  createPayment = vi.fn<PaymentsPort['createPayment']>((input) =>
    fake.createPayment(input),
  );
  retrieve = vi.fn<PaymentsPort['retrieve']>((query) => fake.retrieve(query));
  gateway.port = { ...fake, createPayment, retrieve } as PaymentsPort;
  logged.warn.mockReset();
  logged.error.mockReset();
});

/** Acts as this device: the mocked request carries its cookie from here on. */
async function as(label: 'a' | 'b') {
  await testDevice(label === 'a' ? 'checkout-action-a' : 'checkout-action-b');
}

async function startAs(label: 'a' | 'b', holdId: string, change = {}) {
  await as(label);
  return action.startPayment(formFor(holdId, termsId, change));
}

function paying(result: StartPaymentResult) {
  if (result.status !== 'requires_payment') {
    throw new Error(`expected a payment, got ${result.status}`);
  }
  return result;
}

async function newHold(device = guestA, bookable?: Bookable) {
  return holdFor(
    client.db,
    bookable ?? (await seedBookable(client.db)),
    device,
  );
}

async function rowCounts() {
  const [orderRows] = await client.db.select({ n: count() }).from(orders);
  const [attemptRows] = await client.db
    .select({ n: count() })
    .from(paymentAttempts);
  return { orders: orderRows?.n, attempts: attemptRows?.n };
}

async function attemptCount(holdId: string) {
  const [order] = await ordersFor(client.db, holdId);
  const [row] = await client.db
    .select({ n: count() })
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order?.id ?? ''));
  return row?.n;
}

async function attemptOf(holdId: string) {
  const [order] = await ordersFor(client.db, holdId);
  const [attempt] = await client.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, order?.id ?? ''));
  return { order, attempt };
}

describe('two calls on one hold', () => {
  it('give one order, one attempt, one provider payment, and one client secret, with the payment id stored', async () => {
    const hold = await newHold();

    const first = paying(await startAs('a', hold.id));
    const second = paying(await startAs('a', hold.id));
    const { order, attempt } = await attemptOf(hold.id);

    expect(second).toEqual(first);
    expect(first).toMatchObject({
      status: 'requires_payment',
      reference: order?.reference,
      orderId: order?.id,
      amountDueMinor: 10_888,
      payment: { provider: 'fake' },
    });
    expect(first.payment.clientSecret).toMatch(/^pay_/);
    expect(await ordersFor(client.db, hold.id)).toHaveLength(1);
    expect(await attemptCount(hold.id)).toBe(1);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect(createPayment).toHaveBeenCalledWith({
      idempotencyKey: `pay:${order?.id ?? ''}:1`,
      amountMinor: 10_888,
      currency: 'USD',
      metadata: { orderId: order?.id, recordId: attempt?.id },
    });
    expect(attempt?.providerPaymentId).toMatch(/^pay_/);
  });

  it('hand the order token to the holding device', async () => {
    const hold = await newHold();

    const result = paying(await startAs('a', hold.id));
    const { order } = await attemptOf(hold.id);

    expect(result.orderToken).toBe(
      tokens.capabilityToken('order', order?.id ?? '', 1),
    );
  });

  it('after a decline reuse the attempt and the provider payment', async () => {
    const hold = await newHold();
    const first = paying(await startAs('a', hold.id));
    const { order, attempt } = await attemptOf(hold.id);
    await fake.confirm(attempt?.providerPaymentId ?? '', {
      outcome: 'declined',
    });
    await client.db
      .update(paymentAttempts)
      .set({
        status: 'failed_try',
        failedTries: 1,
        failureCode: 'card_declined',
      })
      .where(eq(paymentAttempts.id, attempt?.id ?? ''));
    await client.db
      .update(orders)
      .set({ status: 'payment_failed' })
      .where(eq(orders.id, order?.id ?? ''));

    const third = paying(await startAs('a', hold.id));

    expect(third.payment.clientSecret).toBe(first.payment.clientSecret);
    expect(createPayment).toHaveBeenCalledTimes(1);
    expect((await attemptOf(hold.id)).order?.status).toBe('pending_payment');
    expect(await attemptCount(hold.id)).toBe(1);
  });
});

describe('the tries limit', () => {
  it('lets five calls through and answers the sixth too_many_tries, writing and asking for nothing', async () => {
    const hold = await newHold();
    for (let call = 1; call <= 5; call += 1) {
      paying(await startAs('a', hold.id));
    }
    const before = await rowCounts();
    createPayment.mockClear();
    retrieve.mockClear();

    const sixth = await startAs('a', hold.id);

    expect(sixth).toEqual({ status: 'too_many_tries' });
    expect(await rowCounts()).toEqual(before);
    expect(createPayment).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });

  it('counts each hold on its own', async () => {
    const hold = await newHold();
    const other = await newHold();
    for (let call = 1; call <= 5; call += 1) await startAs('a', hold.id);

    expect(paying(await startAs('a', other.id)).status).toBe(
      'requires_payment',
    );
  });
});

describe('the provider failing between the transactions', () => {
  it('leaves the order and the attempt, and the next call makes the provider payment', async () => {
    const hold = await newHold();
    createPayment.mockRejectedValueOnce(
      new PaymentsError('provider_unavailable'),
    );

    await expect(startAs('a', hold.id)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    const { order, attempt } = await attemptOf(hold.id);
    expect(order?.status).toBe('pending_payment');
    expect(attempt).toMatchObject({ attemptNo: 1, providerPaymentId: null });
    expect(await attemptCount(hold.id)).toBe(1);

    const next = paying(await startAs('a', hold.id));

    expect(next.orderId).toBe(order?.id);
    expect(retrieve).toHaveBeenCalledWith({
      kind: 'payment',
      metadata: { orderId: order?.id, recordId: attempt?.id },
    });
    expect(createPayment).toHaveBeenCalledTimes(2);
    expect((await attemptOf(hold.id)).attempt?.providerPaymentId).toMatch(
      /^pay_/,
    );
  });

  it('finds a payment the provider created but never answered for, instead of creating another', async () => {
    const hold = await newHold();
    createPayment.mockImplementationOnce(async (input) => {
      await fake.createPayment(input);
      throw new PaymentsError('provider_unavailable');
    });

    await expect(startAs('a', hold.id)).rejects.toBeInstanceOf(PaymentsError);
    const created = await fake.retrieve({
      kind: 'payment',
      metadata: {
        orderId: (await attemptOf(hold.id)).order?.id ?? '',
        recordId: (await attemptOf(hold.id)).attempt?.id ?? '',
      },
    });
    createPayment.mockClear();

    const next = paying(await startAs('a', hold.id));

    expect(createPayment).not.toHaveBeenCalled();
    expect(next.payment.clientSecret).toBe(created?.clientSecret);
    expect((await attemptOf(hold.id)).attempt?.providerPaymentId).toBe(
      created?.id,
    );
  });

  it('does not repair a payment the provider no longer knows', async () => {
    const hold = await newHold();
    paying(await startAs('a', hold.id));
    retrieve.mockResolvedValueOnce(null);
    createPayment.mockClear();

    await expect(startAs('a', hold.id)).rejects.toMatchObject({
      code: 'not_found',
    });
    expect(createPayment).not.toHaveBeenCalled();
  });
});

describe('a failed second transaction', () => {
  it('still returns the client secret, logs the kind and the attempt only, and is found by Ramble’s ids next time', async () => {
    const other = await newHold();
    const taken = paying(await startAs('a', other.id));
    const takenId = (await attemptOf(other.id)).attempt?.providerPaymentId;
    const hold = await newHold();
    createPayment.mockImplementationOnce(async (input) => {
      const payment: Payment = await fake.createPayment(input);
      return { ...payment, id: takenId ?? payment.id };
    });

    const result = paying(await startAs('a', hold.id));
    const { attempt } = await attemptOf(hold.id);

    expect(result.payment.clientSecret).not.toBe(taken.payment.clientSecret);
    expect(attempt?.providerPaymentId).toBeNull();
    expect(logged.error).toHaveBeenCalledTimes(1);
    expect(logged.error).toHaveBeenCalledWith(
      'Provider payment id not stored',
      {
        attemptId: attempt?.id,
        errorKind: 'Error',
      },
    );
  });
});

describe('another device’s hold', () => {
  it('is answered as a hold that does not exist, writing nothing and asking the provider for nothing', async () => {
    const hold = await newHold(guestA);
    const before = await rowCounts();

    const stranger = await startAs('b', hold.id);
    const missing = await startAs('b', '3f2504e0-4f89-41d3-9a0c-0305e82c3301');

    expect(stranger).toEqual({
      status: 'hold_expired',
      canRehold: false,
      spacesLeft: 0,
    });
    expect(missing).toEqual(stranger);
    expect(await rowCounts()).toEqual(before);
    expect(createPayment).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
  });
});

describe('a confirmed order', () => {
  it('answers already_confirmed with the token for the holding device', async () => {
    const hold = await newHold();
    paying(await startAs('a', hold.id));
    const { order } = await attemptOf(hold.id);
    await client.db
      .update(orders)
      .set({ status: 'confirmed', confirmedAt: new Date() })
      .where(eq(orders.id, order?.id ?? ''));
    createPayment.mockClear();

    const result = await startAs('a', hold.id, { waiverDocumentId: termsId });

    expect(result).toEqual({
      status: 'already_confirmed',
      reference: order?.reference,
      orderToken: tokens.capabilityToken('order', order?.id ?? '', 1),
    });
    expect(createPayment).not.toHaveBeenCalled();
  });
});

describe('a form that does not parse', () => {
  it('is invalid, spends no try, and reaches no provider', async () => {
    const hold = await newHold();
    for (let call = 1; call <= 6; call += 1) {
      await expect(
        startAs('a', hold.id, { leadGuestName: '' }),
      ).resolves.toEqual({
        status: 'invalid',
        fieldErrors: { leadGuestName: 'invalid' },
      });
    }

    expect(paying(await startAs('a', hold.id)).status).toBe('requires_payment');
    expect(createPayment).toHaveBeenCalledTimes(1);
  });
});
