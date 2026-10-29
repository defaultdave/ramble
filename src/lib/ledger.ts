import { z } from 'zod';
import { WriteIdSchema } from './catalog';
import { orderCurrency, orderLimits } from './orders';
import { ProviderIdSchema } from './payments';
import { addRuleIssues, type RuleIssue } from './rules';
import { optionalText } from './text';
import { isReadableInstant } from './time';

// The two-account ledger (design doc 4.2.3, Ledger): every row moves an amount from a debit
// account to a credit account, so every event balances and every balance is a sum. The pgEnums
// and CHECKs on `ledger_entries` are built from these tuples and constants. Nothing here touches
// the database.

export const ledgerAccounts = [
  'platform_cash',
  'host_payable',
  'ramble_commission',
  'processing_fees',
  'gift_liability',
  'refunds_pending',
  'dispute_hold',
  'dispute_losses',
  'ramble_payouts',
] as const;
export type LedgerAccount = (typeof ledgerAccounts)[number];

export const ledgerEntryTypes = [
  'charge_host_share',
  'charge_commission',
  'charge_tax',
  'processing_fee',
  'transfer_to_host',
  'transfer_reversal',
  'refund_host_share',
  'commission_returned',
  'refund_tax',
  'refund_cash_out',
  'refund_reversal',
  'gift_liability_in',
  'gift_to_host_share',
  'gift_to_commission',
  'gift_to_tax',
  'gift_refund',
  'gift_reinstated',
  'ramble_payout',
  'dispute_withdrawal',
  'dispute_fee',
  'dispute_reinstated',
  'dispute_to_host',
  'dispute_loss',
] as const;
type LedgerEntryType = (typeof ledgerEntryTypes)[number];

export const ledgerLimits = {
  memo: 500,
  /** The most rows one posting call takes: the largest builder emits three (host share, commission, tax). */
  maxEntriesPerPost: 3,
  /** The most grouped rows a statement, export, or balance read returns before it refuses. */
  maxReadGroups: 20_000,
} as const;

/** The only account that holds Ramble's real cash: a row touching it is a cash posting and names the provider's object. */
const cashAccount = 'platform_cash' satisfies LedgerAccount;

type Accounts = { debitAccount: LedgerAccount; creditAccount: LedgerAccount };

/** Rule 5 of design doc 4.2.3: a cash posting is written only on the provider's success event, so it carries that event's object id. */
export function isCashPosting(entry: Accounts): boolean {
  return (
    entry.debitAccount === cashAccount || entry.creditAccount === cashAccount
  );
}

/**
 * Which side raises an account. The postings table in the design doc reports platform_cash 125.93
 * and host_payable 110.50 for one booking: cash and expense accounts count debits less credits,
 * and liability and income accounts count credits less debits. Every account is listed so a new
 * one forces a choice.
 */
const normalSide = {
  platform_cash: 'debit',
  host_payable: 'credit',
  ramble_commission: 'credit',
  processing_fees: 'debit',
  gift_liability: 'credit',
  refunds_pending: 'credit',
  dispute_hold: 'debit',
  dispute_losses: 'debit',
  ramble_payouts: 'debit',
} as const satisfies Record<LedgerAccount, 'debit' | 'credit'>;

const LedgerAccountSchema = z.enum(ledgerAccounts);
const LedgerEntryTypeSchema = z.enum(ledgerEntryTypes);

const instant = z
  .date()
  .refine(isReadableInstant, { message: 'Not a readable time' });

function entryRuleIssues(entry: {
  entryType: LedgerEntryType;
  debitAccount: LedgerAccount;
  creditAccount: LedgerAccount;
  orderId: string | null;
  giftId: string | null;
  hostId: string | null;
  providerObjectId: string | null;
}): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (entry.debitAccount === entry.creditAccount) {
    issues.push({
      path: 'creditAccount',
      message: 'The debit and credit accounts differ',
    });
  }
  // Ramble's own payout belongs to no order, gift, or host, so the design doc's "at least one set"
  // cannot hold for it.
  if (
    entry.entryType !== 'ramble_payout' &&
    entry.orderId === null &&
    entry.giftId === null &&
    entry.hostId === null
  ) {
    issues.push({
      path: 'orderId',
      message: 'Names an order, a gift, or a host',
    });
  }
  if (isCashPosting(entry) !== (entry.providerObjectId !== null)) {
    issues.push({
      path: 'providerObjectId',
      message: 'Set exactly when the row touches platform_cash',
    });
  }
  return issues;
}

/** One row of the ledger as the data layer writes it; the CHECKs on `ledger_entries` state the same rules. */
export const LedgerEntrySchema = z
  .object({
    occurredAt: instant,
    entryType: LedgerEntryTypeSchema,
    debitAccount: LedgerAccountSchema,
    creditAccount: LedgerAccountSchema,
    amountMinor: z.int().min(1).max(orderLimits.maxMinor),
    currency: z.literal(orderCurrency),
    orderId: WriteIdSchema.nullable(),
    giftId: WriteIdSchema.nullable(),
    hostId: WriteIdSchema.nullable(),
    paymentAttemptId: WriteIdSchema.nullable(),
    refundId: WriteIdSchema.nullable(),
    transferId: WriteIdSchema.nullable(),
    disputeId: WriteIdSchema.nullable(),
    providerObjectId: ProviderIdSchema.nullable(),
    simulated: z.boolean(),
    createdBy: WriteIdSchema.nullable(),
    memo: optionalText(ledgerLimits.memo),
  })
  .superRefine((entry, ctx) => {
    addRuleIssues(entryRuleIssues(entry), ctx);
  });
export type LedgerEntry = z.output<typeof LedgerEntrySchema>;
export type LedgerEntryInput = z.input<typeof LedgerEntrySchema>;

function eventRuleIssues(entries: readonly LedgerEntry[]): RuleIssue[] {
  const cash = entries.filter(isCashPosting).length;
  if (cash > 0 && cash < entries.length) {
    return [
      {
        path: 'entries',
        message:
          'An event posts cash rows or non-cash rows, never both: a repeated cash event is skipped as a whole',
      },
    ];
  }
  return [];
}

/** The rows of one event, posted together: between one and the cap, all cash or all non-cash. */
export const LedgerEventSchema = z
  .array(LedgerEntrySchema)
  .min(1)
  .max(ledgerLimits.maxEntriesPerPost)
  .superRefine((entries, ctx) => {
    addRuleIssues(eventRuleIssues(entries), ctx);
  });

/**
 * Checks an event before anything is written. The length is checked first, so an oversized list is
 * refused without parsing each row.
 */
export function parseLedgerEvent(
  entries: readonly LedgerEntryInput[],
): LedgerEntry[] {
  if (entries.length > ledgerLimits.maxEntriesPerPost) {
    throw new RangeError(
      `A posting call takes at most ${String(ledgerLimits.maxEntriesPerPost)} rows, got ${String(entries.length)}`,
    );
  }
  return LedgerEventSchema.parse(entries);
}

export type PostOutcome = 'posted' | 'already_posted';

/**
 * What the insert of one event means. A cash event is idempotent through the unique index on
 * `(entry_type, provider_object_id)`: every row new is a post, every row already there is a
 * repeat, and anything between is a half-posted event, a bug that is never repaired. Non-cash
 * rows cannot conflict, so they must all land.
 */
export function postOutcome(
  rowsInEvent: number,
  rowsInserted: number,
): PostOutcome {
  if (rowsInserted === rowsInEvent) return 'posted';
  if (rowsInserted === 0) return 'already_posted';
  throw new Error(
    `Half-posted ledger event: ${String(rowsInserted)} of ${String(rowsInEvent)} rows were new`,
  );
}

// ---------------------------------------------------------------------------------------------
// Balances

export type Posting = Accounts & { amountMinor: number };
export type AccountBalances = Record<LedgerAccount, number>;

/** Each account's balance on its normal side, so a positive number is the usual direction. */
export function accountBalances(postings: Iterable<Posting>): AccountBalances {
  const net = Object.fromEntries(
    ledgerAccounts.map((account) => [account, 0]),
  ) as AccountBalances;
  for (const posting of postings) {
    net[posting.debitAccount] += posting.amountMinor;
    net[posting.creditAccount] -= posting.amountMinor;
  }
  const balances = { ...net };
  for (const account of ledgerAccounts) {
    // `+ 0` turns a negated zero into zero.
    balances[account] =
      (normalSide[account] === 'debit' ? net[account] : -net[account]) + 0;
  }
  return balances;
}

/** Money Ramble holds for someone else (PRD-57): owed to hosts, gift value not yet used, and refunds not yet paid out. */
export function moneyHeld(balances: AccountBalances): number {
  return (
    balances.host_payable + balances.gift_liability + balances.refunds_pending
  );
}

// ---------------------------------------------------------------------------------------------
// Posting builders, one per event in the design doc's postings table. They take the amounts the
// caller already holds (an order's commission and tax snapshot, a refund row's split) and never
// recompute commission, tax, or refund math: that belongs to orders and refunds. A leg of zero is
// left out, because a row's amount is above zero.

type Common = {
  occurredAt: Date;
  simulated: boolean;
  createdBy?: string | null;
  memo?: string | null;
};

type Links = {
  orderId: string;
  giftId: string;
  hostId: string;
  paymentAttemptId: string;
  refundId: string;
  transferId: string;
  disputeId: string;
};

type Optional<K extends keyof Links> = { [P in K]?: Links[P] | null };
type Linked<K extends keyof Links> = Pick<Links, K>;

/** The three parts every sale, refund, and gift redemption splits into. The host share is the ticket less the commission. */
export type PostingSplit = {
  ticketMinor: number;
  commissionMinor: number;
  taxMinor: number;
};

type Draft = {
  entryType: LedgerEntryType;
  debitAccount: LedgerAccount;
  creditAccount: LedgerAccount;
  amountMinor: number;
};

function requireMinor(value: number, what: string, minimum: 0 | 1): void {
  if (!Number.isSafeInteger(value) || value < minimum) {
    throw new RangeError(
      `${what} must be a whole number of at least ${String(minimum)}, got ${String(value)}`,
    );
  }
}

/** The legs of a split: what the host keeps of the ticket, the commission, and the tax. */
function splitLegs(split: PostingSplit): {
  hostShare: number;
  commission: number;
  tax: number;
} {
  requireMinor(split.ticketMinor, 'The ticket', 0);
  requireMinor(split.commissionMinor, 'The commission', 0);
  requireMinor(split.taxMinor, 'The tax', 0);
  if (split.commissionMinor > split.ticketMinor) {
    throw new RangeError('The commission cannot exceed the ticket');
  }
  if (split.ticketMinor + split.taxMinor === 0) {
    throw new RangeError('A split of nothing posts nothing');
  }
  return {
    hostShare: split.ticketMinor - split.commissionMinor,
    commission: split.commissionMinor,
    tax: split.taxMinor,
  };
}

function build(
  common: Common & Optional<keyof Links>,
  drafts: readonly Draft[],
  providerObjectId: string | null,
): LedgerEntryInput[] {
  return drafts
    .filter((draft) => draft.amountMinor > 0)
    .map((draft) => ({
      occurredAt: common.occurredAt,
      entryType: draft.entryType,
      debitAccount: draft.debitAccount,
      creditAccount: draft.creditAccount,
      amountMinor: draft.amountMinor,
      currency: orderCurrency,
      orderId: common.orderId ?? null,
      giftId: common.giftId ?? null,
      hostId: common.hostId ?? null,
      paymentAttemptId: common.paymentAttemptId ?? null,
      refundId: common.refundId ?? null,
      transferId: common.transferId ?? null,
      disputeId: common.disputeId ?? null,
      providerObjectId: isCashPosting(draft) ? providerObjectId : null,
      simulated: common.simulated,
      createdBy: common.createdBy ?? null,
      memo: common.memo ?? null,
    }));
}

type Cash = { providerObjectId: string };
type Amount = { amountMinor: number };

function amountOf(input: Amount, what: string): number {
  requireMinor(input.amountMinor, what, 1);
  return input.amountMinor;
}

// TODO(U-049): first caller, confirmOrder.
/** Booking paid: the host share, the commission, and the tax (taxable only) land in cash, all under the payment's id. */
export function bookingPaid(
  input: Common &
    Linked<'orderId' | 'hostId' | 'paymentAttemptId'> &
    Cash & { split: PostingSplit },
): LedgerEntryInput[] {
  const legs = splitLegs(input.split);
  return build(
    input,
    [
      {
        entryType: 'charge_host_share',
        debitAccount: 'platform_cash',
        creditAccount: 'host_payable',
        amountMinor: legs.hostShare,
      },
      {
        entryType: 'charge_commission',
        debitAccount: 'platform_cash',
        creditAccount: 'ramble_commission',
        amountMinor: legs.commission,
      },
      {
        entryType: 'charge_tax',
        debitAccount: 'platform_cash',
        creditAccount: 'host_payable',
        amountMinor: legs.tax,
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-049): first caller, confirmOrder.
/** The card fee the provider kept from a payment, under that payment's id. */
export function cardFee(
  input: Common &
    Linked<'orderId' | 'hostId' | 'paymentAttemptId'> &
    Cash &
    Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'processing_fee',
        debitAccount: 'processing_fees',
        creditAccount: 'platform_cash',
        amountMinor: amountOf(input, 'The card fee'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-079a): first caller, the weekly transfer release.
/** The host's share left Ramble's balance, on the provider's transfer success event. */
export function transferPaid(
  input: Common & Linked<'orderId' | 'hostId' | 'transferId'> & Cash & Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'transfer_to_host',
        debitAccount: 'host_payable',
        creditAccount: 'platform_cash',
        amountMinor: amountOf(input, 'The transfer'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-079a): first caller, the transfer reversal path.
/** The host share came back from a paid transfer, under the provider's reversal id. */
export function transferReversed(
  input: Common & Linked<'orderId' | 'hostId' | 'transferId'> & Cash & Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'transfer_reversal',
        debitAccount: 'platform_cash',
        creditAccount: 'host_payable',
        amountMinor: amountOf(input, 'The reversal'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-056): first caller, the refund path.
/** A refund requested: no cash moves yet (rule 5). The legs are the refund row's split, `T - c`, `c`, and `X`. */
export function refundRequested(
  input: Common &
    Linked<'orderId' | 'hostId' | 'refundId'> &
    Optional<'paymentAttemptId'> & { split: PostingSplit },
): LedgerEntryInput[] {
  const legs = splitLegs(input.split);
  return build(
    input,
    [
      {
        entryType: 'refund_host_share',
        debitAccount: 'host_payable',
        creditAccount: 'refunds_pending',
        amountMinor: legs.hostShare,
      },
      {
        entryType: 'commission_returned',
        debitAccount: 'ramble_commission',
        creditAccount: 'refunds_pending',
        amountMinor: legs.commission,
      },
      {
        entryType: 'refund_tax',
        debitAccount: 'host_payable',
        creditAccount: 'refunds_pending',
        amountMinor: legs.tax,
      },
    ],
    null,
  );
}

// TODO(U-056): first caller, the refund.succeeded handler.
/** The provider paid the refund out: `T + X` leaves cash, under the provider's refund id. A gift refund names the gift instead of an order. */
export function refundSucceeded(
  input: Common &
    Linked<'refundId'> &
    (Linked<'orderId'> | Linked<'giftId'>) &
    Optional<'orderId' | 'giftId' | 'hostId' | 'paymentAttemptId'> &
    Cash &
    Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'refund_cash_out',
        debitAccount: 'refunds_pending',
        creditAccount: 'platform_cash',
        amountMinor: amountOf(input, 'The refund'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-056): first caller, the refund.failed handler.
/** A refund failed: one row per requested leg puts each back where it came from. */
export function refundFailed(
  input: Common &
    Linked<'orderId' | 'hostId' | 'refundId'> &
    Optional<'paymentAttemptId'> & { split: PostingSplit },
): LedgerEntryInput[] {
  const legs = splitLegs(input.split);
  return build(
    input,
    [
      {
        entryType: 'refund_reversal',
        debitAccount: 'refunds_pending',
        creditAccount: 'host_payable',
        amountMinor: legs.hostShare,
      },
      {
        entryType: 'refund_reversal',
        debitAccount: 'refunds_pending',
        creditAccount: 'ramble_commission',
        amountMinor: legs.commission,
      },
      {
        entryType: 'refund_reversal',
        debitAccount: 'refunds_pending',
        creditAccount: 'host_payable',
        amountMinor: legs.tax,
      },
    ],
    null,
  );
}

// TODO(U-062a): first caller, the gift purchase confirmation.
/** A gift paid for: the value, tax included, sits in the gift liability. */
export function giftPurchased(
  input: Common &
    Linked<'giftId'> &
    Optional<'orderId' | 'paymentAttemptId'> &
    Cash &
    Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'gift_liability_in',
        debitAccount: 'platform_cash',
        creditAccount: 'gift_liability',
        amountMinor: amountOf(input, 'The gift'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-064a): first caller, redeemGift.
/** A gift redeemed against a booking: the liability drains into the host share, commission, and tax from the gift's snapshot prices. */
export function giftRedeemed(
  input: Common &
    Linked<'giftId' | 'orderId' | 'hostId'> & { split: PostingSplit },
): LedgerEntryInput[] {
  const legs = splitLegs(input.split);
  return build(
    input,
    [
      {
        entryType: 'gift_to_host_share',
        debitAccount: 'gift_liability',
        creditAccount: 'host_payable',
        amountMinor: legs.hostShare,
      },
      {
        entryType: 'gift_to_commission',
        debitAccount: 'gift_liability',
        creditAccount: 'ramble_commission',
        amountMinor: legs.commission,
      },
      {
        entryType: 'gift_to_tax',
        debitAccount: 'gift_liability',
        creditAccount: 'host_payable',
        amountMinor: legs.tax,
      },
    ],
    null,
  );
}

// TODO(U-066a): first caller, the gift expiry job and the buyer refund.
/** Unused gift value goes to refunds pending, to be paid out through `refundSucceeded`. */
export function giftRefundedOrExpired(
  input: Common & Linked<'giftId'> & Optional<'orderId' | 'refundId'> & Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'gift_refund',
        debitAccount: 'gift_liability',
        creditAccount: 'refunds_pending',
        amountMinor: amountOf(input, 'The gift refund'),
      },
    ],
    null,
  );
}

// TODO(U-066b): first caller, the gift reinstatement after a cancelled redemption.
/** A cancelled redemption puts the gift back: one row per redemption leg returns to the liability. */
export function giftReinstated(
  input: Common &
    Linked<'giftId' | 'orderId' | 'hostId'> &
    Optional<'refundId'> & { split: PostingSplit },
): LedgerEntryInput[] {
  const legs = splitLegs(input.split);
  return build(
    input,
    [
      {
        entryType: 'gift_reinstated',
        debitAccount: 'host_payable',
        creditAccount: 'gift_liability',
        amountMinor: legs.hostShare,
      },
      {
        entryType: 'gift_reinstated',
        debitAccount: 'ramble_commission',
        creditAccount: 'gift_liability',
        amountMinor: legs.commission,
      },
      {
        entryType: 'gift_reinstated',
        debitAccount: 'host_payable',
        creditAccount: 'gift_liability',
        amountMinor: legs.tax,
      },
    ],
    null,
  );
}

// TODO(U-079b): first caller, the manual payout record.
/** Ramble pays itself commission, by hand (ADR 0003). It belongs to no order, gift, or host. */
export function rambleSelfPayout(
  input: Common & Cash & Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'ramble_payout',
        debitAccount: 'ramble_payouts',
        creditAccount: 'platform_cash',
        amountMinor: amountOf(input, 'The payout'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-079b): first caller, the dispute handlers.
/** A dispute opened: the provider withdrew the amount and charged a fee, both under the dispute's id. */
export function disputeOpened(
  input: Common &
    Linked<'orderId' | 'hostId' | 'disputeId'> &
    Optional<'paymentAttemptId'> &
    Cash &
    Amount & { feeMinor: number },
): LedgerEntryInput[] {
  requireMinor(input.feeMinor, 'The dispute fee', 0);
  return build(
    input,
    [
      {
        entryType: 'dispute_withdrawal',
        debitAccount: 'dispute_hold',
        creditAccount: 'platform_cash',
        amountMinor: amountOf(input, 'The withdrawal'),
      },
      {
        entryType: 'dispute_fee',
        debitAccount: 'processing_fees',
        creditAccount: 'platform_cash',
        amountMinor: input.feeMinor,
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-079b): first caller, the dispute handlers.
/** A dispute won: the withdrawn amount returns to cash. */
export function disputeWon(
  input: Common &
    Linked<'orderId' | 'hostId' | 'disputeId'> &
    Optional<'paymentAttemptId'> &
    Cash &
    Amount,
): LedgerEntryInput[] {
  return build(
    input,
    [
      {
        entryType: 'dispute_reinstated',
        debitAccount: 'platform_cash',
        creditAccount: 'dispute_hold',
        amountMinor: amountOf(input, 'The reinstated amount'),
      },
    ],
    input.providerObjectId,
  );
}

// TODO(U-079b): first caller, the dispute handlers.
/** A dispute lost: what the host can cover comes from the host payable (Q-18) and the rest is Ramble's loss. */
export function disputeLost(
  input: Common &
    Linked<'orderId' | 'hostId' | 'disputeId'> &
    Optional<'paymentAttemptId'> &
    Amount & { hostCoveredMinor: number },
): LedgerEntryInput[] {
  const amount = amountOf(input, 'The disputed amount');
  requireMinor(input.hostCoveredMinor, 'The host cover', 0);
  if (input.hostCoveredMinor > amount) {
    throw new RangeError('The host cover cannot exceed the disputed amount');
  }
  return build(
    input,
    [
      {
        entryType: 'dispute_to_host',
        debitAccount: 'host_payable',
        creditAccount: 'dispute_hold',
        amountMinor: input.hostCoveredMinor,
      },
      {
        entryType: 'dispute_loss',
        debitAccount: 'dispute_losses',
        creditAccount: 'dispute_hold',
        amountMinor: amount - input.hostCoveredMinor,
      },
    ],
    null,
  );
}

// ---------------------------------------------------------------------------------------------
// Views: the data layer sums rows by order, entry type, and accounts; these turn the sums into
// the host statement (PRD-47) and, through `orderLedgerSummaries`, the finance export (PRD-56):
// one row per booking, each marked when its money is simulated.

export const LedgerWindowSchema = z
  .object({ from: instant, to: instant })
  .refine((window) => window.from < window.to, {
    message: 'The window starts before it ends',
    path: ['to'],
  });
export type LedgerWindow = z.output<typeof LedgerWindowSchema>;

/** The sum of the rows of one order, entry type, and account pair inside a window. */
export type OrderFlow = Posting & {
  orderId: string;
  hostId: string | null;
  entryType: LedgerEntryType;
  simulated: boolean;
  firstAt: Date;
  lastAt: Date;
};

export type OrderLedgerSummary = {
  orderId: string;
  hostId: string | null;
  /** The ticket price booked, before tax, from card payments and gift redemptions. */
  grossMinor: number;
  taxMinor: number;
  /** Commission earned on the booking, before any is returned. */
  commissionMinor: number;
  /** Card and dispute fees Ramble paid (inside the commission, Q-03). */
  processingFeeMinor: number;
  /** Refunds requested, gifts put back, less refunds that failed. */
  refundedMinor: number;
  /** Transfers to the host less reversals. */
  paidToHostMinor: number;
  /** Still owed to the host from this booking. */
  owedToHostMinor: number;
  /** True when any row is simulated money (the demo's fake gateway and payouts). */
  simulated: boolean;
  firstAt: Date;
  /** When the last transfer to the host posted, or null before any has. */
  paidAt: Date | null;
};

const ticketTypes: readonly LedgerEntryType[] = [
  'charge_host_share',
  'charge_commission',
  'gift_to_host_share',
  'gift_to_commission',
];
const taxTypes: readonly LedgerEntryType[] = ['charge_tax', 'gift_to_tax'];
const commissionTypes: readonly LedgerEntryType[] = [
  'charge_commission',
  'gift_to_commission',
];
const refundRequestTypes: readonly LedgerEntryType[] = [
  'refund_host_share',
  'commission_returned',
  'refund_tax',
  'gift_reinstated',
];

function totalOf(
  flows: readonly OrderFlow[],
  types: readonly LedgerEntryType[],
): number {
  return flows
    .filter((flow) => types.includes(flow.entryType))
    .reduce((sum, flow) => sum + flow.amountMinor, 0);
}

function summarize(
  orderId: string,
  flows: readonly OrderFlow[],
): OrderLedgerSummary {
  const transfers = flows.filter(
    (flow) => flow.entryType === 'transfer_to_host',
  );
  const first = flows.reduce(
    (earliest, flow) => (flow.firstAt < earliest ? flow.firstAt : earliest),
    flows[0]?.firstAt ?? new Date(0),
  );
  return {
    orderId,
    hostId: flows.find((flow) => flow.hostId !== null)?.hostId ?? null,
    grossMinor: totalOf(flows, ticketTypes),
    taxMinor: totalOf(flows, taxTypes),
    commissionMinor: totalOf(flows, commissionTypes),
    processingFeeMinor: totalOf(flows, ['processing_fee', 'dispute_fee']),
    refundedMinor:
      totalOf(flows, refundRequestTypes) - totalOf(flows, ['refund_reversal']),
    paidToHostMinor:
      totalOf(flows, ['transfer_to_host']) -
      totalOf(flows, ['transfer_reversal']),
    owedToHostMinor: accountBalances(flows).host_payable,
    simulated: flows.some((flow) => flow.simulated),
    firstAt: first,
    paidAt: transfers.reduce<Date | null>(
      (latest, flow) =>
        latest === null || flow.lastAt > latest ? flow.lastAt : latest,
      null,
    ),
  };
}

/** One summary per order, oldest first and then by order id, so a statement and an export read in a fixed order. */
export function orderLedgerSummaries(
  flows: readonly OrderFlow[],
): OrderLedgerSummary[] {
  const byOrder = Map.groupBy(flows, (flow) => flow.orderId);
  return [...byOrder]
    .map(([orderId, orderFlows]) => summarize(orderId, orderFlows))
    .toSorted(
      (a, b) =>
        a.firstAt.getTime() - b.firstAt.getTime() ||
        a.orderId.localeCompare(b.orderId),
    );
}

export type HostStatement = {
  rows: OrderLedgerSummary[];
  totals: {
    grossMinor: number;
    taxMinor: number;
    commissionMinor: number;
    processingFeeMinor: number;
    refundedMinor: number;
    paidToHostMinor: number;
    owedToHostMinor: number;
  };
};

/** The host statement (PRD-47): a row per booking and the totals of the columns that add up. */
export function hostStatement(flows: readonly OrderFlow[]): HostStatement {
  const rows = orderLedgerSummaries(flows);
  const sum = (pick: (row: OrderLedgerSummary) => number) =>
    rows.reduce((total, row) => total + pick(row), 0);
  return {
    rows,
    totals: {
      grossMinor: sum((row) => row.grossMinor),
      taxMinor: sum((row) => row.taxMinor),
      commissionMinor: sum((row) => row.commissionMinor),
      processingFeeMinor: sum((row) => row.processingFeeMinor),
      refundedMinor: sum((row) => row.refundedMinor),
      paidToHostMinor: sum((row) => row.paidToHostMinor),
      owedToHostMinor: sum((row) => row.owedToHostMinor),
    },
  };
}
