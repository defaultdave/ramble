import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { orderLimits } from './orders';
import { ProviderIdSchema } from './payments';
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
export type RefundReason = (typeof refundReasons)[number];

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

type RuleIssue = { path: string; message: string };

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
export function refundRuleIssues(refund: RefundRuleFields): RuleIssue[] {
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
    for (const issue of refundRuleIssues(refund)) {
      ctx.addIssue({
        code: 'custom',
        path: [issue.path],
        message: issue.message,
      });
    }
  });
export type Refund = z.infer<typeof RefundSchema>;
