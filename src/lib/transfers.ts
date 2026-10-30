import { z } from 'zod';
import { EntityIdSchema } from './catalog';
import { orderLimits } from './orders';
import { ProviderIdSchema } from './payments';
import { addRuleIssues, type RuleIssue } from './rules';
import { canTransition, type TransitionTable } from './transitions';

// What a transfer to a host is and the rules around it. The pgEnum and CHECKs on `transfers` are
// built from these tuples and constants (design doc 4.2.3, Transfers).

export const transferStatuses = [
  'scheduled',
  'releasing',
  'paid',
  'failed',
  'reversed',
  'skipped',
  'simulated',
] as const;
export type TransferStatus = (typeof transferStatuses)[number];

/**
 * The weekly job moves a scheduled transfer to `releasing` (or `skipped` for a cancelled order or
 * a zero amount, `simulated` in the demo), then the provider answers. `paid` is terminal by rule 3
 * of design doc 4.2.3: a later reversal of the host share is recorded in `reversed_minor`. A
 * `failed` transfer is released again by the next weekly run.
 */
export const transferTransitions = {
  scheduled: ['releasing', 'skipped', 'simulated'],
  releasing: ['paid', 'failed', 'reversed'],
  failed: ['releasing'],
  paid: [],
  reversed: [],
  skipped: [],
  simulated: [],
} as const satisfies TransitionTable<TransferStatus>;

// TODO(U-079a): first caller, the weekly release job.
export function canTransferTransition(
  from: TransferStatus,
  to: TransferStatus,
): boolean {
  return canTransition(transferTransitions, from, to);
}

/** The statuses a transfer holds an amount in: set at release, so a `scheduled` transfer has none. */
export const amountSetStatuses = [
  'releasing',
  'paid',
  'failed',
  'reversed',
  'simulated',
] as const satisfies readonly TransferStatus[];

/** `transfer:{order_id}` (FORM-8): one transfer per booking, so one key. */
export function transferProviderKey(orderId: string): string {
  return `transfer:${orderId.toLowerCase()}`;
}

const millisecondsPerHour = 3_600_000;
/** How long after a session ends its transfer waits for the weekly release (design doc 4.2.3, Transfers). */
const releaseDelayHours = 24;

/** The session's end plus 24 hours: the earliest the weekly job may release the host's share. */
export function transferReleaseAfter(sessionEndsAt: Date): Date {
  return new Date(
    sessionEndsAt.getTime() + releaseDelayHours * millisecondsPerHour,
  );
}

type TransferRuleFields = {
  orderId: string;
  amountMinor: number | null;
  reversedMinor: number;
  providerKey: string;
  status: TransferStatus;
};

/** Rules that tie a transfer's fields together; the CHECKs on `transfers` state the same rules. */
function transferRuleIssues(transfer: TransferRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const amountSet = (amountSetStatuses as readonly string[]).includes(
    transfer.status,
  );
  if (transfer.status === 'scheduled' && transfer.amountMinor !== null) {
    issues.push({
      path: 'amountMinor',
      message: 'The amount is set at release, not before',
    });
  }
  if (
    amountSet &&
    (transfer.amountMinor === null || transfer.amountMinor < 1)
  ) {
    issues.push({
      path: 'amountMinor',
      message: 'A transfer being or having been sent has an amount above zero',
    });
  }
  if (transfer.reversedMinor > (transfer.amountMinor ?? 0)) {
    issues.push({
      path: 'reversedMinor',
      message: 'Cannot exceed the amount',
    });
  }
  if (transfer.providerKey !== transferProviderKey(transfer.orderId)) {
    issues.push({
      path: 'providerKey',
      message: 'The key is transfer: and the order id',
    });
  }
  return issues;
}

// TODO(U-079a): first caller, the weekly release job.
export const TransferSchema = z
  .object({
    id: EntityIdSchema,
    orderId: EntityIdSchema,
    hostId: EntityIdSchema,
    amountMinor: z.int().min(0).max(orderLimits.maxMinor).nullable(),
    releaseAfter: z.date(),
    providerKey: z.string().max(100),
    providerTransferId: ProviderIdSchema.nullable(),
    reversedMinor: z.int().min(0).max(orderLimits.maxMinor),
    status: z.enum(transferStatuses),
  })
  .superRefine((transfer, ctx) => {
    addRuleIssues(transferRuleIssues(transfer), ctx);
  });
