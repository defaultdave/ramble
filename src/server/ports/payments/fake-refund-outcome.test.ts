import { describe, expect, it } from 'vitest';
import { PaymentsError } from './index';
import {
  createFakePaymentsAdapter,
  createFakePaymentsState,
  type FakePaymentsAdapter,
} from './fake';
import {
  emptyFakeStateDocument,
  parseFakeState,
  serializeFakeState,
} from './fakeState';
import { id as uuid } from '../../../../tests/support/ids';

// Behaviours under test (the fake's refund outcome, which the refund job and ops tests drive):
// - by default a refund succeeds: money leaves the balance, refund.succeeded is emitted (the contract tests cover this too)
// - after `failed` is set for a payment, its next refund fails with the code: no money moves, the payment keeps its
//   refundable amount, refund.failed is emitted with the amount and the code, and the refund is findable by its metadata
// - a failed refund still obeys the refundable cap, and a replay of its key answers the same failed refund
// - the outcome belongs to one payment, can be set back, and does not change a refund made earlier
// - a payment that does not exist and a failure code that is not a code are refused
// - the outcome survives the JSON the gateway keeps its state in, and a stored row from before it existed still reads

const now = new Date('2026-11-10T12:00:00.000Z');

function makeFake(): FakePaymentsAdapter {
  return createFakePaymentsAdapter({
    webhookSecret: 'whsec_fake_0123456789abcdef',
    now: () => now,
  });
}

async function paid(
  fake: FakePaymentsAdapter,
  n: number,
  amountMinor = 14_950,
) {
  const payment = await fake.createPayment({
    idempotencyKey: `pay:${uuid(n)}:1`,
    amountMinor,
    currency: 'USD',
    metadata: { orderId: uuid(n), recordId: uuid(n + 100) },
  });
  return (await fake.confirm(payment.id, { outcome: 'succeeded' })).payment;
}

const refundOf = (paymentId: string, n: number, amountMinor = 1_000) => ({
  idempotencyKey: `refund:${uuid(n)}`,
  paymentId,
  amountMinor,
  metadata: { orderId: uuid(1), recordId: uuid(n) },
});

describe('the fake refund outcome', () => {
  it('fails the next refund of the payment with its code and moves no money', async () => {
    const fake = makeFake();
    const payment = await paid(fake, 1);
    const before = await fake.getBalance();
    await fake.setRefundOutcome(payment.id, {
      outcome: 'failed',
      failureCode: 'expired_or_canceled_card',
    });

    const refund = await fake.refund(refundOf(payment.id, 2));

    expect(refund).toMatchObject({
      status: 'failed',
      failureCode: 'expired_or_canceled_card',
      amountMinor: 1_000,
    });
    expect(await fake.getBalance()).toEqual(before);
    expect(
      await fake.retrieve({ kind: 'payment', id: payment.id }),
    ).toMatchObject({ refundedMinor: 0 });
    expect(
      await fake.retrieve({ kind: 'refund', metadata: refund.metadata }),
    ).toEqual(refund);
    expect(fake.emittedEvents().at(-1)).toMatchObject({
      type: 'refund.failed',
      objectId: refund.id,
      amountMinor: 1_000,
      failureCode: 'expired_or_canceled_card',
      metadata: refund.metadata,
    });
  });

  it('uses a default failure code', async () => {
    const fake = makeFake();
    const payment = await paid(fake, 1);
    await fake.setRefundOutcome(payment.id, { outcome: 'failed' });
    expect(await fake.refund(refundOf(payment.id, 2))).toMatchObject({
      failureCode: 'refund_declined',
    });
  });

  it('still refuses a refund past what the payment holds, and replays the same failed refund for a repeated key', async () => {
    const fake = makeFake();
    const payment = await paid(fake, 1, 5_000);
    await fake.setRefundOutcome(payment.id, { outcome: 'failed' });

    await expect(
      fake.refund(refundOf(payment.id, 2, 5_001)),
    ).rejects.toMatchObject({
      code: 'refund_exceeds_captured',
    });
    const first = await fake.refund(refundOf(payment.id, 3));
    const events = fake.emittedEvents().length;
    expect(await fake.refund(refundOf(payment.id, 3))).toEqual(first);
    expect(fake.emittedEvents()).toHaveLength(events);
  });

  it('belongs to one payment, can be set back, and leaves an earlier refund as it was', async () => {
    const fake = makeFake();
    const first = await paid(fake, 1);
    const second = await paid(fake, 2);
    const earlier = await fake.refund(refundOf(first.id, 3));
    await fake.setRefundOutcome(first.id, { outcome: 'failed' });

    expect(await fake.refund(refundOf(second.id, 4))).toMatchObject({
      status: 'succeeded',
    });
    expect(await fake.refund(refundOf(first.id, 5))).toMatchObject({
      status: 'failed',
    });
    expect(
      await fake.retrieve({ kind: 'refund', id: earlier.id }),
    ).toMatchObject({ status: 'succeeded' });

    await fake.setRefundOutcome(first.id, { outcome: 'succeeded' });
    expect(await fake.refund(refundOf(first.id, 6))).toMatchObject({
      status: 'succeeded',
    });
    expect(
      await fake.retrieve({ kind: 'payment', id: first.id }),
    ).toMatchObject({ refundedMinor: 2_000 });
  });

  it.each([
    [
      'a payment that does not exist',
      'pay_unknown',
      { outcome: 'failed' },
      'not_found',
    ],
    [
      'a failure code that is not a code',
      null,
      { outcome: 'failed', failureCode: 'Not A Code' },
      'invalid_input',
    ],
    [
      'an outcome that is not one',
      null,
      { outcome: 'pending' },
      'invalid_input',
    ],
  ])('refuses %s', async (_name, paymentId, input, code) => {
    const fake = makeFake();
    const payment = await paid(fake, 1);
    const attempt = fake.setRefundOutcome(
      paymentId ?? payment.id,
      input as { outcome: 'failed' },
    );
    await expect(attempt).rejects.toBeInstanceOf(PaymentsError);
    await expect(attempt).rejects.toMatchObject({ code });
  });

  it('survives the stored JSON, and a stored row from before it existed still reads', async () => {
    const state = createFakePaymentsState();
    const fake = createFakePaymentsAdapter({
      webhookSecret: 'whsec_fake_0123456789abcdef',
      now: () => now,
      state,
    });
    const payment = await paid(fake, 1);
    await fake.setRefundOutcome(payment.id, {
      outcome: 'failed',
      failureCode: 'refund_declined',
    });

    const stored: unknown = JSON.parse(
      JSON.stringify(serializeFakeState(state)),
    );
    expect(parseFakeState(stored).refundFailures).toEqual(
      new Map([[payment.id, 'refund_declined']]),
    );

    const older: Record<string, unknown> = { ...emptyFakeStateDocument };
    Reflect.deleteProperty(older, 'refundFailures');
    expect(parseFakeState(older).refundFailures).toEqual(new Map());
  });
});
