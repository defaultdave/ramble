import 'server-only';
import { z } from 'zod';
import { orderCurrency } from '@/lib/orders';
import {
  attemptStatuses,
  paymentMethods,
  paymentProviders,
  providerEventTypes,
  type PaymentProvider,
} from '@/lib/payments';

const CurrencySchema = z.literal(orderCurrency);
type Currency = typeof orderCurrency;

/** The smallest charge the provider accepts, in cents (Stripe's USD minimum). */
// TODO(U-047a): first caller
export const minAmountMinor = 50;
/** The largest single amount the provider accepts, in cents. */
// TODO(U-047a): first caller
export const maxAmountMinor = 99_999_999;
/** Stripe caps an Idempotency-Key at 255 characters; the fake keeps the same bound. */
const maxKeyLength = 255;
/** A webhook body larger than this is refused before its signature is checked. */
export const maxWebhookBodyLength = 65_536;

const IdempotencyKeySchema = z.string().min(1).max(maxKeyLength);
const ProviderIdSchema = z.string().min(1).max(maxKeyLength);
const AmountMinorSchema = z.int().positive().max(maxAmountMinor);
const ChargeAmountSchema = z.int().min(minAmountMinor).max(maxAmountMinor);

/** Ramble's IDs on every provider object (design doc 4.2.3 rule 6). */
const RambleMetadataSchema = z.object({
  orderId: z.uuid(),
  recordId: z.uuid(),
});
export type RambleMetadata = z.infer<typeof RambleMetadataSchema>;

type PaymentMethod = (typeof paymentMethods)[number];

type PaymentStatus = (typeof attemptStatuses)[number];

export type Payment = {
  id: string;
  provider: PaymentProvider;
  status: PaymentStatus;
  amountMinor: number;
  currency: Currency;
  /** The card fee the provider kept, known once the payment succeeds and not returned on a refund. */
  feeMinor: number | null;
  refundedMinor: number;
  method: PaymentMethod | null;
  failureCode: string | null;
  failedTries: number;
  clientSecret: string;
  metadata: RambleMetadata;
};

type RefundStatus = 'pending' | 'succeeded' | 'failed';

export type Refund = {
  id: string;
  paymentId: string;
  status: RefundStatus;
  amountMinor: number;
  currency: Currency;
  failureCode: string | null;
  metadata: RambleMetadata;
};

type TransferStatus = 'paid' | 'failed' | 'reversed';

export type Transfer = {
  id: string;
  destinationAccountId: string;
  status: TransferStatus;
  amountMinor: number;
  reversedMinor: number;
  currency: Currency;
  metadata: RambleMetadata;
};

export type TransferReversal = {
  id: string;
  transferId: string;
  amountMinor: number;
  currency: Currency;
  metadata: RambleMetadata;
};

type Balance = {
  availableMinor: number;
  currency: Currency;
};

export const CreatePaymentInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  amountMinor: ChargeAmountSchema,
  currency: CurrencySchema,
  metadata: RambleMetadataSchema,
});
type CreatePaymentInput = z.infer<typeof CreatePaymentInputSchema>;

export const CancelPaymentInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  paymentId: ProviderIdSchema,
});
type CancelPaymentInput = z.infer<typeof CancelPaymentInputSchema>;

export const RefundInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  paymentId: ProviderIdSchema,
  amountMinor: AmountMinorSchema,
  metadata: RambleMetadataSchema,
});
type RefundInput = z.infer<typeof RefundInputSchema>;

export const TransferInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  destinationAccountId: ProviderIdSchema,
  amountMinor: AmountMinorSchema,
  currency: CurrencySchema,
  metadata: RambleMetadataSchema,
});
type TransferInput = z.infer<typeof TransferInputSchema>;

export const ReverseTransferInputSchema = z.object({
  idempotencyKey: IdempotencyKeySchema,
  transferId: ProviderIdSchema,
  amountMinor: AmountMinorSchema,
  metadata: RambleMetadataSchema,
});
type ReverseTransferInput = z.infer<typeof ReverseTransferInputSchema>;

const objectKinds = ['payment', 'refund', 'transfer', 'reversal'] as const;
export type ObjectKind = (typeof objectKinds)[number];

export const RetrieveQuerySchema = z
  .object({ kind: z.enum(objectKinds) })
  .and(
    z.union([
      z.object({ id: ProviderIdSchema }),
      z.object({ metadata: RambleMetadataSchema }),
    ]),
  );
export type RetrieveQuery<K extends ObjectKind = ObjectKind> = {
  kind: K;
} & ({ id: string } | { metadata: RambleMetadata });

export type ProviderObject<K extends ObjectKind> = K extends 'payment'
  ? Payment
  : K extends 'refund'
    ? Refund
    : K extends 'transfer'
      ? Transfer
      : TransferReversal;

/** The raw request body and its signature header, as the webhook route receives them. */
export const WebhookDeliverySchema = z.object({
  rawBody: z.string().max(maxWebhookBodyLength),
  signature: z.string().min(1).max(1_024),
});
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;

export const ProviderEventSchema = z.object({
  /** Unique with `provider`; a repeat delivery carries the same id. */
  id: ProviderIdSchema,
  provider: z.enum(paymentProviders),
  type: z.enum(providerEventTypes),
  /** The provider object the event is about: a payment, refund, transfer, or dispute. */
  objectId: ProviderIdSchema,
  /** Null when the object was created without Ramble's IDs. */
  metadata: RambleMetadataSchema.nullable(),
  amountMinor: z.int().nonnegative().max(maxAmountMinor).nullable(),
  currency: CurrencySchema.nullable(),
  /** The card fee the provider kept; reported with `payment.succeeded`. */
  feeMinor: z.int().nonnegative().max(maxAmountMinor).nullable(),
  failureCode: z
    .string()
    .regex(/^[a-z0-9_]{1,64}$/)
    .nullable(),
  method: z.enum(paymentMethods).nullable(),
  occurredAt: z.iso.datetime().transform((value) => new Date(value)),
});
export type ProviderEvent = z.output<typeof ProviderEventSchema>;

/**
 * What a genuine delivery carried. `ignored` is a correctly signed event of a type Ramble
 * does not handle: the webhook route answers 2xx and stores nothing, so the provider does
 * not retry it.
 */
export type VerifiedWebhook =
  | { status: 'event'; event: ProviderEvent }
  | { status: 'ignored'; eventId: string; eventType: string };

export type PaymentsErrorCode =
  /** The input failed the port's schema; nothing was sent. */
  | 'invalid_input'
  /** No object with that id or metadata. */
  | 'not_found'
  /** The idempotency key was already used with different input. */
  | 'idempotency_conflict'
  /** The object's status does not allow the operation. */
  | 'invalid_state'
  | 'refund_exceeds_captured'
  | 'reversal_exceeds_transferred'
  | 'balance_insufficient'
  | 'invalid_signature'
  /** The provider could not take the request; retry later. */
  | 'provider_unavailable';

export class PaymentsError extends Error {
  readonly code: PaymentsErrorCode;

  constructor(code: PaymentsErrorCode, message?: string, cause?: unknown) {
    super(message ?? code, cause === undefined ? undefined : { cause });
    this.name = 'PaymentsError';
    this.code = code;
  }
}

/**
 * One payment provider behind one interface (ADR 0003, design doc 4.2.1). Every write
 * carries an idempotency key derived from Ramble's record ID (FORM-8) and Ramble's IDs
 * in metadata. Expected refusals reject with a `PaymentsError`; nothing is repaired.
 * Money is integer cents in USD.
 */
// TODO(U-047a): first caller
export type PaymentsPort = {
  readonly provider: PaymentProvider;
  /**
   * A new payment awaiting the guest's confirmation. A repeated key with the same input
   * returns the response of the first execution, as the provider recorded it then, not
   * the payment's current state; `retrieve` is the read.
   */
  createPayment(input: CreatePaymentInput): Promise<Payment>;
  /** Cancels a payment that has not succeeded. */
  cancelPayment(input: CancelPaymentInput): Promise<Payment>;
  /** By provider id, or by Ramble metadata when the provider id was never stored (rule 7). */
  retrieve<K extends ObjectKind>(
    query: RetrieveQuery<K>,
  ): Promise<ProviderObject<K> | null>;
  /** Refunds part or all of a succeeded payment; the card fee is not returned. */
  refund(input: RefundInput): Promise<Refund>;
  /** Moves money from the platform balance to a host account. */
  transfer(input: TransferInput): Promise<Transfer>;
  /** Pulls part or all of a transfer back to the platform balance. */
  reverseTransfer(input: ReverseTransferInput): Promise<TransferReversal>;
  /** Checks the signature on the raw body and returns the normalized event, or `ignored`. */
  verifyWebhook(delivery: WebhookDelivery): Promise<VerifiedWebhook>;
  /** The platform's available balance: charges less fees, refunds, and transfers. */
  getBalance(): Promise<Balance>;
};
