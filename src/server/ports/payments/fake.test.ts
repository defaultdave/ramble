import { describe, expect, it } from 'vitest';
import { describePaymentsPortContract } from '../../../../tests/contracts/payments-port';
import { PaymentsError, type ProviderEvent } from './index';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsAdapter,
  type FakePaymentsOptions,
} from './fake';

const webhookSecret = 'whsec_fake_0123456789abcdef';
const fixedNow = new Date('2026-10-25T12:00:00.000Z');
const toleranceSeconds = 300;
const defaultMaxDeclines = 5;
const maxChallenges = 3;

function makeFake(
  overrides: Partial<FakePaymentsOptions> = {},
): FakePaymentsAdapter {
  return createFakePaymentsAdapter({
    webhookSecret,
    now: () => fixedNow,
    ...overrides,
  });
}

function firstEvent(fake: FakePaymentsAdapter): ProviderEvent {
  const [event] = fake.emittedEvents();
  if (!event) throw new Error('Expected an event');
  return event;
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const metadata = (order: number, record: number) => ({
  orderId: uuid(order),
  recordId: uuid(record),
});

const paymentInput = (n: number, amountMinor = 14_950) => ({
  idempotencyKey: `pay:${uuid(n)}:1`,
  amountMinor,
  currency: 'USD' as const,
  metadata: metadata(n, n * 10),
});

const refundInput = (paymentId: string, n: number, amountMinor = 1_000) => ({
  idempotencyKey: `refund:${uuid(n)}`,
  paymentId,
  amountMinor,
  metadata: metadata(1, n),
});

const transferInput = (n: number, amountMinor = 1_000) => ({
  idempotencyKey: `transfer:${uuid(n)}`,
  destinationAccountId: 'acct_fake_host',
  amountMinor,
  currency: 'USD' as const,
  metadata: metadata(1, n),
});

const reversalInput = (transferId: string, n: number, amountMinor = 100) => ({
  idempotencyKey: `reversal:${uuid(n)}`,
  transferId,
  amountMinor,
  metadata: metadata(1, n),
});

async function paid(fake: FakePaymentsAdapter, n = 1) {
  const payment = await fake.createPayment(paymentInput(n));
  return (await fake.confirm(payment.id, { outcome: 'succeeded' })).payment;
}

describePaymentsPortContract('fake adapter', () => {
  const fake = makeFake();
  const signedAt = (offsetSeconds: number) =>
    new Date(fixedNow.getTime() + offsetSeconds * 1_000);
  return {
    port: fake,
    destinationAccountId: 'acct_fake_host',
    signatureToleranceSeconds: toleranceSeconds,
    settle: async (paymentId, outcome) => {
      await fake.confirm(paymentId, { outcome });
    },
    events: () => Promise.resolve(fake.emittedEvents()),
    deliver: (event, offsetSeconds = 0) =>
      Promise.resolve(fake.signWebhook(event, signedAt(offsetSeconds))),
    ignoredDelivery: () =>
      Promise.resolve(
        fake.signBody(
          JSON.stringify({
            id: 'evt_ignored',
            provider: 'fake',
            type: 'charge.updated',
          }),
        ),
      ),
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
    const refund = await fake.refund(refundInput(payment.id, 2));
    return { payment, refund, events: fake.emittedEvents() };
  }

  it('gives the same ids, client secrets, fees, and events for the same inputs', async () => {
    const first = await playScenario(makeFake());
    const second = await playScenario(makeFake());

    expect(second).toEqual(first);
    expect(first.payment.id).toMatch(/^pay_[0-9a-f]{24}$/);
    expect(first.refund.id).toMatch(/^re_[0-9a-f]{24}$/);
  });

  it('charges the US card list rate and reports it on the payment and its event', async () => {
    const fake = makeFake();

    const payment = await paid(fake);

    expect(payment.feeMinor).toBe(464);
    expect(firstEvent(fake)).toMatchObject({
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

  it.each([
    ['not JSON', 'not json'],
    ['not an event', JSON.stringify({ id: 'evt_1' })],
    [
      'from another provider',
      JSON.stringify({
        id: 'evt_1',
        provider: 'stripe',
        type: 'charge.updated',
      }),
    ],
    [
      'a known type with a malformed body',
      JSON.stringify({
        id: 'evt_1',
        provider: 'fake',
        type: 'payment.succeeded',
      }),
    ],
  ])('refuses a correctly signed body that is %s', async (_, rawBody) => {
    const fake = makeFake();

    await expect(
      fake.verifyWebhook(fake.signBody(rawBody)),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('refuses a second success with invalid_state', async () => {
    const fake = makeFake();
    const payment = await paid(fake);

    await expect(
      fake.confirm(payment.id, { outcome: 'succeeded' }),
    ).rejects.toMatchObject({ code: 'invalid_state' });
  });

  it('refuses a secret shorter than 16 characters', () => {
    expect(() => makeFake({ webhookSecret: 'short' })).toThrow(PaymentsError);
  });

  describe('object cap', () => {
    it('refuses a new payment at the cap and still replays an earlier key', async () => {
      const fake = makeFake({ maxObjects: 2 });
      const first = await fake.createPayment(paymentInput(1));
      await fake.createPayment(paymentInput(2));

      await expect(fake.createPayment(paymentInput(3))).rejects.toMatchObject({
        code: 'provider_unavailable',
      });
      expect(await fake.createPayment(paymentInput(1))).toEqual(first);
    });

    it('refuses a new refund at the cap, changes nothing, and still replays an earlier key', async () => {
      const fake = makeFake({ maxObjects: 2 });
      const payment = await paid(fake);
      const refund = await fake.refund(refundInput(payment.id, 2));
      const before = await fake.getBalance();

      await expect(
        fake.refund(refundInput(payment.id, 3)),
      ).rejects.toMatchObject({ code: 'provider_unavailable' });

      expect(await fake.getBalance()).toEqual(before);
      expect(
        (await fake.retrieve({ kind: 'payment', id: payment.id }))
          ?.refundedMinor,
      ).toBe(1_000);
      expect(await fake.refund(refundInput(payment.id, 2))).toEqual(refund);
    });

    it('refuses a new transfer at the cap, changes nothing, and still replays an earlier key', async () => {
      const fake = makeFake({ maxObjects: 2 });
      await paid(fake);
      const transfer = await fake.transfer(transferInput(2));
      const before = await fake.getBalance();

      await expect(fake.transfer(transferInput(3))).rejects.toMatchObject({
        code: 'provider_unavailable',
      });

      expect(await fake.getBalance()).toEqual(before);
      expect(await fake.transfer(transferInput(2))).toEqual(transfer);
    });

    it('refuses a new reversal at the cap, changes nothing, and still replays an earlier key', async () => {
      const fake = makeFake({ maxObjects: 3 });
      await paid(fake);
      const transfer = await fake.transfer(transferInput(2));
      const reversal = await fake.reverseTransfer(
        reversalInput(transfer.id, 3),
      );
      const before = await fake.getBalance();

      await expect(
        fake.reverseTransfer(reversalInput(transfer.id, 4)),
      ).rejects.toMatchObject({ code: 'provider_unavailable' });

      expect(await fake.getBalance()).toEqual(before);
      expect(
        (await fake.retrieve({ kind: 'transfer', id: transfer.id }))
          ?.reversedMinor,
      ).toBe(100);
      expect(await fake.reverseTransfer(reversalInput(transfer.id, 3))).toEqual(
        reversal,
      );
    });
  });

  describe('event cap', () => {
    it('refuses a confirmation that would emit past the cap and leaves the payment as it was', async () => {
      const fake = makeFake({ maxEvents: 1 });
      const payment = await fake.createPayment(paymentInput(1));
      await fake.confirm(payment.id, { outcome: 'declined' });

      await expect(
        fake.confirm(payment.id, { outcome: 'succeeded' }),
      ).rejects.toMatchObject({ code: 'provider_unavailable' });

      expect(fake.emittedEvents()).toHaveLength(1);
      expect(
        await fake.retrieve({ kind: 'payment', id: payment.id }),
      ).toMatchObject({ status: 'failed_try', feeMinor: null });
      expect(await fake.getBalance()).toEqual({
        availableMinor: 0,
        currency: 'USD',
      });
    });

    it('refuses a cancel that would emit past the cap and still replays an earlier cancel', async () => {
      const fake = makeFake({ maxEvents: 1 });
      const first = await fake.createPayment(paymentInput(1));
      const second = await fake.createPayment(paymentInput(2));
      const canceled = await fake.cancelPayment({
        idempotencyKey: `cancel:${uuid(1)}`,
        paymentId: first.id,
      });

      await expect(
        fake.cancelPayment({
          idempotencyKey: `cancel:${uuid(2)}`,
          paymentId: second.id,
        }),
      ).rejects.toMatchObject({ code: 'provider_unavailable' });

      expect(
        (await fake.retrieve({ kind: 'payment', id: second.id }))?.status,
      ).toBe('created');
      expect(
        await fake.cancelPayment({
          idempotencyKey: `cancel:${uuid(1)}`,
          paymentId: first.id,
        }),
      ).toEqual(canceled);
    });

    it('refuses a refund that would emit past the cap', async () => {
      const fake = makeFake({ maxEvents: 1 });
      const payment = await paid(fake);

      await expect(
        fake.refund(refundInput(payment.id, 2)),
      ).rejects.toMatchObject({ code: 'provider_unavailable' });
      expect(
        (await fake.retrieve({ kind: 'payment', id: payment.id }))
          ?.refundedMinor,
      ).toBe(0);
    });
  });

  describe('try caps', () => {
    it(`refuses a try after ${String(defaultMaxDeclines)} declines by default`, async () => {
      const fake = makeFake();
      const payment = await fake.createPayment(paymentInput(1));
      for (let i = 0; i < defaultMaxDeclines; i += 1) {
        await fake.confirm(payment.id, { outcome: 'declined' });
      }

      await expect(
        fake.confirm(payment.id, { outcome: 'succeeded' }),
      ).rejects.toMatchObject({ code: 'invalid_state' });
      expect(fake.emittedEvents()).toHaveLength(defaultMaxDeclines);
    });

    it('takes the decline cap from its options', async () => {
      const fake = makeFake({ maxFailedTries: 2 });
      const payment = await fake.createPayment(paymentInput(1));
      await fake.confirm(payment.id, { outcome: 'declined' });
      await fake.confirm(payment.id, { outcome: 'declined' });

      await expect(
        fake.confirm(payment.id, { outcome: 'declined' }),
      ).rejects.toMatchObject({ code: 'invalid_state' });
      expect(fake.emittedEvents()).toHaveLength(2);
    });

    it(`refuses a fourth authentication challenge after ${String(maxChallenges)} and emits nothing for it`, async () => {
      const fake = makeFake();
      const payment = await fake.createPayment(paymentInput(1));
      for (let i = 0; i < maxChallenges; i += 1) {
        await fake.confirm(payment.id, { outcome: 'requires_action' });
      }

      await expect(
        fake.confirm(payment.id, { outcome: 'requires_action' }),
      ).rejects.toMatchObject({ code: 'invalid_state' });

      expect(fake.emittedEvents()).toHaveLength(maxChallenges);
      expect(
        (await fake.confirm(payment.id, { outcome: 'succeeded' })).payment,
      ).toMatchObject({ status: 'succeeded' });
    });
  });

  it('refuses a confirmation outside the known outcomes', async () => {
    const fake = makeFake();
    const payment = await fake.createPayment(paymentInput(1));

    await expect(
      fake.confirm(payment.id, { outcome: 'maybe' as never }),
    ).rejects.toMatchObject({ code: 'invalid_input' });
  });

  it('treats a processing payment as neither settleable, cancelable, nor refundable', async () => {
    const state = createFakePaymentsState();
    const fake = makeFake({ state });
    const payment = await fake.createPayment(paymentInput(1));
    const held = state.payments.get(payment.id);
    if (!held) throw new Error('Expected the payment in state');
    held.status = 'processing';

    for (const work of [
      fake.confirm(payment.id, { outcome: 'succeeded' }),
      fake.cancelPayment({
        idempotencyKey: `cancel:${uuid(1)}`,
        paymentId: payment.id,
      }),
      fake.refund(refundInput(payment.id, 2)),
    ]) {
      await expect(work).rejects.toMatchObject({ code: 'invalid_state' });
    }
    expect(fake.emittedEvents()).toHaveLength(0);
  });

  it('shares objects between adapters built on one state', async () => {
    const state = createFakePaymentsState();
    const writer = makeFake({ state });
    const reader = makeFake({ state });
    const payment = await writer.createPayment(paymentInput(1));

    expect(await reader.retrieve({ kind: 'payment', id: payment.id })).toEqual(
      payment,
    );
  });

  it('keeps the first object of a kind created with a given metadata for lookups', async () => {
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

  it.each([
    ['succeeded', 'payment.succeeded'],
    ['declined', 'payment.failed'],
    ['requires_action', 'payment.requires_action'],
  ] as const)(
    'hands back the event a %s confirmation emitted, as a copy',
    async (outcome, type) => {
      const fake = makeFake();
      const payment = await fake.createPayment(paymentInput(1));

      const confirmed = await fake.confirm(payment.id, { outcome });

      expect(confirmed.event).toEqual(firstEvent(fake));
      expect(confirmed.event).toMatchObject({ type, objectId: payment.id });
      confirmed.event.type = 'payment.canceled';
      expect(firstEvent(fake).type).toBe(type);
    },
  );

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
