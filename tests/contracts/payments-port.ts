import { beforeEach, describe, expect, it } from 'vitest';
import {
  maxAmountMinor,
  maxWebhookBodyLength,
  minAmountMinor,
  type ObjectKind,
  type Payment,
  type PaymentsErrorCode,
  type PaymentsPort,
  type ProviderEvent,
  type ProviderObject,
  type RambleMetadata,
  type WebhookDelivery,
} from '@/server/ports/payments';

type SettlementOutcome = 'succeeded' | 'declined' | 'requires_action';

/**
 * What an adapter's test supplies so the shared suite can drive it. The fake answers
 * everything at once; a Stripe harness confirms with test cards, reads events from the
 * CLI forwarder, and sets `poll` so the suite waits for them.
 */
export type PaymentsContractHarness = {
  port: PaymentsPort;
  /** A provider account the port may transfer to. */
  destinationAccountId: string;
  /** How far from now a delivery's signature timestamp may be before the port refuses it. */
  signatureToleranceSeconds: number;
  /** How the suite waits for provider state and events; one immediate read by default. */
  poll?: { intervalMs: number; attempts: number };
  /** Has the provider report `outcome` for a payment, as the guest's card would. */
  settle(paymentId: string, outcome: SettlementOutcome): Promise<void>;
  /** Every event the provider has emitted so far, oldest first. */
  events(): Promise<ProviderEvent[]>;
  /** The event as the provider would deliver it, signed `offsetSeconds` from now. */
  deliver(
    event: ProviderEvent,
    offsetSeconds?: number,
  ): Promise<WebhookDelivery>;
  /** A genuine delivery of an event type the port does not handle. */
  ignoredDelivery(): Promise<WebhookDelivery>;
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

const refundInput = (
  paymentId: string,
  n: number,
  amountMinor: number,
  withMetadata = metadata(1, n),
) => ({
  idempotencyKey: `refund:${uuid(n)}`,
  paymentId,
  amountMinor,
  metadata: withMetadata,
});

type InvalidCase = [label: string, overrides: Record<string, unknown>];

const amountCases: InvalidCase[] = [
  ['a zero amount', { amountMinor: 0 }],
  ['a negative amount', { amountMinor: -100 }],
  ['a fractional amount', { amountMinor: 10.5 }],
  ['an amount over the cap', { amountMinor: maxAmountMinor + 1 }],
];

const keyAndMetadataCases: InvalidCase[] = [
  [
    'metadata that is not a uuid',
    { metadata: { orderId: 'o', recordId: 'r' } },
  ],
  ['missing metadata', { metadata: undefined }],
  ['an empty key', { idempotencyKey: '' }],
  ['a key over 255 characters', { idempotencyKey: 'k'.repeat(256) }],
];

const createPaymentCases: InvalidCase[] = [
  ...amountCases,
  ['an amount under the minimum charge', { amountMinor: minAmountMinor - 1 }],
  ['another currency', { currency: 'EUR' }],
  ...keyAndMetadataCases,
];

const cancelPaymentCases: InvalidCase[] = [
  ['an empty key', { idempotencyKey: '' }],
  ['a key over 255 characters', { idempotencyKey: 'k'.repeat(256) }],
  ['an empty payment id', { paymentId: '' }],
  ['a missing payment id', { paymentId: undefined }],
];

const refundCases: InvalidCase[] = [
  ...amountCases,
  ...keyAndMetadataCases,
  ['an empty payment id', { paymentId: '' }],
];

const transferCases: InvalidCase[] = [
  ...amountCases,
  ...keyAndMetadataCases,
  ['another currency', { currency: 'EUR' }],
  ['an empty destination', { destinationAccountId: '' }],
  [
    'a destination over 255 characters',
    { destinationAccountId: 'a'.repeat(256) },
  ],
];

const reversalCases: InvalidCase[] = [
  ...amountCases,
  ...keyAndMetadataCases,
  ['an empty transfer id', { transferId: '' }],
];

async function expectCode(work: Promise<unknown>, code: PaymentsErrorCode) {
  await expect(work).rejects.toMatchObject({ name: 'PaymentsError', code });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
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

    /** Reads until `ready` holds or the harness's poll budget is spent; returns the last read. */
    async function eventually<T>(
      read: () => Promise<T>,
      ready: (value: T) => boolean,
    ): Promise<T> {
      const { intervalMs, attempts } = h.poll ?? { intervalMs: 0, attempts: 1 };
      let value = await read();
      for (let attempt = 1; attempt < attempts && !ready(value); attempt += 1) {
        await sleep(intervalMs);
        value = await read();
      }
      return value;
    }

    async function mustRetrieve<K extends ObjectKind>(
      kind: K,
      id: string,
      ready: (object: ProviderObject<K>) => boolean = () => true,
    ): Promise<ProviderObject<K>> {
      const found = await eventually(
        () => h.port.retrieve({ kind, id }),
        (object) => object !== null && ready(object),
      );
      if (!found) throw new Error(`Expected ${kind} ${id} to exist`);
      return found;
    }

    function eventTypes(): Promise<string[]> {
      return h.events().then((events) => events.map((event) => event.type));
    }

    async function eventsOnce(count: number): Promise<ProviderEvent[]> {
      return eventually(
        () => h.events(),
        (events) => events.length >= count,
      );
    }

    async function lastEvent(
      ofType: ProviderEvent['type'],
    ): Promise<ProviderEvent> {
      const events = await eventually(
        () => h.events(),
        (list) => list.some((event) => event.type === ofType),
      );
      const found = events.findLast((event) => event.type === ofType);
      if (!found) throw new Error(`Expected a ${ofType} event`);
      return found;
    }

    async function paidPayment(n = 1, amountMinor = 10_000): Promise<Payment> {
      const created = await h.port.createPayment(paymentInput(n, amountMinor));
      await h.settle(created.id, 'succeeded');
      return mustRetrieve(
        'payment',
        created.id,
        (payment) => payment.status === 'succeeded',
      );
    }

    async function balance(): Promise<number> {
      return (await h.port.getBalance()).availableMinor;
    }

    async function transferOf(amountMinor: number, n = 1) {
      return h.port.transfer({
        idempotencyKey: `transfer:${uuid(n)}`,
        destinationAccountId: h.destinationAccountId,
        amountMinor,
        currency: 'USD',
        metadata: metadata(1, n),
      });
    }

    const reversalInput = (transferId: string, amountMinor: number, n = 2) => ({
      idempotencyKey: `reversal:${uuid(n)}`,
      transferId,
      amountMinor,
      metadata: metadata(1, n),
    });

    const cancel = (paymentId: string, n = 1) =>
      h.port.cancelPayment({ idempotencyKey: `cancel:${uuid(n)}`, paymentId });

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

      it('accepts the minimum charge', async () => {
        const payment = await h.port.createPayment(
          paymentInput(1, minAmountMinor),
        );

        expect(payment.amountMinor).toBe(minAmountMinor);
      });

      it('replays the first response on the same key and input, even after the payment moved on', async () => {
        const first = await h.port.createPayment(paymentInput(1));
        await h.settle(first.id, 'succeeded');
        await mustRetrieve(
          'payment',
          first.id,
          (p) => p.status === 'succeeded',
        );

        const replayed = await h.port.createPayment(paymentInput(1));

        expect(replayed).toEqual(first);
        expect(replayed.status).toBe('created');
        expect(
          (await h.port.retrieve({ kind: 'payment', id: first.id }))?.status,
        ).toBe('succeeded');
      });

      it('refuses the same key with different input', async () => {
        await h.port.createPayment(paymentInput(1));

        await expectCode(
          h.port.createPayment(paymentInput(1, 10_001)),
          'idempotency_conflict',
        );
      });

      it.each(createPaymentCases)(
        'refuses %s without creating anything',
        async (_, overrides) => {
          await expectCode(
            h.port.createPayment({ ...paymentInput(1), ...overrides }),
            'invalid_input',
          );

          expect(
            await h.port.retrieve({
              kind: 'payment',
              metadata: metadata(1, 10),
            }),
          ).toBeNull();
        },
      );
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

      it('finds a refund, a transfer, and a reversal by id and by metadata', async () => {
        const payment = await paidPayment();
        const refund = await h.port.refund(refundInput(payment.id, 2, 1_000));
        const transfer = await transferOf(1_000, 3);
        for (const [kind, object] of [
          ['refund', refund],
          ['transfer', transfer],
        ] as const) {
          expect(await h.port.retrieve({ kind, id: object.id })).toEqual(
            object,
          );
          expect(
            await h.port.retrieve({ kind, metadata: object.metadata }),
          ).toEqual(object);
        }

        const reversal = await h.port.reverseTransfer(
          reversalInput(transfer.id, 400, 4),
        );

        expect(
          await h.port.retrieve({ kind: 'reversal', id: reversal.id }),
        ).toEqual(reversal);
        expect(
          await h.port.retrieve({
            kind: 'reversal',
            metadata: reversal.metadata,
          }),
        ).toEqual(reversal);
      });

      it('finds each kind when a payment and a refund carry identical metadata', async () => {
        const payment = await paidPayment();
        const refund = await h.port.refund(
          refundInput(payment.id, 2, 1_000, payment.metadata),
        );

        expect(
          await h.port.retrieve({ kind: 'refund', metadata: payment.metadata }),
        ).toEqual(refund);
        expect(
          await h.port.retrieve({
            kind: 'payment',
            metadata: payment.metadata,
          }),
        ).toMatchObject({ id: payment.id, status: 'succeeded' });
      });

      it('returns null for an unknown id and for unknown metadata', async () => {
        expect(
          await h.port.retrieve({ kind: 'payment', id: 'pay_missing' }),
        ).toBeNull();
        expect(
          await h.port.retrieve({ kind: 'payment', metadata: metadata(9, 9) }),
        ).toBeNull();
      });

      it('returns null when the id or metadata belongs to another kind', async () => {
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
        expect(await lastEvent('payment.succeeded')).toMatchObject({
          provider: h.port.provider,
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
          currency: 'USD',
          feeMinor: payment.feeMinor,
          method: 'card',
        });
      });

      it('raises the balance by the amount less the fee', async () => {
        const before = await balance();

        const payment = await paidPayment();

        expect(await balance()).toBe(
          before + payment.amountMinor - (payment.feeMinor ?? 0),
        );
      });

      it('refuses a second success and leaves the balance and events alone', async () => {
        const payment = await paidPayment();
        const before = await balance();
        const eventCount = (await eventsOnce(1)).length;

        await expect(h.settle(payment.id, 'succeeded')).rejects.toThrow();

        expect(await balance()).toBe(before);
        expect((await h.events()).length).toBe(eventCount);
        expect(await mustRetrieve('payment', payment.id)).toMatchObject({
          status: 'succeeded',
          feeMinor: payment.feeMinor,
        });
      });

      it('keeps a declined payment retryable, reports the decline, and lets the next try succeed', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        await h.settle(created.id, 'declined');
        const declined = await mustRetrieve(
          'payment',
          created.id,
          (p) => p.status === 'failed_try',
        );
        await h.settle(created.id, 'succeeded');
        const succeeded = await mustRetrieve(
          'payment',
          created.id,
          (p) => p.status === 'succeeded',
        );

        expect(declined).toMatchObject({
          status: 'failed_try',
          failedTries: 1,
        });
        expect(declined.failureCode).not.toBeNull();
        expect(succeeded.status).toBe('succeeded');
        await eventsOnce(2);
        expect(await eventTypes()).toEqual([
          'payment.failed',
          'payment.succeeded',
        ]);
        expect(await lastEvent('payment.failed')).toMatchObject({
          objectId: created.id,
          failureCode: declined.failureCode,
          feeMinor: null,
        });
      });

      it('emits payment.requires_action and lets the payment succeed afterwards', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        await h.settle(created.id, 'requires_action');
        const pending = await mustRetrieve(
          'payment',
          created.id,
          (p) => p.status === 'requires_action',
        );
        await h.settle(created.id, 'succeeded');

        expect(pending.status).toBe('requires_action');
        await eventsOnce(2);
        expect(await eventTypes()).toEqual([
          'payment.requires_action',
          'payment.succeeded',
        ]);
      });

      it('refuses to settle a canceled payment', async () => {
        const created = await h.port.createPayment(paymentInput(1));
        await cancel(created.id);

        await expect(h.settle(created.id, 'succeeded')).rejects.toThrow();
        expect((await mustRetrieve('payment', created.id)).status).toBe(
          'canceled',
        );
      });
    });

    describe('cancelPayment', () => {
      it('cancels a created payment and emits payment.canceled', async () => {
        const created = await h.port.createPayment(paymentInput(1));

        const canceled = await cancel(created.id);

        expect(canceled.status).toBe('canceled');
        expect(await lastEvent('payment.canceled')).toMatchObject({
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
        await eventsOnce(1);
        expect(await eventTypes()).toEqual(['payment.canceled']);
      });

      it.each(cancelPaymentCases)(
        'refuses %s without cancelling anything',
        async (_, overrides) => {
          const created = await h.port.createPayment(paymentInput(1));

          await expectCode(
            h.port.cancelPayment({
              idempotencyKey: `cancel:${uuid(1)}`,
              paymentId: created.id,
              ...overrides,
            }),
            'invalid_input',
          );

          expect((await mustRetrieve('payment', created.id)).status).toBe(
            'created',
          );
        },
      );
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
        expect(await lastEvent('refund.succeeded')).toMatchObject({
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
        const eventCount = (await eventsOnce(2)).length;

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
        ['created', []],
        ['requires_action', ['requires_action']],
        ['failed_try', ['declined']],
        ['canceled', ['cancel']],
      ] as const)('refuses a refund of a %s payment', async (_, steps) => {
        const created = await h.port.createPayment(paymentInput(1));
        for (const step of steps) {
          if (step === 'cancel') await cancel(created.id);
          else await h.settle(created.id, step);
        }
        const before = await balance();

        await expectCode(
          h.port.refund(refundInput(created.id, 2, 100)),
          'invalid_state',
        );

        expect(await balance()).toBe(before);
        expect((await mustRetrieve('payment', created.id)).refundedMinor).toBe(
          0,
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

      it.each(refundCases)(
        'refuses %s without refunding anything',
        async (_, overrides) => {
          const payment = await paidPayment();
          const before = await balance();

          await expectCode(
            h.port.refund({
              ...refundInput(payment.id, 2, 1_000),
              ...overrides,
            }),
            'invalid_input',
          );

          expect(await balance()).toBe(before);
          expect(
            (await mustRetrieve('payment', payment.id)).refundedMinor,
          ).toBe(0);
        },
      );
    });

    describe('transfer', () => {
      it('pays a transfer within the balance and emits transfer.paid', async () => {
        await paidPayment();
        const before = await balance();

        const transfer = await transferOf(5_000);

        expect(transfer).toMatchObject({
          destinationAccountId: h.destinationAccountId,
          status: 'paid',
          amountMinor: 5_000,
          reversedMinor: 0,
          currency: 'USD',
          metadata: metadata(1, 1),
        });
        expect(await balance()).toBe(before - 5_000);
        expect(await lastEvent('transfer.paid')).toMatchObject({
          objectId: transfer.id,
          metadata: transfer.metadata,
          amountMinor: 5_000,
        });
      });

      it('refuses a transfer over the balance and changes nothing', async () => {
        await paidPayment();
        const before = await balance();
        const eventCount = (await eventsOnce(1)).length;

        await expectCode(transferOf(before + 1), 'balance_insufficient');

        expect(await balance()).toBe(before);
        expect((await h.events()).length).toBe(eventCount);
      });

      it('replays on the same key and refuses the key with another amount', async () => {
        await paidPayment();
        const before = await balance();
        const first = await transferOf(1_000);

        expect(await transferOf(1_000)).toEqual(first);
        await expectCode(transferOf(1_001), 'idempotency_conflict');
        expect(await balance()).toBe(before - 1_000);
      });

      it.each(transferCases)(
        'refuses %s without moving anything',
        async (_, overrides) => {
          await paidPayment();
          const before = await balance();

          await expectCode(
            h.port.transfer({
              idempotencyKey: `transfer:${uuid(1)}`,
              destinationAccountId: h.destinationAccountId,
              amountMinor: 1_000,
              currency: 'USD',
              metadata: metadata(1, 1),
              ...overrides,
            } as never),
            'invalid_input',
          );

          expect(await balance()).toBe(before);
        },
      );
    });

    describe('reverseTransfer', () => {
      async function paidTransfer(amountMinor = 5_000) {
        await paidPayment();
        return transferOf(amountMinor);
      }

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
        expect(await lastEvent('transfer.reversed')).toMatchObject({
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

      it.each(reversalCases)(
        'refuses %s without reversing anything',
        async (_, overrides) => {
          const transfer = await paidTransfer();
          const before = await balance();

          await expectCode(
            h.port.reverseTransfer({
              ...reversalInput(transfer.id, 1_000),
              ...overrides,
            }),
            'invalid_input',
          );

          expect(await balance()).toBe(before);
          expect(
            (await mustRetrieve('transfer', transfer.id)).reversedMinor,
          ).toBe(0);
        },
      );
    });

    describe('verifyWebhook', () => {
      async function succeededEvent(): Promise<ProviderEvent> {
        await paidPayment();
        return lastEvent('payment.succeeded');
      }

      it('returns the emitted event from a delivery', async () => {
        const event = await succeededEvent();

        const verified = await h.port.verifyWebhook(await h.deliver(event));

        expect(verified).toEqual({ status: 'event', event });
        if (verified.status === 'event') {
          expect(verified.event.occurredAt).toBeInstanceOf(Date);
        }
      });

      it('verifies a repeated delivery of the same event with the same id', async () => {
        const event = await succeededEvent();

        const first = await h.port.verifyWebhook(await h.deliver(event));
        const second = await h.port.verifyWebhook(await h.deliver(event));

        expect(second).toEqual(first);
      });

      it('returns ignored for a genuine delivery of a type it does not handle', async () => {
        const verified = await h.port.verifyWebhook(await h.ignoredDelivery());

        expect(verified.status).toBe('ignored');
        if (verified.status === 'ignored') {
          expect(verified.eventId).not.toBe('');
          expect(verified.eventType).not.toBe('');
        }
      });

      it('accepts a delivery signed inside the tolerance', async () => {
        const event = await succeededEvent();
        const inside = h.signatureToleranceSeconds - 1;

        expect(
          await h.port.verifyWebhook(await h.deliver(event, -inside)),
        ).toEqual({ status: 'event', event });
        expect(
          await h.port.verifyWebhook(await h.deliver(event, inside)),
        ).toEqual({ status: 'event', event });
      });

      it.each([
        ['stale', -1],
        ['future-dated', 1],
      ])(
        'refuses a %s delivery signed outside the tolerance',
        async (_, sign) => {
          const event = await succeededEvent();
          const outside = sign * (h.signatureToleranceSeconds + 1);

          await expectCode(
            h.port.verifyWebhook(await h.deliver(event, outside)),
            'invalid_signature',
          );
        },
      );

      it('refuses a wrong signature', async () => {
        const delivery = await h.deliver(await succeededEvent());
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
        const delivery = await h.deliver(await succeededEvent());

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
          const delivery = await h.deliver(await succeededEvent());

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
      it('reports an integer amount in USD', async () => {
        const reported = await h.port.getBalance();

        expect(reported.currency).toBe('USD');
        expect(Number.isInteger(reported.availableMinor)).toBe(true);
      });

      it('nets charges, fees, refunds, transfers, and reversals', async () => {
        const before = await balance();
        const payment = await paidPayment(1, 10_000);
        await h.port.refund(refundInput(payment.id, 2, 2_500));
        const transfer = await transferOf(5_000, 3);
        await h.port.reverseTransfer(reversalInput(transfer.id, 1_000, 4));

        expect(await balance()).toBe(
          before + 10_000 - (payment.feeMinor ?? 0) - 2_500 - 5_000 + 1_000,
        );
      });
    });
  });
}
