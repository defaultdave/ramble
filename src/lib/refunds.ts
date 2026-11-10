import { z } from 'zod';
import { EntityIdSchema, WriteIdSchema } from './catalog';
import { orderLimits, type OrderStatus } from './orders';
import {
  ProviderIdSchema,
  paymentLimits,
  type PaymentProvider,
} from './payments';
import { commissionMinor } from './pricing';
import { addRuleIssues, type RuleIssue } from './rules';
import { canTransition, type TransitionTable } from './transitions';

// What a refund is and the rules around it. The pgEnums and CHECKs on `refunds` are built from
// these tuples and constants (design doc 4.2.3, Refunds). The refund arithmetic (tax follows the
// ticket, commission recalculated on what the host keeps) belongs to the code that writes refunds.

export const refundReasons = [
  'guest_cancel',
  'host_cancel',
  'weather',
  'ramble_cancel',
  'session_cancelled',
  'lapse_after_payment',
  'duplicate_payment',
  'goodwill',
  'gift_unredeemed',
  'gift_buyer_request',
  'gift_exchange_difference',
  'ops_adjustment',
] as const;

export const refundStatuses = [
  'pending',
  'succeeded',
  'failed',
  'gift_reinstated',
] as const;
export type RefundStatus = (typeof refundStatuses)[number];

/**
 * A refund is created `pending` (cash moves at the provider first) or `gift_reinstated` (no card
 * to refund). `succeeded` is terminal by rule 3 of design doc 4.2.3. Nothing in the design doc
 * leaves `failed`: ops follow up, and a new attempt to refund is a new row with its own key.
 */
export const refundTransitions = {
  pending: ['succeeded', 'failed'],
  succeeded: [],
  failed: [],
  gift_reinstated: [],
} as const satisfies TransitionTable<RefundStatus>;

// TODO(U-066b): first caller, the refund row's first status (a reinstated gift writes `gift_reinstated`).
export const refundInitialStatuses = [
  'pending',
  'gift_reinstated',
] as const satisfies readonly RefundStatus[];

export function canRefundTransition(
  from: RefundStatus,
  to: RefundStatus,
): boolean {
  return canTransition(refundTransitions, from, to);
}

/** `refund:{refund_id}` (FORM-8): the provider's idempotency key for this refund. */
export function refundProviderKey(refundId: string): string {
  return `refund:${refundId.toLowerCase()}`;
}

type RefundRuleFields = {
  id: string;
  ticketMinor: number;
  taxMinor: number;
  commissionReturnedMinor: number;
  amountMinor: number;
  providerKey: string;
  paymentAttemptId: string | null;
  providerRefundId: string | null;
  status: RefundStatus;
  createdAt: Date;
  succeededAt: Date | null;
};

/** Rules that tie a refund's fields together; the CHECKs on `refunds` state the same rules. */
function refundRuleIssues(refund: RefundRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (refund.amountMinor !== refund.ticketMinor + refund.taxMinor) {
    issues.push({
      path: 'amountMinor',
      message: 'The amount is the ticket part plus the tax part',
    });
  }
  if (refund.commissionReturnedMinor > refund.ticketMinor) {
    issues.push({
      path: 'commissionReturnedMinor',
      message: 'The commission returned cannot exceed the ticket part',
    });
  }
  if (refund.providerKey !== refundProviderKey(refund.id)) {
    issues.push({
      path: 'providerKey',
      message: 'The key is refund: and the refund id',
    });
  }
  if (
    refund.status === 'gift_reinstated' &&
    (refund.paymentAttemptId !== null || refund.providerRefundId !== null)
  ) {
    issues.push({
      path: 'status',
      message: 'A reinstated gift refunds no payment',
    });
  }
  if ((refund.succeededAt !== null) !== (refund.status === 'succeeded')) {
    issues.push({
      path: 'succeededAt',
      message: 'Set exactly when the refund succeeded',
    });
  }
  if (refund.succeededAt !== null && refund.succeededAt < refund.createdAt) {
    issues.push({ path: 'succeededAt', message: 'Not before it was created' });
  }
  return issues;
}

const refundMinor = z.int().min(0).max(orderLimits.maxMinor);

export const RefundSchema = z
  .object({
    id: EntityIdSchema,
    orderId: EntityIdSchema,
    paymentAttemptId: EntityIdSchema.nullable(),
    ticketMinor: refundMinor,
    taxMinor: refundMinor,
    commissionReturnedMinor: refundMinor,
    amountMinor: z.int().min(1).max(orderLimits.maxMinor),
    reason: z.enum(refundReasons),
    initiatedBy: EntityIdSchema.nullable(),
    providerKey: z.string().max(100),
    providerRefundId: ProviderIdSchema.nullable(),
    status: z.enum(refundStatuses),
    createdAt: z.date(),
    succeededAt: z.date().nullable(),
  })
  .superRefine((refund, ctx) => {
    addRuleIssues(refundRuleIssues(refund), ctx);
  });

export function requireRefundTransition(
  from: RefundStatus,
  to: RefundStatus,
): void {
  if (!canRefundTransition(from, to)) {
    throw new Error(`A refund does not move from ${from} to ${to}`);
  }
}

// -- Requesting a refund (design doc 4.2.3, Refunds) ----------------------------------------------

/** The job kind that sends one refund to the provider. */
export const processRefundKind = 'process-refund';

export const ProcessRefundPayloadSchema = z.strictObject({
  refundId: WriteIdSchema,
});

/** One job per refund: a repeat enqueue of the same refund writes nothing. */
export function processRefundDedupeKey(refundId: string): string {
  return `${processRefundKind}:${refundId.toLowerCase()}`;
}

/**
 * The reasons an order's refund can carry. `duplicate_payment` refunds a payment that is not the
 * order's own, and the gift reasons name a gift, so each belongs to the unit that builds that path.
 */
// TODO(U-109): add `duplicate_payment`, which refunds a payment that is not the order's live attempt.
export const orderRefundReasons = [
  'guest_cancel',
  'host_cancel',
  'weather',
  'ramble_cancel',
  'session_cancelled',
  'lapse_after_payment',
  'goodwill',
  'ops_adjustment',
] as const satisfies readonly (typeof refundReasons)[number][];

/** Cash was taken for an order in these states only, so only they can be refunded. */
const refundableOrderStatuses = [
  'confirmed',
  'cancelled',
  'refunded_after_lapse',
] as const satisfies readonly OrderStatus[];

export function isRefundableOrderStatus(status: OrderStatus): boolean {
  return (refundableOrderStatuses as readonly string[]).includes(status);
}

/**
 * The caller's own key for one refund of one order and reason (the cancel, the session, the
 * payment). The same three values always name the same refund, so a retried action asks again and
 * changes nothing. The length is checked by Zod before the pattern runs; the pattern is one class.
 */
const RefundKeySchema = z
  .string()
  .max(64)
  .regex(/^[A-Za-z0-9][A-Za-z0-9:_./-]*$/);

const requestedTicketMinor = z.union([
  z.literal('remaining'),
  z.int().min(1).max(orderLimits.maxSubtotalMinor),
]);

export const RefundRequestSchema = z.strictObject({
  orderId: WriteIdSchema,
  reason: z.enum(orderRefundReasons),
  key: RefundKeySchema,
  /** The ticket part to refund, or `remaining` for everything the order still holds (a host, weather, or Ramble cancellation). */
  ticketMinor: requestedTicketMinor,
  /** The staff user who asked; null for the system. */
  initiatedBy: WriteIdSchema.nullable().default(null),
});
export type RefundRequestInput = z.input<typeof RefundRequestSchema>;
export type RefundRequest = z.output<typeof RefundRequestSchema>;

/** The text the refund's id is made from: the same three values always name the same refund. */
export function refundRequestIdentity(
  request: Pick<RefundRequest, 'orderId' | 'reason' | 'key'>,
): string {
  return `refund-request:v1:${request.orderId}:${request.reason}:${request.key}`;
}

/** A UUID (version 5 layout) made from the hex SHA-256 of a request's identity, so the same request is the same refund row. */
export function refundIdFromDigest(hex: string): string {
  const variant = (Number.parseInt(hex.charAt(16), 16) % 4) + 8;
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `5${hex.slice(13, 16)}`,
    `${variant.toString(16)}${hex.slice(17, 20)}`,
    hex.slice(20, 32),
  ].join('-');
}

/** How many attempts of one order a read takes: every attempt it can have, and one more to see a breach. */
export const attemptReadLimit = paymentLimits.maxAttemptNo + 1;

/** What an order has taken and given back, as the refund arithmetic needs it. */
export type RefundableOrder = {
  status: OrderStatus;
  ticketSubtotalMinor: number;
  taxMinor: number;
  totalMinor: number;
  amountDueMinor: number;
  commissionMinor: number;
  commissionRateBps: number;
  refundedTicketMinor: number;
  refundedTaxMinor: number;
  commissionReturnedMinor: number;
};

/** The parts of one refund: ticket `T`, tax `X`, the commission returned `c`, and the host share `T - c`. */
export type RefundSplit = {
  ticketMinor: number;
  taxMinor: number;
  commissionReturnedMinor: number;
  hostShareMinor: number;
  amountMinor: number;
};

/** `round_half_up(n / d)` on integers; BigInt because the ticket times the tax can pass 2^53. */
function roundHalfUpDivision(n: bigint, d: bigint): number {
  return Number((2n * n + d) / (2n * d));
}

function requireSaneOrder(order: RefundableOrder): void {
  const sane =
    order.refundedTicketMinor >= 0 &&
    order.refundedTicketMinor <= order.ticketSubtotalMinor &&
    order.refundedTaxMinor >= 0 &&
    order.refundedTaxMinor <= order.taxMinor &&
    order.commissionReturnedMinor >= 0 &&
    order.commissionReturnedMinor <= order.commissionMinor &&
    order.totalMinor === order.ticketSubtotalMinor + order.taxMinor;
  if (!sane) throw new RangeError('The order totals do not add up');
}

/**
 * `refunds.split(order, ticketMinor)` (design doc 4.2.3, refund math). Tax follows the ticket,
 * `X = round_half_up(T * tax / ticket_subtotal)`, except that the refund taking the ticket to zero
 * takes the exact tax remainder. Commission is recalculated on what the host keeps: after the
 * refund `kept = subtotal - refunded ticket`, and the commission returned now is the commission
 * charged, less the rounded commission on `kept`, less what was returned before. A full refund
 * therefore returns exactly the commission charged. Throws on a ticket part the order cannot give
 * back and on totals that do not add up: nothing is repaired.
 */
export function splitRefund(
  order: RefundableOrder,
  ticketMinor: number,
): RefundSplit {
  requireSaneOrder(order);
  const remainingTicket = order.ticketSubtotalMinor - order.refundedTicketMinor;
  if (
    !Number.isSafeInteger(ticketMinor) ||
    ticketMinor < 1 ||
    ticketMinor > remainingTicket
  ) {
    throw new RangeError('The ticket part is more than the order still holds');
  }
  const remainingTax = order.taxMinor - order.refundedTaxMinor;
  const taxMinor =
    ticketMinor === remainingTicket
      ? remainingTax
      : Math.min(
          remainingTax,
          roundHalfUpDivision(
            BigInt(ticketMinor) * BigInt(order.taxMinor),
            BigInt(order.ticketSubtotalMinor),
          ),
        );
  const kept = remainingTicket - ticketMinor;
  const commissionReturnedMinor =
    order.commissionMinor -
    commissionMinor(kept, order.commissionRateBps) -
    order.commissionReturnedMinor;
  if (commissionReturnedMinor < 0 || commissionReturnedMinor > ticketMinor) {
    throw new RangeError('The commission returned is outside the ticket part');
  }
  return {
    ticketMinor,
    taxMinor,
    commissionReturnedMinor,
    hostShareMinor: ticketMinor - commissionReturnedMinor,
    amountMinor: ticketMinor + taxMinor,
  };
}

type RefundRefusal =
  /** Cash was not taken for the order, or it was never confirmed. */
  | 'order_not_refundable'
  /** Every ticket part has been given back already. */
  | 'nothing_left'
  | 'exceeds_remaining'
  /** More than the card paid: part of the order was paid by a gift. */
  | 'exceeds_card_payment';

/** Why `requestRefund` wrote nothing: the order's refusals, and the three it finds in the data layer. */
export type RefundRequestRefusal =
  | RefundRefusal
  | 'order_not_found'
  /** The order has no single succeeded payment to send the money back to. */
  | 'no_payment'
  /** The key already names a refund of a different amount. */
  | 'request_changed';

export type RefundPlan =
  | { status: 'planned'; split: RefundSplit }
  | {
      status: 'refused';
      reason: RefundRefusal;
      /** What the order's ticket part still holds. */
      remainingTicketMinor: number;
    };

/** The split a request calls for, or why the order refuses it. An order that cannot say what it holds is an error, not a refusal. */
export function planRefund(
  order: RefundableOrder,
  ticketMinor: number | 'remaining',
): RefundPlan {
  requireSaneOrder(order);
  const remainingTicketMinor =
    order.ticketSubtotalMinor - order.refundedTicketMinor;
  const refuse = (reason: RefundRefusal): RefundPlan => ({
    status: 'refused',
    reason,
    remainingTicketMinor,
  });
  if (!isRefundableOrderStatus(order.status)) {
    return refuse('order_not_refundable');
  }
  if (remainingTicketMinor === 0) return refuse('nothing_left');
  const asked =
    ticketMinor === 'remaining' ? remainingTicketMinor : ticketMinor;
  if (asked > remainingTicketMinor) return refuse('exceeds_remaining');
  const split = splitRefund(order, asked);
  const cardLeft =
    order.amountDueMinor - order.refundedTicketMinor - order.refundedTaxMinor;
  if (split.amountMinor > cardLeft) return refuse('exceeds_card_payment');
  return { status: 'planned', split };
}

export type RefundRequestVerdict<A> =
  /** The request names a refund that exists and asks for the same amount of it. */
  | { kind: 'already_requested' }
  | {
      kind: 'refused';
      reason: RefundRequestRefusal;
      /** What the order's ticket part still holds, or null when it is not known. */
      remainingTicketMinor: number | null;
    }
  | {
      kind: 'planned';
      split: RefundSplit;
      attempt: A & { providerPaymentId: string };
    };

/**
 * Everything a request is judged on, in one order: no order is a refusal; a refund already made for
 * the request's key is answered again, or refused when the request now asks for another ticket part;
 * then the one succeeded payment, then the split. The data layer reads the rows under the order's lock
 * and acts on the verdict.
 */
export function refundRequestVerdict<
  A extends { status: string; providerPaymentId: string | null },
>(input: {
  request: Pick<RefundRequest, 'ticketMinor'>;
  order: RefundableOrder | null;
  existing: { ticketMinor: number } | null;
  attempts: readonly A[];
}): RefundRequestVerdict<A> {
  const { request, order, existing, attempts } = input;
  const refuse = (
    reason: RefundRequestRefusal,
    remainingTicketMinor: number | null = null,
  ): RefundRequestVerdict<A> => ({
    kind: 'refused',
    reason,
    remainingTicketMinor,
  });
  if (order === null) return refuse('order_not_found');
  if (existing) {
    const same =
      request.ticketMinor === 'remaining' ||
      request.ticketMinor === existing.ticketMinor;
    return same ? { kind: 'already_requested' } : refuse('request_changed');
  }
  const attempt = refundableAttempt(attempts);
  if (!attempt) return refuse('no_payment');
  const plan = planRefund(order, request.ticketMinor);
  if (plan.status === 'refused') {
    return refuse(plan.reason, plan.remainingTicketMinor);
  }
  return { kind: 'planned', split: plan.split, attempt };
}

type RefundedTotals = Pick<
  RefundableOrder,
  'refundedTicketMinor' | 'refundedTaxMinor' | 'commissionReturnedMinor'
>;

/** What an order's running refund totals become when a refund is requested. */
export function totalsAfterRequest(
  order: RefundedTotals,
  split: Pick<
    RefundSplit,
    'ticketMinor' | 'taxMinor' | 'commissionReturnedMinor'
  >,
): RefundedTotals {
  return {
    refundedTicketMinor: order.refundedTicketMinor + split.ticketMinor,
    refundedTaxMinor: order.refundedTaxMinor + split.taxMinor,
    commissionReturnedMinor:
      order.commissionReturnedMinor + split.commissionReturnedMinor,
  };
}

/**
 * What the totals become when a refund fails: the money never left, so its parts go back to the
 * order, as the failed-refund ledger rows give them back to the host and the commission.
 */
export function totalsAfterFailure(
  order: RefundedTotals,
  refund: Pick<
    RefundSplit,
    'ticketMinor' | 'taxMinor' | 'commissionReturnedMinor'
  >,
): RefundedTotals {
  const totals = {
    refundedTicketMinor: order.refundedTicketMinor - refund.ticketMinor,
    refundedTaxMinor: order.refundedTaxMinor - refund.taxMinor,
    commissionReturnedMinor:
      order.commissionReturnedMinor - refund.commissionReturnedMinor,
  };
  if (Object.values(totals).some((value) => value < 0)) {
    throw new RangeError('The failed refund is more than the order refunded');
  }
  return totals;
}

type RefundLine = Pick<
  RefundRuleFields,
  'status' | 'ticketMinor' | 'taxMinor' | 'commissionReturnedMinor'
>;

/**
 * The per-order check of design doc 4.2.3: the refunds that stand (everything but a failed one)
 * sum to the order's `refunded_ticket_minor + refunded_tax_minor` and its returned commission,
 * and together never exceed `total_minor`.
 */
export function refundsReconcile(
  order: Pick<RefundableOrder, 'totalMinor'> & RefundedTotals,
  refunds: readonly RefundLine[],
): boolean {
  const standing = refunds.filter((refund) => refund.status !== 'failed');
  const sum = (pick: (refund: RefundLine) => number) =>
    standing.reduce((total, refund) => total + pick(refund), 0);
  const ticket = sum((refund) => refund.ticketMinor);
  const tax = sum((refund) => refund.taxMinor);
  return (
    ticket === order.refundedTicketMinor &&
    tax === order.refundedTaxMinor &&
    sum((refund) => refund.commissionReturnedMinor) ===
      order.commissionReturnedMinor &&
    ticket + tax <= order.totalMinor
  );
}

/** The one succeeded attempt a refund goes back to; none, or more than one, is no answer. */
export function refundableAttempt<
  A extends { status: string; providerPaymentId: string | null },
>(attempts: readonly A[]): (A & { providerPaymentId: string }) | null {
  const paid = attempts.filter((attempt) => attempt.status === 'succeeded');
  const [only] = paid;
  if (paid.length !== 1 || !only || only.providerPaymentId === null) {
    return null;
  }
  return { ...only, providerPaymentId: only.providerPaymentId };
}

export type RefundToSend =
  | {
      kind: 'send';
      refundId: string;
      orderId: string;
      providerKey: string;
      amountMinor: number;
      providerPaymentId: string;
    }
  /** The provider already answered; nothing to send. */
  | { kind: 'skip' }
  /** A pending refund with no payment to go back to: data that cannot be right. */
  | { kind: 'invalid' };

/** Whether the job sends a refund to the provider: only a `pending` one, and only with the payment it goes back to. */
export function refundToSend(
  refund: Pick<
    RefundRuleFields,
    'id' | 'status' | 'providerKey' | 'amountMinor'
  > & { orderId: string },
  providerPaymentId: string | null,
): RefundToSend {
  if (refund.status !== 'pending') return { kind: 'skip' };
  if (providerPaymentId === null) return { kind: 'invalid' };
  return {
    kind: 'send',
    refundId: refund.id,
    orderId: refund.orderId,
    providerKey: refund.providerKey,
    amountMinor: refund.amountMinor,
    providerPaymentId,
  };
}

/** What to do with the provider's id for a refund: it is kept once, and a different one is a conflict. */
export function providerRefundIdAction(
  kept: string | null,
  incoming: string,
): 'keep' | 'record' | 'conflict' {
  if (kept === incoming) return 'keep';
  return kept === null ? 'record' : 'conflict';
}

/**
 * Ramble hands a provider's events to its own intake only for a provider with no webhook to deliver
 * them, which is the fake.
 */
// TODO(U-046): the Stripe adapter delivers its own events; only the fake needs Ramble to hand them over.
export function handsOverProviderEvents(provider: PaymentProvider): boolean {
  return provider === 'fake';
}

/** The cash row of a refund is the first posting under the provider's id; finding it posted already is a bug. */
export function refundCashPostIsFirst(
  posted: 'posted' | 'already_posted',
): boolean {
  return posted === 'posted';
}

// -- The provider's answer ---------------------------------------------------------------------

const refundEventTypes = ['refund.succeeded', 'refund.failed'] as const;
export type RefundEventType = (typeof refundEventTypes)[number];

export function isRefundEventType(type: string): type is RefundEventType {
  return (refundEventTypes as readonly string[]).includes(type);
}

export type RefundEventFacts = {
  type: RefundEventType;
  /** The provider's id for the refund. */
  objectId: string;
  amountMinor: number | null;
  orderId: string | null;
  recordId: string | null;
};

export type RefundEventAction =
  /** No refund of Ramble's matches the event. */
  | { kind: 'unmatched' }
  /** The event contradicts the refund; nothing is written and the event is retried, then alerted. */
  | { kind: 'conflict' }
  /** A repeat of what the refund already is. */
  | { kind: 'noop' }
  | { kind: 'succeed' }
  | { kind: 'fail' };

/**
 * What a refund event does to the refund it names (design doc 4.2.3, Refunds). A terminal refund is
 * never overwritten (rule 3): a repeat is a no-op, and an event that contradicts the outcome (a
 * failure after a success, or the other way round) is a conflict. The cash posting is written only
 * for an amount equal to the refund's, from the provider that holds the refund's id.
 */
export function refundEventAction(
  event: RefundEventFacts,
  refund:
    | (Pick<
        RefundRuleFields,
        'id' | 'status' | 'amountMinor' | 'providerRefundId'
      > & { orderId: string })
    | null,
): RefundEventAction {
  if (
    refund === null ||
    event.recordId !== refund.id ||
    event.orderId === null ||
    event.orderId !== refund.orderId
  ) {
    return { kind: 'unmatched' };
  }
  if (
    refund.providerRefundId !== null &&
    refund.providerRefundId !== event.objectId
  ) {
    return { kind: 'conflict' };
  }
  const succeeds = event.type === 'refund.succeeded';
  const amountAgrees =
    event.amountMinor === refund.amountMinor ||
    (!succeeds && event.amountMinor === null);
  if (!amountAgrees) return { kind: 'conflict' };
  const target: RefundStatus = succeeds ? 'succeeded' : 'failed';
  if (refund.status === target) return { kind: 'noop' };
  if (!canRefundTransition(refund.status, target)) return { kind: 'conflict' };
  return { kind: succeeds ? 'succeed' : 'fail' };
}

/**
 * What the event job does once the event's action is known: a success or a failure writes the
 * refund, order, and ledger rows; an event that matches nothing, or contradicts the refund, is retried
 * with backoff (and alerts); a repeat is finished with nothing written.
 */
/** Why an event that cannot be applied is retried: nothing matches it, or it contradicts the refund it names. */
export function refundRetryReason(
  action: RefundEventAction,
): 'unmatched' | 'refund_conflict' {
  return action.kind === 'conflict' ? 'refund_conflict' : 'unmatched';
}

export function refundEventRoute(
  action: RefundEventAction,
): 'write' | 'retry' | 'finish' {
  switch (action.kind) {
    case 'succeed':
    case 'fail':
      return 'write';
    case 'unmatched':
    case 'conflict':
      return 'retry';
    case 'noop':
      return 'finish';
  }
}

/** The attempt a pending refund goes back to; a refund written without one is data that cannot be right. */
export function refundAttemptId(refund: {
  paymentAttemptId: string | null;
}): string {
  if (refund.paymentAttemptId === null) {
    throw new Error('A pending refund has no payment attempt');
  }
  return refund.paymentAttemptId;
}
