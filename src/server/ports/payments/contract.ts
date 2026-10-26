import { beforeEach, describe, expect, it } from 'vitest';
import {
  maxAmountMinor,
  maxWebhookBodyLength,
  type ObjectKind,
  type Payment,
  type PaymentsErrorCode,
  type PaymentsPort,
  type ProviderEvent,
  type ProviderObject,
  type RambleMetadata,
  type WebhookDelivery,
} from './index';

type SettlementOutcome = 'succeeded' | 'declined' | 'requires_action';

/** What an adapter's test supplies so the shared suite can drive it. */
export type PaymentsContractHarness = {
  port: PaymentsPort;
  /** A provider account the port may transfer to. */
  destinationAccountId: string;
  /** Has the provider report `outcome` for a payment, as the guest's card would. */
  settle(paymentId: string, outcome: SettlementOutcome): Promise<void>;
  /** Every event the provider has emitted so far, oldest first. */
  events(): Promise<ProviderEvent[]>;
  /** The event as the provider would deliver it to the webhook route. */
  deliver(event: ProviderEvent): Promise<WebhookDelivery>;
};

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const metadata = (order: number, record: number): RambleMetadata => ({
  orderId: uuid(order),
  recordId: uuid(record),
});

const paymentInput = (n: number, amountMinor = 10_000) => ({
  idempotencyKey: `pay:${uuid(n)}:1`,
  amountMinor,
  currency: 'USD' as const,
  metadata: metadata(n, n * 10),
});

const refundInput = (paymentId: string, n: number, amountMinor: number) => ({
  idempotencyKey: `refund:${uuid(n)}`,
  paymentId,
  amountMinor,
  metadata: metadata(1, n),
});

async function expectCode(work: Promise<unknown>, code: PaymentsErrorCode) {
  await expect(work).rejects.toMatchObject({ name: 'PaymentsError', code });
}

export function describePaymentsPortContract(
  name: string,
  makeHarness: () => PaymentsContractHarness | Promise<PaymentsContractHarness>,
) {
  describe(`${name}: PaymentsPort contract`, () => {
    let h: PaymentsContractHarness;

    beforeEach(async () => {
      h = await makeHarness();
    });

    async function mustRetrieve<K extends ObjectKind>(
      kind: K,
      id: string,
    ): Promise<ProviderObject<K>> {
      const found = await h.port.retrieve({ kind, id });
      if (!found) throw new Error(`Expected ${kind} ${id} to exist`);
      return found;
    }

    async function paidPayment(n = 1, amountMinor = 10_000): Promise<Payment> {
      const created = await h.port.createPayment(paymentInput(n, amountMinor));
      await h.settle(created.id, 'succeeded');
      return mustRetrieve('payment', created.id);
    }

    async function lastEvent(): Promise<ProviderEvent> {
      const events = await h.events();
      const last = events.at(-1);
      if (!last) throw new Error('Expected an event');
      return last;
    }

    async function balance(): Promise<number> {
      return (await h.port.getBalance()).availableMinor;
    }

    describe('createPayment', () => {
      it('returns a created payment with the amount, currency, metadata, a client secret, and no fee yet', async () => {
        const input = paymentInput(1);

        const payment = await h.port.createPayment(input);

        expect(payment).toMatchObject({
          provider: h.port.provider,
          status: 'created',
          amountMinor: 10_000,
          currency: 'USD',
          feeMinor: null,
          refundedMinor: 0,
          failedTries: 0,
          metadata: input.metadata,
        });
        expect(payment.id).not.toBe('');
        expect(payment.clientSecret).not.toBe('');
      });

      it('replays the same payment on the same key and input', async () => {
        const first = await h.port.createPayment(paymentInput(1));

        const second = await h.port.createPayment(paymentInput(1));

        expect(second).toEqual(first);
        expect(
          await h.port.retrieve({ kind: 'payment', metadata: first.metadata }),
        ).toEqual(first);
      });

      it('refuses the same key with different input', async () => {
        await h.port.createPayment(paymentInput(1));

        await expectCode(
          h.port.createPayment(paymentInput(1, 10_001)),
          'idempotency_conflict',
        );
      });

      it.each([
        ['a zero amount', { amountMinor: 0 }],
        ['a negative amount', { amountMinor: -100 }],
        ['a fractional amount', { amountMinor: 10.5 }],
        ['an amount over the cap', { amountMinor: maxAmountMinor + 1 }],
        ['another currency', { currency: 'EUR' }],
        [
          'metadata that is not a uuid',
          { metadata: { orderId: 'o', recordId: 'r' } },
        ],
        ['missing metadata', { metadata: undefined }],
        ['an empty key', { idempotencyKey: '' }],
        ['a key over 255 characters', { idempotencyKey: 'k'.repeat(256) }],
      ])('refuses %s without creating anything', async (_, overrides) => {
        await expectCode(
          h.port.createPayment({ ...paymentInput(1), ...overrides } as never),
          'invalid_input',
        );

        expect(
          await h.port.retrieve({ kind: 'payment', metadata: metadata(1, 10) }),
        ).toBeNull();
      });
    });

    describe('retrieve', () => {
      it('finds a payment by id and by metadata', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        expect(
          await h.port.retrieve({ kind: 'payment', id: created.id }),
        ).toEqual(created);
        expect(
          await h.port.retrieve({
            kind: 'payment',
            metadata: created.metadata,
          }),
        ).toEqual(created);
      });

      it('finds a refund and a transfer by id and by metadata', async () => {
        const payment = await paidPayment();
        const refund = await h.port.refund(refundInput(payment.id, 2, 1_000));
        const transfer = await h.port.transfer({
          idempotencyKey: `transfer:${uuid(1)}`,
          destinationAccountId: h.destinationAccountId,
          amountMinor: 1_000,
          currency: 'USD',
          metadata: metadata(1, 3),
        });

        expect(
          await h.port.retrieve({ kind: 'refund', id: refund.id }),
        ).toEqual(refund);
        expect(
          await h.port.retrieve({ kind: 'refund', metadata: refund.metadata }),
        ).toEqual(refund);
        expect(
          await h.port.retrieve({ kind: 'transfer', id: transfer.id }),
        ).toEqual(transfer);
        expect(
          await h.port.retrieve({
            kind: 'transfer',
            metadata: transfer.metadata,
          }),
        ).toEqual(transfer);
      });

      it('returns null for an unknown id and for unknown metadata', async () => {
        expect(
          await h.port.retrieve({ kind: 'payment', id: 'pay_missing' }),
        ).toBeNull();
        expect(
          await h.port.retrieve({ kind: 'payment', metadata: metadata(9, 9) }),
        ).toBeNull();
      });

      it('returns null when the metadata belongs to another kind of object', async () => {
        const payment = await paidPayment();
        const refund = await h.port.refund(refundInput(payment.id, 2, 1_000));

        expect(
          await h.port.retrieve({ kind: 'payment', metadata: refund.metadata }),
        ).toBeNull();
        expect(
          await h.port.retrieve({ kind: 'transfer', id: payment.id }),
        ).toBeNull();
      });

      it('refuses an empty id', async () => {
        await expectCode(
          h.port.retrieve({ kind: 'payment', id: '' }),
          'invalid_input',
        );
      });
    });

    describe('settlement', () => {
      it('reports the fee and method on success and emits payment.succeeded with the same amount and fee', async () => {
        const payment = await paidPayment();

        expect(payment.status).toBe('succeeded');
        expect(payment.method).toBe('card');
        expect(payment.feeMinor).toBeGreaterThan(0);
        expect(payment.feeMinor).toBeLessThan(payment.amountMinor);
        expect(await lastEvent()).toMatchObject({
          provider: h.port.provider,
          type: 'payment.succeeded',
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
          currency: 'USD',
          feeMinor: payment.feeMinor,
          method: 'card',
        });
      });

      it('raises the balance by the amount less the fee', async () => {
        const payment = await paidPayment();

        expect(await balance()).toBe(
          payment.amountMinor - (payment.feeMinor ?? 0),
        );
      });

      it('keeps a declined payment retryable, reports the decline, and lets the next try succeed', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        await h.settle(created.id, 'declined');
        const declined = await mustRetrieve('payment', created.id);
        await h.settle(created.id, 'succeeded');
        const succeeded = await mustRetrieve('payment', created.id);

        expect(declined).toMatchObject({
          status: 'failed_try',
          failedTries: 1,
        });
        expect(declined.failureCode).not.toBeNull();
        expect(succeeded.status).toBe('succeeded');
        expect((await h.events()).map((event) => event.type)).toEqual([
          'payment.failed',
          'payment.succeeded',
        ]);
        expect((await h.events())[0]).toMatchObject({
          objectId: created.id,
          failureCode: declined.failureCode,
          feeMinor: null,
        });
      });

      it('emits payment.requires_action and lets the payment succeed afterwards', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        await h.settle(created.id, 'requires_action');
        const pending = await mustRetrieve('payment', created.id);
        await h.settle(created.id, 'succeeded');

        expect(pending.status).toBe('requires_action');
        expect((await h.events()).map((event) => event.type)).toEqual([
          'payment.requires_action',
          'payment.succeeded',
        ]);
      });

      it('refuses to settle a canceled payment', async () => {
        const created = await h.port.createPayment(paymentInput(1));
        await h.port.cancelPayment({
          idempotencyKey: `cancel:${uuid(1)}`,
          paymentId: created.id,
        });

        await expect(h.settle(created.id, 'succeeded')).rejects.toThrow();
        expect((await mustRetrieve('payment', created.id)).status).toBe(
          'canceled',
        );
      });
    });

    describe('cancelPayment', () => {
      const cancel = (paymentId: string, n = 1) =>
        h.port.cancelPayment({
          idempotencyKey: `cancel:${uuid(n)}`,
          paymentId,
        });

      it('cancels a created payment and emits payment.canceled', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        const canceled = await cancel(created.id);

        expect(canceled.status).toBe('canceled');
        expect(await lastEvent()).toMatchObject({
          type: 'payment.canceled',
          objectId: created.id,
          metadata: created.metadata,
        });
      });

      it('refuses to cancel a succeeded payment', async () => {
        const payment = await paidPayment();

        await expectCode(cancel(payment.id), 'invalid_state');
        expect((await mustRetrieve('payment', payment.id)).status).toBe(
          'succeeded',
        );
      });

      it('refuses an unknown payment', async () => {
        await expectCode(cancel('pay_missing'), 'not_found');
      });

      it('refuses a second cancel under a new key and replays it under the same key', async () => {
        const created = await h.port.createPayment(paymentInput(1));
        const first = await cancel(created.id, 1);

        await expectCode(cancel(created.id, 2), 'invalid_state');
        expect(await cancel(created.id, 1)).toEqual(first);
        expect((await h.events()).map((event) => event.type)).toEqual([
          'payment.canceled',
        ]);
      });
    });

    describe('refund', () => {
      it('refunds part of a succeeded payment, keeps the fee, and emits refund.succeeded', async () => {
        const payment = await paidPayment();

        const refund = await h.port.refund(refundInput(payment.id, 2, 2_500));

        expect(refund).toMatchObject({
          paymentId: payment.id,
          status: 'succeeded',
          amountMinor: 2_500,
          currency: 'USD',
          metadata: metadata(1, 2),
        });
        expect(await mustRetrieve('payment', payment.id)).toMatchObject({
          status: 'succeeded',
          refundedMinor: 2_500,
          feeMinor: payment.feeMinor,
        });
        expect(await lastEvent()).toMatchObject({
          type: 'refund.succeeded',
          objectId: refund.id,
          metadata: refund.metadata,
          amountMinor: 2_500,
          currency: 'USD',
        });
      });

      it('lowers the balance by the refund alone', async () => {
        const payment = await paidPayment();
        const before = await balance();

        await h.port.refund(refundInput(payment.id, 2, 2_500));

        expect(await balance()).toBe(before - 2_500);
      });

      it('refuses a refund over what is left and changes nothing', async () => {
        const payment = await paidPayment();
        await h.port.refund(refundInput(payment.id, 2, 6_000));
        const before = await balance();
        const eventCount = (await h.events()).length;

        await expectCode(
          h.port.refund(refundInput(payment.id, 3, 4_001)),
          'refund_exceeds_captured',
        );

        expect(await balance()).toBe(before);
        expect((await h.events()).length).toBe(eventCount);
        expect(
          await h.port.retrieve({ kind: 'refund', metadata: metadata(1, 3) }),
        ).toBeNull();
        expect(
          await h.port.refund(refundInput(payment.id, 3, 4_000)),
        ).toMatchObject({
          status: 'succeeded',
        });
      });

      it.each([
        ['created', false],
        ['canceled', true],
      ])('refuses a refund of a %s payment', async (_, cancelFirst) => {
        const created = await h.port.createPayment(paymentInput(1));
        if (cancelFirst) {
          await h.port.cancelPayment({
            idempotencyKey: `cancel:${uuid(1)}`,
            paymentId: created.id,
          });
        }

        await expectCode(
          h.port.refund(refundInput(created.id, 2, 100)),
          'invalid_state',
        );
      });

      it('refuses an unknown payment', async () => {
        await expectCode(
          h.port.refund(refundInput('pay_missing', 2, 100)),
          'not_found',
        );
      });

      it('replays on the same key and refuses the key with another amount', async () => {
        const payment = await paidPayment();
        const first = await h.port.refund(refundInput(payment.id, 2, 2_500));

        expect(await h.port.refund(refundInput(payment.id, 2, 2_500))).toEqual(
          first,
        );
        await expectCode(
          h.port.refund(refundInput(payment.id, 2, 2_600)),
          'idempotency_conflict',
        );
        expect((await mustRetrieve('payment', payment.id)).refundedMinor).toBe(
          2_500,
        );
      });
    });

    describe('transfer', () => {
      const transferInput = (amountMinor: number, n = 1) => ({
        idempotencyKey: `transfer:${uuid(n)}`,
        destinationAccountId: h.destinationAccountId,
        amountMinor,
        currency: 'USD' as const,
        metadata: metadata(1, n),
      });

      it('pays a transfer within the balance and emits transfer.paid', async () => {
        await paidPayment();
        const before = await balance();

        const transfer = await h.port.transfer(transferInput(5_000));

        expect(transfer).toMatchObject({
          destinationAccountId: h.destinationAccountId,
          status: 'paid',
          amountMinor: 5_000,
          reversedMinor: 0,
          currency: 'USD',
          metadata: metadata(1, 1),
        });
        expect(await balance()).toBe(before - 5_000);
        expect(await lastEvent()).toMatchObject({
          type: 'transfer.paid',
          objectId: transfer.id,
          metadata: transfer.metadata,
          amountMinor: 5_000,
        });
      });

      it('refuses a transfer over the balance and changes nothing', async () => {
        await paidPayment();
        const before = await balance();
        const eventCount = (await h.events()).length;

        await expectCode(
          h.port.transfer(transferInput(before + 1)),
          'balance_insufficient',
        );

        expect(await balance()).toBe(before);
        expect((await h.events()).length).toBe(eventCount);
      });

      it('replays on the same key and refuses the key with another amount', async () => {
        await paidPayment();
        const first = await h.port.transfer(transferInput(1_000));

        expect(await h.port.transfer(transferInput(1_000))).toEqual(first);
        await expectCode(
          h.port.transfer(transferInput(1_001)),
          'idempotency_conflict',
        );
        expect(
          (await h.events()).filter((e) => e.type === 'transfer.paid'),
        ).toHaveLength(1);
      });
    });

    describe('reverseTransfer', () => {
      async function paidTransfer(amountMinor = 5_000) {
        await paidPayment();
        return h.port.transfer({
          idempotencyKey: `transfer:${uuid(1)}`,
          destinationAccountId: h.destinationAccountId,
          amountMinor,
          currency: 'USD',
          metadata: metadata(1, 1),
        });
      }

      const reversalInput = (
        transferId: string,
        amountMinor: number,
        n = 2,
      ) => ({
        idempotencyKey: `reversal:${uuid(n)}`,
        transferId,
        amountMinor,
        metadata: metadata(1, n),
      });

      it('reverses part of a transfer, raises the balance, and emits transfer.reversed', async () => {
        const transfer = await paidTransfer();
        const before = await balance();

        const reversal = await h.port.reverseTransfer(
          reversalInput(transfer.id, 1_000),
        );

        expect(reversal).toMatchObject({
          transferId: transfer.id,
          amountMinor: 1_000,
          currency: 'USD',
          metadata: metadata(1, 2),
        });
        expect(await mustRetrieve('transfer', transfer.id)).toMatchObject({
          status: 'paid',
          reversedMinor: 1_000,
        });
        expect(await balance()).toBe(before + 1_000);
        expect(await lastEvent()).toMatchObject({
          type: 'transfer.reversed',
          objectId: transfer.id,
          metadata: reversal.metadata,
          amountMinor: 1_000,
        });
      });

      it('marks a fully reversed transfer reversed', async () => {
        const transfer = await paidTransfer();

        await h.port.reverseTransfer(reversalInput(transfer.id, 5_000));

        expect(await mustRetrieve('transfer', transfer.id)).toMatchObject({
          status: 'reversed',
          reversedMinor: 5_000,
        });
      });

      it('refuses to reverse more than remains', async () => {
        const transfer = await paidTransfer();
        await h.port.reverseTransfer(reversalInput(transfer.id, 3_000, 2));
        const before = await balance();

        await expectCode(
          h.port.reverseTransfer(reversalInput(transfer.id, 2_001, 3)),
          'reversal_exceeds_transferred',
        );

        expect(await balance()).toBe(before);
        expect(
          (await mustRetrieve('transfer', transfer.id)).reversedMinor,
        ).toBe(3_000);
      });

      it('refuses an unknown transfer', async () => {
        await expectCode(
          h.port.reverseTransfer(reversalInput('tr_missing', 100)),
          'not_found',
        );
      });

      it('replays on the same key and refuses the key with another amount', async () => {
        const transfer = await paidTransfer();
        const first = await h.port.reverseTransfer(
          reversalInput(transfer.id, 1_000),
        );

        expect(
          await h.port.reverseTransfer(reversalInput(transfer.id, 1_000)),
        ).toEqual(first);
        await expectCode(
          h.port.reverseTransfer(reversalInput(transfer.id, 1_001)),
          'idempotency_conflict',
        );
        expect(
          (await mustRetrieve('transfer', transfer.id)).reversedMinor,
        ).toBe(1_000);
      });
    });

    describe('verifyWebhook', () => {
      it('returns the emitted event from a delivery', async () => {
        await paidPayment();
        const event = await lastEvent();

        const verified = await h.port.verifyWebhook(await h.deliver(event));

        expect(verified).toEqual(event);
        expect(verified.occurredAt).toBeInstanceOf(Date);
      });

      it('refuses a wrong signature', async () => {
        await paidPayment();
        const delivery = await h.deliver(await lastEvent());
        const flipped = delivery.signature.endsWith('0') ? '1' : '0';

        await expectCode(
          h.port.verifyWebhook({
            rawBody: delivery.rawBody,
            signature: delivery.signature.slice(0, -1) + flipped,
          }),
          'invalid_signature',
        );
      });

      it('refuses a tampered body', async () => {
        await paidPayment();
        const delivery = await h.deliver(await lastEvent());

        await expectCode(
          h.port.verifyWebhook({
            rawBody: delivery.rawBody.replace('10000', '10001'),
            signature: delivery.signature,
          }),
          'invalid_signature',
        );
      });

      it.each(['', 'nonsense', 'v1=abc', 't=1,v1=zz'])(
        'refuses the malformed signature %j',
        async (signature) => {
          await paidPayment();
          const delivery = await h.deliver(await lastEvent());

          await expect(
            h.port.verifyWebhook({ rawBody: delivery.rawBody, signature }),
          ).rejects.toMatchObject({ name: 'PaymentsError' });
        },
      );

      it('refuses a body over the size limit before checking it', async () => {
        await expectCode(
          h.port.verifyWebhook({
            rawBody: 'x'.repeat(maxWebhookBodyLength + 1),
            signature: 't=1,v1=' + '0'.repeat(64),
          }),
          'invalid_input',
        );
      });
    });

    describe('getBalance', () => {
      it('starts at zero in USD', async () => {
        expect(await h.port.getBalance()).toEqual({
          availableMinor: 0,
          currency: 'USD',
        });
      });

      it('nets charges, fees, refunds, transfers, and reversals', async () => {
        const payment = await paidPayment(1, 10_000);
        await h.port.refund(refundInput(payment.id, 2, 2_500));
        const transfer = await h.port.transfer({
          idempotencyKey: `transfer:${uuid(1)}`,
          destinationAccountId: h.destinationAccountId,
          amountMinor: 5_000,
          currency: 'USD',
          metadata: metadata(1, 3),
        });
        await h.port.reverseTransfer({
          idempotencyKey: `reversal:${uuid(4)}`,
          transferId: transfer.id,
          amountMinor: 1_000,
          metadata: metadata(1, 4),
        });

        expect(await balance()).toBe(
          10_000 - (payment.feeMinor ?? 0) - 2_500 - 5_000 + 1_000,
        );
      });
    });
  });
}
