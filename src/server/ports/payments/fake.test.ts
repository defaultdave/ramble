import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PaymentsError, type ProviderEvent } from './index';
import { describePaymentsPortContract } from './contract';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsAdapter,
} from './fake';

const webhookSecret = 'whsec_fake_0123456789abcdef';
const fixedNow = new Date('2026-10-25T12:00:00.000Z');
const toleranceSeconds = 300;
const maxDeclines = 10;

function makeFake(now: () => Date = () => fixedNow): FakePaymentsAdapter {
  return createFakePaymentsAdapter({ webhookSecret, now });
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function firstEvent(fake: FakePaymentsAdapter): ProviderEvent {
  const [event] = fake.emittedEvents();
  if (!event) throw new Error('Expected an event');
  return event;
}

const paymentInput = (n: number, amountMinor = 14_950) => ({
  idempotencyKey: `pay:${uuid(n)}:1`,
  amountMinor,
  currency: 'USD' as const,
  metadata: { orderId: uuid(n), recordId: uuid(n * 10) },
});

describePaymentsPortContract('fake adapter', () => {
  const fake = makeFake();
  return {
    port: fake,
    destinationAccountId: 'acct_fake_host',
    settle: async (paymentId, outcome) => {
      await fake.confirm(paymentId, { outcome });
    },
    events: () => Promise.resolve(fake.emittedEvents()),
    deliver: (event) => Promise.resolve(fake.signWebhook(event)),
  };
});

describe('fake adapter', () => {
  async function playScenario(fake: FakePaymentsAdapter) {
    const payment = await fake.createPayment(paymentInput(1));
    await fake.confirm(payment.id, { outcome: 'declined' });
    await fake.confirm(payment.id, {
      outcome: 'succeeded',
      method: 'apple_pay',
    });
    const refund = await fake.refund({
      idempotencyKey: `refund:${uuid(2)}`,
      paymentId: payment.id,
      amountMinor: 1_000,
      metadata: { orderId: uuid(1), recordId: uuid(2) },
    });
    return { payment, refund, events: fake.emittedEvents() };
  }

  it('gives the same ids, client secrets, fees, and events for the same inputs', async () => {
    const first = await playScenario(makeFake());
    const second = await playScenario(makeFake());

    expect(second).toEqual(first);
    expect(first.payment.id).toMatch(/^pay_[0-9a-f]{24}$/);
    expect(first.refund.id).toMatch(/^re_[0-9a-f]{24}$/);
    expect(first.events.map((event) => event.id)).toEqual(
      second.events.map((event) => event.id),
    );
  });

  it('charges the US card list rate and reports it on the payment and its event', async () => {
    const fake = makeFake();
    const created = await fake.createPayment(paymentInput(1, 14_950));

    const payment = await fake.confirm(created.id, { outcome: 'succeeded' });

    expect(payment.feeMinor).toBe(464);
    expect(fake.emittedEvents()[0]).toMatchObject({
      type: 'payment.succeeded',
      amountMinor: 14_950,
      feeMinor: 464,
    });
    expect(await fake.getBalance()).toEqual({
      availableMinor: 14_950 - 464,
      currency: 'USD',
    });
  });

  it('gives every event a distinct id, including repeated declines on one payment', async () => {
    const fake = makeFake();
    const payment = await fake.createPayment(paymentInput(1));

    await fake.confirm(payment.id, { outcome: 'declined' });
    await fake.confirm(payment.id, {
      outcome: 'declined',
      failureCode: 'expired_card',
    });

    const ids = fake.emittedEvents().map((event) => event.id);
    expect(new Set(ids).size).toBe(2);
    expect(fake.emittedEvents()[1]).toMatchObject({
      failureCode: 'expired_card',
    });
  });

  it.each([toleranceSeconds + 1, -(toleranceSeconds + 1)])(
    'refuses a delivery signed %i seconds away from now',
    async (offsetSeconds) => {
      let now = fixedNow;
      const fake = makeFake(() => now);
      const payment = await fake.createPayment(paymentInput(1));
      await fake.confirm(payment.id, { outcome: 'succeeded' });
      const delivery = fake.signWebhook(firstEvent(fake));
      now = new Date(fixedNow.getTime() + offsetSeconds * 1_000);

      await expect(fake.verifyWebhook(delivery)).rejects.toMatchObject({
        code: 'invalid_signature',
      });
    },
  );

  it('accepts a delivery signed within the tolerance', async () => {
    let now = fixedNow;
    const fake = makeFake(() => now);
    const payment = await fake.createPayment(paymentInput(1));
    await fake.confirm(payment.id, { outcome: 'succeeded' });
    const event = firstEvent(fake);
    now = new Date(fixedNow.getTime() + (toleranceSeconds - 1) * 1_000);

    expect(await fake.verifyWebhook(fake.signWebhook(event))).toEqual(event);
  });

  it.each([
    ['not JSON', 'not json'],
    ['not an event', JSON.stringify({ id: 'evt_1' })],
    [
      'from another provider',
      JSON.stringify({
        id: 'evt_1',
        provider: 'stripe',
        type: 'payment.succeeded',
        objectId: 'pi_1',
        metadata: null,
        amountMinor: 100,
        currency: 'USD',
        feeMinor: 33,
        failureCode: null,
        method: 'card',
        occurredAt: fixedNow.toISOString(),
      }),
    ],
  ])('refuses a correctly signed body that is %s', async (_, rawBody) => {
    const fake = makeFake();
    const timestamp = String(Math.floor(fixedNow.getTime() / 1_000));
    const digest = createHmac('sha256', webhookSecret)
      .update(`${timestamp}.${rawBody}`)
      .digest('hex');

    await expect(
      fake.verifyWebhook({ rawBody, signature: `t=${timestamp},v1=${digest}` }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a secret shorter than 16 characters', () => {
    expect(() =>
      createFakePaymentsAdapter({
        webhookSecret: 'short',
        now: () => fixedNow,
      }),
    ).toThrow(PaymentsError);
  });

  it('refuses to hold more than maxObjects', async () => {
    const fake = createFakePaymentsAdapter({
      webhookSecret,
      now: () => fixedNow,
      maxObjects: 2,
    });
    await fake.createPayment(paymentInput(1));
    await fake.createPayment(paymentInput(2));

    await expect(fake.createPayment(paymentInput(3))).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(await fake.createPayment(paymentInput(1))).toMatchObject({
      status: 'created',
    });
  });

  it(`refuses a try after ${String(maxDeclines)} declines`, async () => {
    const fake = makeFake();
    const payment = await fake.createPayment(paymentInput(1));
    for (let i = 0; i < maxDeclines; i += 1) {
      await fake.confirm(payment.id, { outcome: 'declined' });
    }

    await expect(
      fake.confirm(payment.id, { outcome: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
    expect(fake.emittedEvents()).toHaveLength(maxDeclines);
  });

  it('refuses a confirmation outside the known outcomes', async () => {
    const fake = makeFake();
    const payment = await fake.createPayment(paymentInput(1));

    await expect(
      fake.confirm(payment.id, { outcome: 'maybe' as never }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('shares objects between adapters built on one state', async () => {
    const state = createFakePaymentsState();
    const writer = createFakePaymentsAdapter({
      webhookSecret,
      now: () => fixedNow,
      state,
    });
    const reader = createFakePaymentsAdapter({
      webhookSecret,
      now: () => fixedNow,
      state,
    });
    const payment = await writer.createPayment(paymentInput(1));

    expect(await reader.retrieve({ kind: 'payment', id: payment.id })).toEqual(
      payment,
    );
  });

  it('keeps the first object created with a given metadata for lookups', async () => {
    const fake = makeFake();
    const first = await fake.createPayment(paymentInput(1));
    await fake.createPayment({
      ...paymentInput(1),
      idempotencyKey: `pay:${uuid(1)}:2`,
    });

    expect(
      await fake.retrieve({ kind: 'payment', metadata: first.metadata }),
    ).toEqual(first);
  });

  it('hands out copies, so a caller cannot change the provider state', async () => {
    const fake = makeFake();
    const payment = await fake.createPayment(paymentInput(1));
    payment.amountMinor = 1;
    payment.metadata.orderId = uuid(99);
    await fake.confirm(payment.id, { outcome: 'succeeded' });
    firstEvent(fake).type = 'payment.failed';

    expect(
      await fake.retrieve({ kind: 'payment', id: payment.id }),
    ).toMatchObject({
      amountMinor: 14_950,
      metadata: paymentInput(1).metadata,
    });
    expect(firstEvent(fake).type).toBe('payment.succeeded');
  });
});
