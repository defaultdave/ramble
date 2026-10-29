import { z } from 'zod';
import { isTokenHash } from './capabilityTokens';
import { EntityIdSchema, taxTreatments } from './catalog';
import { EmailAddressSchema } from './email/address';
import {
  MAX_QUANTITY,
  MAX_UNIT_PRICE_MINOR,
  PPM,
  commissionMinor,
  taxMinor,
} from './pricing';
import { addRuleIssues, type RuleIssue } from './rules';
import { optionalText, requiredText } from './text';
import { canTransition, type TransitionTable } from './transitions';

// What an order and its items are, and every rule that decides what the data layer may write
// about them. The pgEnums and the CHECKs on `orders` and `order_items` are built from these
// tuples and constants, so the database refuses what these schemas refuse (design doc 4.2.3, Orders).

export const orderKinds = ['booking', 'gift_purchase'] as const;
type OrderKind = (typeof orderKinds)[number];

export const orderStatuses = [
  'pending_payment',
  'confirmed',
  'payment_failed',
  'void',
  'cancelled',
  'refunded_after_lapse',
] as const;
export type OrderStatus = (typeof orderStatuses)[number];

export const orderCancelledBys = [
  'guest',
  'host',
  'weather',
  'ramble',
] as const;

/** Prices are dollars at launch, so one currency is accepted everywhere an order or an attempt names one. */
export const orderCurrency = 'USD';

/** Crockford base32 leaves out I, L, O, and U, so a reference read aloud or typed from paper is unambiguous. */
export const orderReferencePattern = String.raw`^RMB-[0-9A-HJKMNP-TV-Z]{6}$`;
const orderReferenceRegex = new RegExp(orderReferencePattern);
const maxReferenceLength = 10;

export function isOrderReference(value: string): boolean {
  return value.length <= maxReferenceLength && orderReferenceRegex.test(value);
}

const OrderReferenceSchema = z
  .string()
  .max(maxReferenceLength)
  .refine(isOrderReference, { message: 'Not an order reference' });

/**
 * The money columns are Postgres integers (2,147,483,647). A subtotal of at most a billion minor
 * units keeps `subtotal + tax` (tax is at most the subtotal) inside the column, and no booking comes
 * near it: a party of six at the highest price is 60,000,000.
 */
export const orderLimits = {
  maxSubtotalMinor: 1_000_000_000,
  maxMinor: 2_000_000_000,
  maxBps: 10_000,
  contactPhone: 40,
  leadGuestName: 120,
  guardianName: 120,
  guardianContact: 254,
  attribution: 100,
  itemLabel: 80,
  maxChildren: MAX_QUANTITY,
  maxChildAge: 17,
} as const;

export const idempotencyKeyUuidPattern = String.raw`^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$`;
const idempotencyKeyUuidRegex = new RegExp(idempotencyKeyUuidPattern);
const bookingKeyPrefix = 'book:';
const uuidLength = 36;

/** Two tabs or a refresh on one hold reach one order (design doc 4.2.3). */
// TODO(U-047a): first caller, the order insert in startPayment.
export function bookingIdempotencyKey(holdId: string): string {
  return `${bookingKeyPrefix}${holdId.toLowerCase()}`;
}

/** A gift checkout's key is a uuid made once for that checkout; this checks only its shape. */
export function isGiftPurchaseKey(key: string): boolean {
  return key.length === uuidLength && idempotencyKeyUuidRegex.test(key);
}

/**
 * Every order moves along this table and no other (design doc 4.2.3, Order transitions).
 * `cancelled` and `refunded_after_lapse` are terminal; `void` is not, because a payment that
 * succeeds after the hold was released still lands through `confirmOrder`.
 */
export const orderTransitions = {
  pending_payment: [
    'confirmed',
    'payment_failed',
    'void',
    'refunded_after_lapse',
  ],
  payment_failed: [
    'pending_payment',
    'confirmed',
    'void',
    'refunded_after_lapse',
  ],
  void: ['confirmed', 'refunded_after_lapse'],
  confirmed: ['cancelled'],
  cancelled: [],
  refunded_after_lapse: [],
} as const satisfies TransitionTable<OrderStatus>;

/** An order is created as `pending_payment` (an amount is due) or `confirmed` (a redemption with nothing due). */
export const orderInitialStatuses = [
  'pending_payment',
  'confirmed',
] as const satisfies readonly OrderStatus[];

// TODO(U-049): first caller, confirmOrder.
export function canOrderTransition(
  from: OrderStatus,
  to: OrderStatus,
): boolean {
  return canTransition(orderTransitions, from, to);
}

/** What the guest pays: the total less the gift applied, never below zero. */
// TODO(U-047a): first caller, the order snapshot in startPayment.
export function orderAmountDueMinor(
  totalMinor: number,
  giftAppliedMinor: number,
): number {
  return Math.max(0, totalMinor - giftAppliedMinor);
}

type OrderRuleFields = {
  kind: OrderKind;
  status: OrderStatus;
  idempotencyKey: string;
  holdId: string | null;
  sessionId: string | null;
  giftId: string | null;
  leadGuestName: string | null;
  childrenAges: readonly number[] | null;
  guardianName: string | null;
  guardianContact: string | null;
  ticketSubtotalMinor: number;
  taxTreatment: (typeof taxTreatments)[number];
  taxRatePpm: number;
  taxMinor: number;
  totalMinor: number;
  giftAppliedMinor: number;
  amountDueMinor: number;
  commissionRateBps: number;
  commissionMinor: number;
  refundedTicketMinor: number;
  refundedTaxMinor: number;
  commissionReturnedMinor: number;
  cancelledBy: string | null;
  createdAt: Date;
  confirmedAt: Date | null;
  cancelledAt: Date | null;
};

const confirmedStatuses: readonly OrderStatus[] = ['confirmed', 'cancelled'];

function moneyIssues(order: OrderRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const add = (path: string, message: string) => {
    issues.push({ path, message });
  };
  // Zod runs these checks even when a field's own type check failed; stay quiet on those values.
  if (
    !Number.isSafeInteger(order.ticketSubtotalMinor) ||
    !Number.isSafeInteger(order.taxRatePpm) ||
    !Number.isSafeInteger(order.commissionRateBps)
  ) {
    return issues;
  }
  if (order.taxTreatment !== 'taxable' && order.taxRatePpm !== 0) {
    add('taxRatePpm', 'The tax rate is 0 unless the experience is taxable');
  }
  if (
    order.taxRatePpm >= 0 &&
    order.taxRatePpm <= PPM &&
    order.ticketSubtotalMinor >= 0 &&
    order.ticketSubtotalMinor <= orderLimits.maxSubtotalMinor
  ) {
    if (
      order.taxMinor !== taxMinor(order.ticketSubtotalMinor, order.taxRatePpm)
    ) {
      add('taxMinor', 'The tax is the rounded rate on the ticket subtotal');
    }
  }
  if (order.totalMinor !== order.ticketSubtotalMinor + order.taxMinor) {
    add('totalMinor', 'The total is the ticket subtotal plus the tax');
  }
  if (
    order.giftAppliedMinor < 0 ||
    order.giftAppliedMinor > order.totalMinor ||
    order.amountDueMinor !== order.totalMinor - order.giftAppliedMinor
  ) {
    add(
      'amountDueMinor',
      'The amount due is the total less the gift applied, and not below zero',
    );
  }
  if (order.giftAppliedMinor > 0 && order.giftId === null) {
    add('giftId', 'A gift applied names the gift');
  }
  if (
    order.commissionRateBps >= 0 &&
    order.commissionRateBps <= orderLimits.maxBps &&
    order.ticketSubtotalMinor >= 0 &&
    order.ticketSubtotalMinor <= orderLimits.maxSubtotalMinor &&
    order.commissionMinor !==
      commissionMinor(order.ticketSubtotalMinor, order.commissionRateBps)
  ) {
    add(
      'commissionMinor',
      'The commission is the rounded rate on the ticket subtotal',
    );
  }
  if (order.refundedTicketMinor > order.ticketSubtotalMinor) {
    add('refundedTicketMinor', 'Cannot exceed the ticket subtotal');
  }
  if (order.refundedTaxMinor > order.taxMinor) {
    add('refundedTaxMinor', 'Cannot exceed the tax');
  }
  if (order.commissionReturnedMinor > order.commissionMinor) {
    add('commissionReturnedMinor', 'Cannot exceed the commission');
  }
  return issues;
}

function kindIssues(order: OrderRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (order.kind === 'booking') {
    if (order.holdId === null) {
      issues.push({ path: 'holdId', message: 'A booking has a hold' });
    }
    if (order.sessionId === null) {
      issues.push({ path: 'sessionId', message: 'A booking has a session' });
    }
    if (order.leadGuestName === null) {
      issues.push({
        path: 'leadGuestName',
        message: 'A booking names the lead guest',
      });
    }
    if (
      order.holdId === null ||
      order.idempotencyKey !== bookingIdempotencyKey(order.holdId)
    ) {
      issues.push({
        path: 'idempotencyKey',
        message: 'A booking key is book: and the hold id',
      });
    }
    return issues;
  }
  if (order.holdId !== null || order.sessionId !== null) {
    issues.push({
      path: 'holdId',
      message: 'A gift purchase has no hold and no session',
    });
  }
  if (!isGiftPurchaseKey(order.idempotencyKey)) {
    issues.push({
      path: 'idempotencyKey',
      message: 'A gift purchase key is a lower-case uuid',
    });
  }
  if (order.giftAppliedMinor !== 0) {
    issues.push({
      path: 'giftAppliedMinor',
      message: 'A gift purchase applies no gift',
    });
  }
  return issues;
}

function guardianIssues(order: OrderRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  if (order.childrenAges !== null) {
    if (order.guardianName === null || order.guardianContact === null) {
      issues.push({
        path: 'guardianName',
        message: 'Children come with a guardian name and contact',
      });
    }
  }
  if ((order.guardianName === null) !== (order.guardianContact === null)) {
    issues.push({
      path: 'guardianContact',
      message: 'A guardian has both a name and a contact',
    });
  }
  return issues;
}

function statusIssues(order: OrderRuleFields): RuleIssue[] {
  const issues: RuleIssue[] = [];
  const confirmed = confirmedStatuses.includes(order.status);
  if ((order.confirmedAt !== null) !== confirmed) {
    issues.push({
      path: 'confirmedAt',
      message:
        'Set exactly when the order was confirmed (confirmed or cancelled)',
    });
  }
  const cancelled = order.status === 'cancelled';
  if ((order.cancelledAt !== null) !== cancelled) {
    issues.push({
      path: 'cancelledAt',
      message: 'Set exactly when the order is cancelled',
    });
  }
  if ((order.cancelledBy !== null) !== cancelled) {
    issues.push({
      path: 'cancelledBy',
      message: 'Set exactly when the order is cancelled',
    });
  }
  if (order.confirmedAt !== null && order.confirmedAt < order.createdAt) {
    issues.push({ path: 'confirmedAt', message: 'Not before it was created' });
  }
  if (
    order.cancelledAt !== null &&
    order.confirmedAt !== null &&
    order.cancelledAt < order.confirmedAt
  ) {
    issues.push({
      path: 'cancelledAt',
      message: 'Not before it was confirmed',
    });
  }
  return issues;
}

/** Every rule that ties an order's fields together; the CHECKs on `orders` state the same rules. */
function orderRuleIssues(order: OrderRuleFields): RuleIssue[] {
  return [
    ...kindIssues(order),
    ...moneyIssues(order),
    ...guardianIssues(order),
    ...statusIssues(order),
  ];
}

const minor = (max: number) => z.int().min(0).max(max);

const orderFields = z.object({
  id: EntityIdSchema,
  reference: OrderReferenceSchema,
  kind: z.enum(orderKinds),
  status: z.enum(orderStatuses),
  idempotencyKey: z.string().max(bookingKeyPrefix.length + uuidLength),
  holdId: EntityIdSchema.nullable(),
  sessionId: EntityIdSchema.nullable(),
  experienceId: EntityIdSchema,
  hostId: EntityIdSchema,
  giftId: EntityIdSchema.nullable(),
  guestId: EntityIdSchema,
  contactEmail: EmailAddressSchema,
  contactPhone: optionalText(orderLimits.contactPhone),
  leadGuestName: optionalText(orderLimits.leadGuestName),
  ageConfirmed: z.boolean().nullable(),
  childrenAges: z
    .array(z.int().min(0).max(orderLimits.maxChildAge))
    .min(1)
    .max(orderLimits.maxChildren)
    .nullable(),
  guardianName: optionalText(orderLimits.guardianName),
  guardianContact: optionalText(orderLimits.guardianContact),
  waiverDocumentId: EntityIdSchema.nullable(),
  termsDocumentId: EntityIdSchema,
  currency: z.literal(orderCurrency),
  ticketSubtotalMinor: minor(orderLimits.maxSubtotalMinor),
  taxTreatment: z.enum(taxTreatments),
  taxRatePpm: z.int().min(0).max(PPM),
  taxMinor: minor(orderLimits.maxMinor),
  totalMinor: minor(orderLimits.maxMinor),
  giftAppliedMinor: minor(orderLimits.maxMinor),
  amountDueMinor: minor(orderLimits.maxMinor),
  commissionRateBps: z.int().min(0).max(orderLimits.maxBps),
  commissionMinor: minor(orderLimits.maxMinor),
  refundedTicketMinor: minor(orderLimits.maxMinor),
  refundedTaxMinor: minor(orderLimits.maxMinor),
  commissionReturnedMinor: minor(orderLimits.maxMinor),
  refundFailed: z.boolean(),
  cancellationTierId: EntityIdSchema,
  freeCancelUntil: z.date().nullable(),
  cancelledBy: z.enum(orderCancelledBys).nullable(),
  attributionSource: optionalText(orderLimits.attribution),
  attributionCampaign: optionalText(orderLimits.attribution),
  attributionIssue: optionalText(orderLimits.attribution),
  manageTokenHash: z
    .string()
    .refine(isTokenHash, { message: 'Not a token hash' })
    .nullable(),
  manageTokenVersion: z.int().min(1),
  synthetic: z.boolean(),
  createdAt: z.date(),
  confirmedAt: z.date().nullable(),
  cancelledAt: z.date().nullable(),
});

// TODO(U-047a): first caller, the order read in startPayment.
export const OrderSchema = orderFields.superRefine((order, ctx) => {
  addRuleIssues(orderRuleIssues(order), ctx);
});
export type Order = z.infer<typeof OrderSchema>;

function orderItemLineTotalMinor(
  quantity: number,
  unitPriceMinor: number,
): number {
  return quantity * unitPriceMinor;
}

// TODO(U-047a): first caller, the order items read in startPayment.
export const OrderItemSchema = z
  .object({
    orderId: EntityIdSchema,
    priceOptionId: EntityIdSchema,
    label: requiredText(orderLimits.itemLabel),
    quantity: z.int().min(1).max(MAX_QUANTITY),
    unitPriceMinor: z.int().min(0).max(MAX_UNIT_PRICE_MINOR),
    usesSpace: z.boolean(),
    lineTotalMinor: z.int().min(0),
  })
  .refine(
    (item) =>
      item.lineTotalMinor ===
      orderItemLineTotalMinor(item.quantity, item.unitPriceMinor),
    {
      message: 'The line total is the quantity times the unit price',
      path: ['lineTotalMinor'],
    },
  );
