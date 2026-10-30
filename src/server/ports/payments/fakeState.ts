import 'server-only';
import { z } from 'zod';
import {
  attemptStatuses,
  fakeGatewayLimits,
  maxFailedTries,
  paymentLimits,
  paymentMethods,
  paymentProviders,
} from '@/lib/payments';
import type { FakePaymentsState } from './fake';
import {
  CurrencySchema,
  maxAmountMinor,
  ProviderEventSchema,
  ProviderIdSchema,
  RambleMetadataSchema,
  type Payment,
  type ProviderEvent,
  type Refund,
  type Transfer,
  type TransferReversal,
} from './index';

// The fake gateway's state as the one jsonb row keeps it. JSON has no Maps and no Dates, so each Map
// becomes a list of entries and `occurredAt` becomes its ISO text. Reading is strict: a row that does
// not parse throws and nothing is repaired, so a damaged row stops payments instead of changing them.

const {
  maxObjects,
  maxEvents,
  maxIdempotencyKeys,
  maxFingerprintLength,
  maxClientSecretLength,
  maxActionRounds,
} = fakeGatewayLimits;

const AmountSchema = z.int().min(0).max(maxAmountMinor);
// The port's schemas drop a key they do not know; a stored row must not be quietly changed by a read.
const StrictMetadataSchema = RambleMetadataSchema.strict();
const StrictEventSchema = ProviderEventSchema.extend({
  metadata: StrictMetadataSchema.nullable(),
}).strict();
const FailureCodeSchema = z.string().max(paymentLimits.failureCode).nullable();

const PaymentSchema = z.strictObject({
  id: ProviderIdSchema,
  provider: z.enum(paymentProviders),
  status: z.enum(attemptStatuses),
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  feeMinor: AmountSchema.nullable(),
  refundedMinor: AmountSchema,
  method: z.enum(paymentMethods).nullable(),
  failureCode: FailureCodeSchema,
  failedTries: z.int().min(0).max(maxFailedTries),
  clientSecret: z.string().min(1).max(maxClientSecretLength),
  metadata: StrictMetadataSchema,
}) satisfies z.ZodType<Payment>;

const RefundSchema = z.strictObject({
  id: ProviderIdSchema,
  paymentId: ProviderIdSchema,
  status: z.enum(['pending', 'succeeded', 'failed']),
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  failureCode: FailureCodeSchema,
  metadata: StrictMetadataSchema,
}) satisfies z.ZodType<Refund>;

const TransferSchema = z.strictObject({
  id: ProviderIdSchema,
  destinationAccountId: ProviderIdSchema,
  status: z.enum(['paid', 'failed', 'reversed']),
  amountMinor: AmountSchema,
  reversedMinor: AmountSchema,
  currency: CurrencySchema,
  metadata: StrictMetadataSchema,
}) satisfies z.ZodType<Transfer>;

const ReversalSchema = z.strictObject({
  id: ProviderIdSchema,
  transferId: ProviderIdSchema,
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  metadata: StrictMetadataSchema,
}) satisfies z.ZodType<TransferReversal>;

const entries = <T extends z.ZodType>(value: T, max: number) =>
  z.array(z.tuple([ProviderIdSchema, value])).max(max);

const StoredStateSchema = z.strictObject({
  payments: entries(PaymentSchema, maxObjects),
  refunds: entries(RefundSchema, maxObjects),
  transfers: entries(TransferSchema, maxObjects),
  reversals: entries(ReversalSchema, maxObjects),
  idempotency: z
    .array(
      z.tuple([
        ProviderIdSchema,
        z.strictObject({
          fingerprint: z.string().max(maxFingerprintLength),
          response: z.union([
            PaymentSchema,
            RefundSchema,
            TransferSchema,
            ReversalSchema,
          ]),
        }),
      ]),
    )
    .max(maxIdempotencyKeys),
  byMetadata: entries(ProviderIdSchema, maxObjects),
  actionRounds: entries(z.int().min(0).max(maxActionRounds), maxObjects),
  events: z.array(StrictEventSchema).max(maxEvents),
  balanceMinor: z.int(),
});

type StoredState = z.input<typeof StoredStateSchema>;
type StoredResponse = Payment | Refund | Transfer | TransferReversal;

/** The document of a gateway that holds nothing: what a missing row reads as and what a new row starts with. */
export const emptyFakeStateDocument = {
  payments: [],
  refunds: [],
  transfers: [],
  reversals: [],
  idempotency: [],
  byMetadata: [],
  actionRounds: [],
  events: [],
  balanceMinor: 0,
} satisfies StoredState;

/** The state as plain JSON, for the jsonb column. */
export function serializeFakeState(state: FakePaymentsState): StoredState {
  return {
    payments: [...state.payments],
    refunds: [...state.refunds],
    transfers: [...state.transfers],
    reversals: [...state.reversals],
    idempotency: [...state.idempotency].map(([key, seen]) => [
      key,
      {
        fingerprint: seen.fingerprint,
        response: seen.response as StoredResponse,
      },
    ]),
    byMetadata: [...state.byMetadata],
    actionRounds: [...state.actionRounds],
    events: state.events.map(storedEvent),
    balanceMinor: state.balanceMinor,
  };
}

function storedEvent(event: ProviderEvent) {
  return { ...event, occurredAt: event.occurredAt.toISOString() };
}

/** The state a stored row describes. Throws on a row that is not exactly what `serializeFakeState` writes. */
export function parseFakeState(stored: unknown): FakePaymentsState {
  const parsed = StoredStateSchema.parse(stored);
  return {
    payments: new Map(parsed.payments),
    refunds: new Map(parsed.refunds),
    transfers: new Map(parsed.transfers),
    reversals: new Map(parsed.reversals),
    idempotency: new Map(parsed.idempotency),
    byMetadata: new Map(parsed.byMetadata),
    actionRounds: new Map(parsed.actionRounds),
    events: parsed.events,
    balanceMinor: parsed.balanceMinor,
  };
}
