import 'server-only';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { fakeCardFeeMinor } from '@/lib/fakeCardFee';
import { orderCurrency as currency } from '@/lib/orders';
import {
  paymentMethods,
  providerEventTypes,
  type ProviderEventType,
} from '@/lib/payments';
import {
  CancelPaymentInputSchema,
  CreatePaymentInputSchema,
  PaymentsError,
  ProviderEventSchema,
  RefundInputSchema,
  RetrieveQuerySchema,
  ReverseTransferInputSchema,
  TransferInputSchema,
  WebhookDeliverySchema,
  type ObjectKind,
  type Payment,
  type PaymentsPort,
  type ProviderEvent,
  type ProviderObject,
  type RambleMetadata,
  type Refund,
  type RetrieveQuery,
  type Transfer,
  type TransferReversal,
  type VerifiedWebhook,
  type WebhookDelivery,
} from './index';

const provider = 'fake';

/** Design doc 4.2.3 and ADR 0002: the fifth failed try cancels the attempt. */
const defaultMaxFailedTries = 5;
/** Authentication challenges one payment may raise before the fake refuses another. */
const maxActionRounds = 3;
/** A delivery signed further than this from now is refused as a replay. */
const signatureToleranceSeconds = 300;
const defaultMaxObjects = 10_000;
const defaultMaxEvents = 100_000;

const FakeOptionsSchema = z.object({
  webhookSecret: z.string().min(16).max(256),
  maxObjects: z.int().positive().max(1_000_000).default(defaultMaxObjects),
  maxEvents: z.int().positive().max(10_000_000).default(defaultMaxEvents),
  maxFailedTries: z.int().positive().max(100).default(defaultMaxFailedTries),
});

export type FakePaymentsOptions = {
  /** Shared secret for the HMAC on every webhook delivery; at least 16 characters. */
  webhookSecret: string;
  /** Time source for event timestamps and signature checks (the Clock port's `now`). */
  now: () => Date;
  /** Payments, refunds, transfers, and reversals held before the fake refuses more. */
  maxObjects?: number;
  /** Events held before the fake refuses any operation that would emit one. */
  maxEvents?: number;
  /** Declines one payment takes before the fake refuses further tries. */
  maxFailedTries?: number;
  /** Pass one to share or persist a fake's objects; a fresh in-memory state otherwise. */
  state?: FakePaymentsState;
};

const settlementOutcomes = [
  'succeeded',
  'declined',
  'requires_action',
] as const;

const ConfirmInputSchema = z.object({
  outcome: z.enum(settlementOutcomes),
  method: z.enum(paymentMethods).default('card'),
  failureCode: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .default('card_declined'),
});
type ConfirmInput = z.input<typeof ConfirmInputSchema>;

type Keyed = { id: string; metadata: RambleMetadata };

export type FakePaymentsState = {
  payments: Map<string, Payment>;
  refunds: Map<string, Refund>;
  transfers: Map<string, Transfer>;
  reversals: Map<string, TransferReversal>;
  /** The response each key produced the first time, replayed on a repeat. */
  idempotency: Map<string, { fingerprint: string; response: Keyed }>;
  /** `${kind}:${orderId}:${recordId}` to the first object of that kind with that metadata. */
  byMetadata: Map<string, string>;
  /** Authentication challenges raised per payment id. */
  actionRounds: Map<string, number>;
  events: ProviderEvent[];
  balanceMinor: number;
};

export function createFakePaymentsState(): FakePaymentsState {
  return {
    payments: new Map(),
    refunds: new Map(),
    transfers: new Map(),
    reversals: new Map(),
    idempotency: new Map(),
    byMetadata: new Map(),
    actionRounds: new Map(),
    events: [],
    balanceMinor: 0,
  };
}

/** What a confirmation did: the payment as it now stands and the one event it emitted. */
type ConfirmedPayment = { payment: Payment; event: ProviderEvent };

/** The fake's simulation surface beyond the port: what the fake card form and tests drive. */
export type FakePaymentsAdapter = PaymentsPort & {
  /** Plays the guest's confirmation: the provider records the outcome and emits its event, which is handed back. */
  confirm(paymentId: string, input: ConfirmInput): Promise<ConfirmedPayment>;
  /** Every event emitted so far, oldest first. */
  emittedEvents(): ProviderEvent[];
  /** Signs an event as a delivery timestamped `signedAt` (now by default), so a late delivery is signed fresh. */
  signWebhook(event: ProviderEvent, signedAt?: Date): WebhookDelivery;
  /** Signs any body, for deliveries the fake would never emit itself. */
  signBody(rawBody: string, signedAt?: Date): WebhookDelivery;
};

type EventFields = {
  type: ProviderEventType;
  objectId: string;
  metadata: RambleMetadata;
  amountMinor: number;
  feeMinor?: number;
  failureCode?: string;
  method?: Payment['method'];
};

const signaturePattern = /^t=(\d{1,12}),v1=([0-9a-f]{64})$/;

const EnvelopeSchema = z
  .object({
    id: z.string().min(1).max(255),
    provider: z.string().min(1).max(32),
    type: z.string().min(1).max(64),
  })
  .loose();

const knownEventTypes: ReadonlySet<string> = new Set(providerEventTypes);

const settleableStatuses: ReadonlySet<Payment['status']> = new Set([
  'created',
  'requires_action',
  'failed_try',
]);

function fakeId(prefix: string, seed: string): string {
  const digest = createHash('sha256').update(seed).digest('hex');
  return `${prefix}_${digest.slice(0, 24)}`;
}

function hmacHex(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message).digest('hex');
}

function metadataKey(kind: ObjectKind, metadata: RambleMetadata): string {
  return `${kind}:${metadata.orderId}:${metadata.recordId}`;
}

function parseOrThrow<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new PaymentsError(
      'invalid_input',
      z.prettifyError(result.error),
      result.error,
    );
  }
  return result.data;
}

function copy<T extends { metadata: RambleMetadata | null }>(object: T): T {
  return {
    ...object,
    metadata: object.metadata ? { ...object.metadata } : null,
  };
}

function settled<T>(work: () => T): Promise<T> {
  return Promise.resolve().then(work);
}

function invalidState(payment: Payment): PaymentsError {
  return new PaymentsError(
    'invalid_state',
    `Payment ${payment.id} is ${payment.status}`,
  );
}

export function createFakePaymentsAdapter(
  options: FakePaymentsOptions,
): FakePaymentsAdapter {
  const { webhookSecret, maxObjects, maxEvents, maxFailedTries } = parseOrThrow(
    FakeOptionsSchema,
    {
      webhookSecret: options.webhookSecret,
      maxObjects: options.maxObjects,
      maxEvents: options.maxEvents,
      maxFailedTries: options.maxFailedTries,
    },
  );
  const { now } = options;
  const state = options.state ?? createFakePaymentsState();
  const stores: { [Kind in ObjectKind]: Map<string, ProviderObject<Kind>> } = {
    payment: state.payments,
    refund: state.refunds,
    transfer: state.transfers,
    reversal: state.reversals,
  };

  /** Every write emits an event, and a create also holds an object; both are refused at their cap before anything changes. */
  function ensureCapacity(creating: boolean): void {
    if (state.events.length >= maxEvents) {
      throw new PaymentsError(
        'provider_unavailable',
        `The fake gateway holds its limit of ${String(maxEvents)} events`,
      );
    }
    const held =
      state.payments.size +
      state.refunds.size +
      state.transfers.size +
      state.reversals.size;
    if (creating && held >= maxObjects) {
      throw new PaymentsError(
        'provider_unavailable',
        `The fake gateway holds its limit of ${String(maxObjects)} objects`,
      );
    }
  }

  function find<K extends ObjectKind>(
    kind: K,
    id: string,
  ): ProviderObject<K> | undefined {
    return stores[kind].get(id);
  }

  function mustFind<K extends ObjectKind>(
    kind: K,
    id: string,
  ): ProviderObject<K> {
    const found = find(kind, id);
    if (!found) throw new PaymentsError('not_found', `No ${kind} ${id}`);
    return found;
  }

  function store<K extends ObjectKind>(
    kind: K,
    object: ProviderObject<K>,
  ): void {
    stores[kind].set(object.id, object);
    const key = metadataKey(kind, object.metadata);
    if (!state.byMetadata.has(key)) {
      state.byMetadata.set(key, object.id);
    }
  }

  function emit(fields: EventFields): ProviderEvent {
    const sequence = state.events.length;
    const event: ProviderEvent = {
      id: fakeId(
        'evt',
        `${String(sequence)}:${fields.type}:${fields.objectId}`,
      ),
      provider,
      type: fields.type,
      objectId: fields.objectId,
      metadata: { ...fields.metadata },
      amountMinor: fields.amountMinor,
      currency,
      feeMinor: fields.feeMinor ?? null,
      failureCode: fields.failureCode ?? null,
      method: fields.method ?? null,
      occurredAt: now(),
    };
    state.events.push(event);
    return copy(event);
  }

  /**
   * Replays the first response a key produced when the input matches, refuses the key
   * when it does not, and otherwise runs `create` and records its response.
   */
  function idempotent<T extends Keyed>(
    idempotencyKey: string,
    fingerprintParts: readonly unknown[],
    create: () => T,
  ): T {
    const fingerprint = JSON.stringify(fingerprintParts);
    const seen = state.idempotency.get(idempotencyKey);
    if (seen) {
      if (seen.fingerprint !== fingerprint) {
        throw new PaymentsError(
          'idempotency_conflict',
          `Key ${idempotencyKey} was used with different input`,
        );
      }
      return copy(seen.response as T);
    }
    const response = copy(create());
    state.idempotency.set(idempotencyKey, { fingerprint, response });
    return copy(response);
  }

  function confirm(
    paymentId: string,
    rawInput: ConfirmInput,
  ): ConfirmedPayment {
    const input = parseOrThrow(ConfirmInputSchema, rawInput);
    const payment = mustFind('payment', paymentId);
    if (!settleableStatuses.has(payment.status)) throw invalidState(payment);
    if (payment.failedTries >= maxFailedTries) {
      throw new PaymentsError(
        'invalid_state',
        `Payment ${payment.id} has had ${String(maxFailedTries)} failed tries`,
      );
    }
    const rounds = state.actionRounds.get(payment.id) ?? 0;
    if (input.outcome === 'requires_action' && rounds >= maxActionRounds) {
      throw new PaymentsError(
        'invalid_state',
        `Payment ${payment.id} has had ${String(maxActionRounds)} authentication challenges`,
      );
    }
    ensureCapacity(false);
    switch (input.outcome) {
      case 'succeeded': {
        const feeMinor = fakeCardFeeMinor(payment.amountMinor);
        payment.status = 'succeeded';
        payment.feeMinor = feeMinor;
        payment.method = input.method;
        state.balanceMinor += payment.amountMinor - feeMinor;
        const event = emit({
          type: 'payment.succeeded',
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
          feeMinor,
          method: input.method,
        });
        return { payment: copy(payment), event };
      }
      case 'declined': {
        payment.status = 'failed_try';
        payment.failedTries += 1;
        payment.failureCode = input.failureCode;
        const event = emit({
          type: 'payment.failed',
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
          failureCode: input.failureCode,
        });
        return { payment: copy(payment), event };
      }
      case 'requires_action': {
        payment.status = 'requires_action';
        state.actionRounds.set(payment.id, rounds + 1);
        const event = emit({
          type: 'payment.requires_action',
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
        });
        return { payment: copy(payment), event };
      }
    }
  }

  function createPayment(rawInput: unknown): Payment {
    const input = parseOrThrow(CreatePaymentInputSchema, rawInput);
    return idempotent(
      input.idempotencyKey,
      ['createPayment', input.amountMinor, input.currency, input.metadata],
      () => {
        ensureCapacity(true);
        const id = fakeId('pay', input.idempotencyKey);
        const secret = hmacHex(webhookSecret, `client_secret:${id}`);
        const payment: Payment = {
          id,
          provider,
          status: 'created',
          amountMinor: input.amountMinor,
          currency: input.currency,
          feeMinor: null,
          refundedMinor: 0,
          method: null,
          failureCode: null,
          failedTries: 0,
          clientSecret: `${id}_secret_${secret.slice(0, 24)}`,
          metadata: input.metadata,
        };
        store('payment', payment);
        return payment;
      },
    );
  }

  function cancelPayment(rawInput: unknown): Payment {
    const input = parseOrThrow(CancelPaymentInputSchema, rawInput);
    return idempotent(
      input.idempotencyKey,
      ['cancelPayment', input.paymentId],
      () => {
        const payment = mustFind('payment', input.paymentId);
        if (!settleableStatuses.has(payment.status))
          throw invalidState(payment);
        ensureCapacity(false);
        payment.status = 'canceled';
        emit({
          type: 'payment.canceled',
          objectId: payment.id,
          metadata: payment.metadata,
          amountMinor: payment.amountMinor,
        });
        return payment;
      },
    );
  }

  function retrieve<K extends ObjectKind>(
    rawQuery: RetrieveQuery<K>,
  ): ProviderObject<K> | null {
    const query = parseOrThrow(RetrieveQuerySchema, rawQuery);
    const { kind } = rawQuery;
    const id =
      'id' in query
        ? query.id
        : state.byMetadata.get(metadataKey(kind, query.metadata));
    const found = id === undefined ? undefined : find(kind, id);
    return found ? copy(found) : null;
  }

  function refund(rawInput: unknown): Refund {
    const input = parseOrThrow(RefundInputSchema, rawInput);
    return idempotent(
      input.idempotencyKey,
      ['refund', input.paymentId, input.amountMinor, input.metadata],
      () => {
        const payment = mustFind('payment', input.paymentId);
        if (payment.status !== 'succeeded') throw invalidState(payment);
        const refundable = payment.amountMinor - payment.refundedMinor;
        if (input.amountMinor > refundable) {
          throw new PaymentsError(
            'refund_exceeds_captured',
            `${String(input.amountMinor)} exceeds the ${String(refundable)} left on ${payment.id}`,
          );
        }
        ensureCapacity(true);
        const created: Refund = {
          id: fakeId('re', input.idempotencyKey),
          paymentId: payment.id,
          status: 'succeeded',
          amountMinor: input.amountMinor,
          currency,
          failureCode: null,
          metadata: input.metadata,
        };
        payment.refundedMinor += input.amountMinor;
        state.balanceMinor -= input.amountMinor;
        store('refund', created);
        emit({
          type: 'refund.succeeded',
          objectId: created.id,
          metadata: created.metadata,
          amountMinor: created.amountMinor,
        });
        return created;
      },
    );
  }

  function transfer(rawInput: unknown): Transfer {
    const input = parseOrThrow(TransferInputSchema, rawInput);
    return idempotent(
      input.idempotencyKey,
      [
        'transfer',
        input.destinationAccountId,
        input.amountMinor,
        input.currency,
        input.metadata,
      ],
      () => {
        if (input.amountMinor > state.balanceMinor) {
          throw new PaymentsError(
            'balance_insufficient',
            `${String(input.amountMinor)} exceeds the available ${String(state.balanceMinor)}`,
          );
        }
        ensureCapacity(true);
        const created: Transfer = {
          id: fakeId('tr', input.idempotencyKey),
          destinationAccountId: input.destinationAccountId,
          status: 'paid',
          amountMinor: input.amountMinor,
          reversedMinor: 0,
          currency: input.currency,
          metadata: input.metadata,
        };
        state.balanceMinor -= input.amountMinor;
        store('transfer', created);
        emit({
          type: 'transfer.paid',
          objectId: created.id,
          metadata: created.metadata,
          amountMinor: created.amountMinor,
        });
        return created;
      },
    );
  }

  function reverseTransfer(rawInput: unknown): TransferReversal {
    const input = parseOrThrow(ReverseTransferInputSchema, rawInput);
    return idempotent(
      input.idempotencyKey,
      ['reverseTransfer', input.transferId, input.amountMinor, input.metadata],
      () => {
        const target = mustFind('transfer', input.transferId);
        const reversible = target.amountMinor - target.reversedMinor;
        if (input.amountMinor > reversible) {
          throw new PaymentsError(
            'reversal_exceeds_transferred',
            `${String(input.amountMinor)} exceeds the ${String(reversible)} left on ${target.id}`,
          );
        }
        ensureCapacity(true);
        const created: TransferReversal = {
          id: fakeId('trr', input.idempotencyKey),
          transferId: target.id,
          amountMinor: input.amountMinor,
          currency,
          metadata: input.metadata,
        };
        target.reversedMinor += input.amountMinor;
        if (target.reversedMinor === target.amountMinor) {
          target.status = 'reversed';
        }
        state.balanceMinor += input.amountMinor;
        store('reversal', created);
        emit({
          type: 'transfer.reversed',
          objectId: target.id,
          metadata: created.metadata,
          amountMinor: created.amountMinor,
        });
        return created;
      },
    );
  }

  function signBody(rawBody: string, signedAt = now()): WebhookDelivery {
    const timestamp = String(Math.floor(signedAt.getTime() / 1_000));
    const digest = hmacHex(webhookSecret, `${timestamp}.${rawBody}`);
    return { rawBody, signature: `t=${timestamp},v1=${digest}` };
  }

  function verifyWebhook(rawDelivery: unknown): VerifiedWebhook {
    const delivery = parseOrThrow(WebhookDeliverySchema, rawDelivery);
    const match = signaturePattern.exec(delivery.signature);
    if (!match) {
      throw new PaymentsError('invalid_signature', 'Malformed signature');
    }
    const [, timestamp = '', given = ''] = match;
    const expected = hmacHex(webhookSecret, `${timestamp}.${delivery.rawBody}`);
    const matches = timingSafeEqual(
      Buffer.from(given, 'hex'),
      Buffer.from(expected, 'hex'),
    );
    if (!matches) {
      throw new PaymentsError('invalid_signature', 'Signature does not match');
    }
    const nowSeconds = Math.floor(now().getTime() / 1_000);
    if (Math.abs(nowSeconds - Number(timestamp)) > signatureToleranceSeconds) {
      throw new PaymentsError(
        'invalid_signature',
        'Signature timestamp is outside the tolerance',
      );
    }
    let body: unknown;
    try {
      body = JSON.parse(delivery.rawBody);
    } catch (error) {
      throw new PaymentsError('invalid_input', 'Body is not JSON', error);
    }
    const envelope = parseOrThrow(EnvelopeSchema, body);
    if (envelope.provider !== provider) {
      throw new PaymentsError(
        'invalid_input',
        `Event is from ${envelope.provider}, not the fake provider`,
      );
    }
    if (!knownEventTypes.has(envelope.type)) {
      return {
        status: 'ignored',
        eventId: envelope.id,
        eventType: envelope.type,
      };
    }
    return { status: 'event', event: parseOrThrow(ProviderEventSchema, body) };
  }

  return {
    provider,
    createPayment: (input) => settled(() => createPayment(input)),
    cancelPayment: (input) => settled(() => cancelPayment(input)),
    retrieve: (query) => settled(() => retrieve(query)),
    refund: (input) => settled(() => refund(input)),
    transfer: (input) => settled(() => transfer(input)),
    reverseTransfer: (input) => settled(() => reverseTransfer(input)),
    verifyWebhook: (delivery) => settled(() => verifyWebhook(delivery)),
    getBalance: () =>
      Promise.resolve({ availableMinor: state.balanceMinor, currency }),
    confirm: (paymentId, input) => settled(() => confirm(paymentId, input)),
    emittedEvents: () => state.events.map(copy),
    signWebhook: (event, signedAt) => signBody(JSON.stringify(event), signedAt),
    signBody,
  };
}
