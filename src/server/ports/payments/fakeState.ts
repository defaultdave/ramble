import 'server-only';
import { z } from 'zod';
import { orderCurrency } from '@/lib/orders';
import {
  attemptStatuses,
  fakeGatewayLimits,
  paymentMethods,
  paymentProviders,
} from '@/lib/payments';
import type { FakePaymentsState } from './fake';
import {
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

const { maxObjects, maxEvents } = fakeGatewayLimits;
/** A payment can also be canceled under its own key, which holds a response but no object. */
const maxIdempotencyKeys = 2 * maxObjects;
const maxFingerprintLength = 4_096;

const AmountSchema = z.int().min(0).max(maxAmountMinor);
const CurrencySchema = z.literal(orderCurrency);

const PaymentSchema = z.object({
  id: ProviderIdSchema,
  provider: z.enum(paymentProviders),
  status: z.enum(attemptStatuses),
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  feeMinor: AmountSchema.nullable(),
  refundedMinor: AmountSchema,
  method: z.enum(paymentMethods).nullable(),
  failureCode: z.string().max(64).nullable(),
  failedTries: z.int().min(0).max(100),
  clientSecret: z.string().min(1).max(512),
  metadata: RambleMetadataSchema,
}) satisfies z.ZodType<Payment>;

const RefundSchema = z.object({
  id: ProviderIdSchema,
  paymentId: ProviderIdSchema,
  status: z.enum(['pending', 'succeeded', 'failed']),
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  failureCode: z.string().max(64).nullable(),
  metadata: RambleMetadataSchema,
}) satisfies z.ZodType<Refund>;

const TransferSchema = z.object({
  id: ProviderIdSchema,
  destinationAccountId: ProviderIdSchema,
  status: z.enum(['paid', 'failed', 'reversed']),
  amountMinor: AmountSchema,
  reversedMinor: AmountSchema,
  currency: CurrencySchema,
  metadata: RambleMetadataSchema,
}) satisfies z.ZodType<Transfer>;

const ReversalSchema = z.object({
  id: ProviderIdSchema,
  transferId: ProviderIdSchema,
  amountMinor: AmountSchema,
  currency: CurrencySchema,
  metadata: RambleMetadataSchema,
}) satisfies z.ZodType<TransferReversal>;

const entries = <T extends z.ZodType>(value: T, max: number) =>
  z.array(z.tuple([ProviderIdSchema, value])).max(max);

const StoredStateSchema = z.object({
  payments: entries(PaymentSchema, maxObjects),
  refunds: entries(RefundSchema, maxObjects),
  transfers: entries(TransferSchema, maxObjects),
  reversals: entries(ReversalSchema, maxObjects),
  idempotency: z
    .array(
      z.tuple([
        ProviderIdSchema,
        z.object({
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
  actionRounds: entries(z.int().min(0).max(100), maxObjects),
  events: z.array(ProviderEventSchema).max(maxEvents),
  balanceMinor: z.int(),
});

type StoredState = z.input<typeof StoredStateSchema>;
type StoredResponse = Payment | Refund | Transfer | TransferReversal;

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
