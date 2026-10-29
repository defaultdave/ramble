import { z } from 'zod';
import { cancellationWindow } from './cancellation';
import {
  WriteIdSchema,
  priceKindLabel,
  type ageRules,
  type priceKinds,
  type taxTreatments,
} from './catalog';
import { GuestEmailSchema } from './guests';
import {
  fieldErrorsFromIssues,
  isHoldOfDevice,
  isOpenHold,
  partyFits,
  reserveRefusal,
  type HoldTimes,
  type ReserveSubject,
  type SessionSummary,
} from './holds';
import {
  bookingIdempotencyKey,
  canOrderTransition,
  crockfordAlphabet,
  isOrderReference,
  orderAmountDueMinor,
  orderCurrency,
  orderLimits,
  type OrderStatus,
} from './orders';
import {
  isLiveAttempt,
  maxFailedTries,
  paymentLimits,
  type AttemptStatus,
  type PaymentProvider,
} from './payments';
import {
  commissionMinor,
  defaultCommissionRateBps,
  lines as pricingLines,
  taxRatePpm,
  type PricingLines,
} from './pricing';
import type { RateLimitDecision } from './rateLimits';
import { requiredText } from './text';

// What `startPayment` accepts, answers, and decides (design doc 4.2.3, Orders). The data layer
// reads and locks and writes; every decision it acts on is a function here.

type PriceKind = (typeof priceKinds)[number];

/** One code per field: `required`, `invalid`, or a rule's own word such as `out_of_range`. */
export type FieldErrors = Record<string, string>;

const ChildAgeSchema = z.int().min(0).max(orderLimits.maxChildAge);

/**
 * The guest's checkout form. Ids are lower-cased, the email is folded to the one spelling it is
 * stored in, and every string is bounded before anything walks it. A failed parse becomes
 * `invalid` (see `invalidStartPayment`), never a throw.
 */
export const StartPaymentInputSchema = z.object({
  holdId: WriteIdSchema,
  contact: z.object({
    email: GuestEmailSchema,
    phone: requiredText(orderLimits.contactPhone).optional(),
  }),
  leadGuestName: requiredText(orderLimits.leadGuestName),
  attendees: z.object({
    ageConfirmed: z.boolean().optional(),
    childrenAges: z
      .array(ChildAgeSchema)
      .min(1)
      .max(orderLimits.maxChildren)
      .optional(),
    guardian: z
      .object({
        name: requiredText(orderLimits.guardianName),
        contact: requiredText(orderLimits.guardianContact),
      })
      .optional(),
  }),
  waiverDocumentId: WriteIdSchema.optional(),
  termsDocumentId: WriteIdSchema,
  newsletterOptIn: z.boolean(),
  attribution: z
    .object({
      source: requiredText(orderLimits.attribution).optional(),
      campaign: requiredText(orderLimits.attribution).optional(),
      issue: requiredText(orderLimits.attribution).optional(),
    })
    .optional(),
});
export type StartPaymentInput = z.input<typeof StartPaymentInputSchema>;
type ParsedInput = z.output<typeof StartPaymentInputSchema>;

export type StartPaymentResult =
  | {
      status: 'requires_payment';
      orderId: string;
      reference: string;
      payment: { provider: PaymentProvider; clientSecret: string };
      amountDueMinor: number;
      orderToken?: string;
    }
  | { status: 'already_confirmed'; reference: string; orderToken?: string }
  | { status: 'hold_expired'; canRehold: boolean; spacesLeft: number }
  | { status: 'sold_out'; alternatives: SessionSummary[] }
  | { status: 'too_many_tries' }
  | { status: 'invalid'; fieldErrors: FieldErrors };

type Issue = { path: readonly PropertyKey[]; message: string };

const dottedField = (path: readonly PropertyKey[]) =>
  path.length === 0 ? 'input' : path.map(String).join('.');

/** A failed parse of the form: one code per field, keyed by its whole path (`contact.email`). */
export function invalidStartPayment(
  issues: readonly Issue[],
): StartPaymentResult {
  return {
    status: 'invalid',
    fieldErrors: fieldErrorsFromIssues(issues, dottedField),
  };
}

// ---- The rules on the form ----

type AgeSubject = {
  ageRule: (typeof ageRules)[number];
  minAge: number | null;
  maxAge: number | null;
};

type Attendees = ParsedInput['attendees'];

/** How many of the party are children: the quantity on the child price option. */
export function childCount(
  items: readonly { kind: PriceKind; quantity: number }[],
): number {
  return items.reduce(
    (total, item) => (item.kind === 'child' ? total + item.quantity : total),
    0,
  );
}

function childAgeAllowed(subject: AgeSubject, age: number): boolean {
  switch (subject.ageRule) {
    case 'all_ages':
      return true;
    case 'minimum_age':
      return subject.minAge !== null && age >= subject.minAge;
    case 'age_range':
      return (
        subject.minAge !== null &&
        subject.maxAge !== null &&
        age >= subject.minAge &&
        age <= subject.maxAge
      );
    case 'twenty_one_plus':
      return false;
  }
}

/**
 * Age rules at checkout (PRD-23). An experience with any age limit needs the booker to confirm
 * every attendee meets it (`age_confirmed` true, 21+ included). The party's children each give an
 * age within the experience's range, exactly one age per child, and a guardian's name and contact
 * come with them. A guardian with no child is refused rather than stored: the form asks for
 * nothing it has no use for. The party has `children` children (see `childCount`).
 */
export function attendeeIssues(
  subject: AgeSubject,
  attendees: Attendees,
  children: number,
): FieldErrors {
  const issues: FieldErrors = {};
  if (subject.ageRule !== 'all_ages' && attendees.ageConfirmed !== true) {
    issues['attendees.ageConfirmed'] = 'required';
  }
  const ages = attendees.childrenAges ?? [];
  if (children > 0 && ages.length === 0) {
    issues['attendees.childrenAges'] = 'required';
  } else if (ages.length !== children) {
    issues['attendees.childrenAges'] = 'invalid';
  } else if (!ages.every((age) => childAgeAllowed(subject, age))) {
    issues['attendees.childrenAges'] = 'out_of_range';
  }
  if (children > 0 && attendees.guardian === undefined) {
    issues['attendees.guardian'] = 'required';
  } else if (children === 0 && attendees.guardian !== undefined) {
    issues['attendees.guardian'] = 'invalid';
  }
  return issues;
}

type PublishedDocument = { id: string } | null;

/**
 * Terms and waiver (PRD-24). The terms accepted are the current published version. The waiver is
 * required exactly when the experience requires one, and it is that experience's own published
 * document; a waiver sent for an experience that needs none is refused, not ignored.
 */
export function legalIssues(
  experience: { waiverRequired: boolean; waiverDocumentId: string | null },
  input: Pick<ParsedInput, 'termsDocumentId' | 'waiverDocumentId'>,
  published: { terms: PublishedDocument; waiver: PublishedDocument },
): FieldErrors {
  const issues: FieldErrors = {};
  if (published.terms?.id !== input.termsDocumentId) {
    issues.termsDocumentId = 'invalid';
  }
  if (!experience.waiverRequired) {
    if (input.waiverDocumentId !== undefined) {
      issues.waiverDocumentId = 'invalid';
    }
  } else if (input.waiverDocumentId === undefined) {
    issues.waiverDocumentId = 'required';
  } else if (
    experience.waiverDocumentId === null ||
    input.waiverDocumentId !== experience.waiverDocumentId ||
    published.waiver?.id !== experience.waiverDocumentId
  ) {
    issues.waiverDocumentId = 'invalid';
  }
  return issues;
}

/** Every rule on the form that needs the experience, and the published versions it names. */
export function inputIssues(
  experience: AgeSubject & {
    waiverRequired: boolean;
    waiverDocumentId: string | null;
  },
  input: ParsedInput,
  children: number,
  published: { terms: PublishedDocument; waiver: PublishedDocument },
): FieldErrors {
  return {
    ...attendeeIssues(experience, input.attendees, children),
    ...legalIssues(experience, input, published),
  };
}

// ---- The order the form makes ----

export type HeldItem = {
  priceOptionId: string;
  kind: PriceKind;
  quantity: number;
  unitPriceMinor: number;
  usesSpace: boolean;
};

/**
 * What the hold's lines cost: the unit prices the hold snapshotted (what the guest was shown), with
 * the tax of the experience's treatment at the settings rate.
 */
export function priceHold(
  items: readonly HeldItem[],
  taxTreatment: (typeof taxTreatments)[number],
  settingsTaxRatePpm: number,
): PricingLines {
  return pricingLines(
    items.map(({ priceOptionId, quantity }) => ({ priceOptionId, quantity })),
    items.map(({ priceOptionId, kind, unitPriceMinor, usesSpace }) => ({
      id: priceOptionId,
      kind,
      priceMinor: unitPriceMinor,
      usesSpace,
    })),
    taxRatePpm(taxTreatment, settingsTaxRatePpm),
  );
}

/**
 * The columns of a pending order that follow the guest's latest input: who is paying and who is
 * coming. A reused order is updated with these, so a typo fixed after a decline is not lost.
 */
export function orderFields(input: ParsedInput, guestId: string) {
  return {
    guestId,
    contactEmail: input.contact.email,
    contactPhone: input.contact.phone ?? null,
    leadGuestName: input.leadGuestName,
    ageConfirmed: input.attendees.ageConfirmed ?? null,
    childrenAges: input.attendees.childrenAges
      ? [...input.attendees.childrenAges]
      : null,
    guardianName: input.attendees.guardian?.name ?? null,
    guardianContact: input.attendees.guardian?.contact ?? null,
    waiverDocumentId: input.waiverDocumentId ?? null,
    termsDocumentId: input.termsDocumentId,
  };
}

export type OrderSource = {
  reference: string;
  holdId: string;
  session: {
    id: string;
    experienceId: string;
    startsAt: Date;
    timeZone: string;
  };
  hostId: string;
  taxTreatment: (typeof taxTreatments)[number];
  tier: { id: string; fullRefundHoursBefore: number };
  priced: PricingLines;
  fields: ReturnType<typeof orderFields>;
  attribution: ParsedInput['attribution'];
  /** The database clock, read after the locks. */
  at: Date;
};

/**
 * Every column of the new order, snapshots included: the tax treatment and rate, the commission
 * rate and amount, the cancellation tier and the last moment a cancel is free, and the guest's
 * attribution. Nothing is derived from a figure the browser sent; a gift is never applied here.
 */
export function orderSnapshot(source: OrderSource) {
  const { priced, session, tier, at } = source;
  return {
    ...source.fields,
    reference: source.reference,
    kind: 'booking' as const,
    status: 'pending_payment' as const,
    idempotencyKey: bookingIdempotencyKey(source.holdId),
    holdId: source.holdId,
    sessionId: session.id,
    experienceId: session.experienceId,
    hostId: source.hostId,
    currency: orderCurrency,
    ticketSubtotalMinor: priced.ticketSubtotalMinor,
    taxTreatment: source.taxTreatment,
    taxRatePpm: priced.taxRatePpm,
    taxMinor: priced.taxMinor,
    totalMinor: priced.totalMinor,
    giftAppliedMinor: 0,
    amountDueMinor: orderAmountDueMinor(priced.totalMinor, 0),
    commissionRateBps: defaultCommissionRateBps,
    commissionMinor: commissionMinor(
      priced.ticketSubtotalMinor,
      defaultCommissionRateBps,
    ),
    cancellationTierId: tier.id,
    freeCancelUntil: cancellationWindow(
      tier,
      session.startsAt,
      at,
      session.timeZone,
    ).freeCancelUntil,
    attributionSource: source.attribution?.source ?? null,
    attributionCampaign: source.attribution?.campaign ?? null,
    attributionIssue: source.attribution?.issue ?? null,
  };
}

/** The order's lines, as priced when the order was made. */
export function orderItemRows(orderId: string, priced: PricingLines) {
  return priced.lines.map((line) => ({
    orderId,
    priceOptionId: line.priceOptionId,
    label: priceKindLabel(line.kind),
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    usesSpace: line.usesSpace,
    lineTotalMinor: line.lineTotalMinor,
  }));
}

const referenceCharacters = 6;
/** Tries at a reference that does not clash with an existing one, before the insert gives up. */
export const referenceTries = 3;

/**
 * `RMB-` and six Crockford base32 characters. `randomIndex(max)` returns an integer from 0 up to
 * but not including `max`; the caller supplies a cryptographic source. The result passes the
 * format check the database CHECK states too.
 */
export function newOrderReference(
  randomIndex: (exclusiveMax: number) => number,
): string {
  let suffix = '';
  for (let position = 0; position < referenceCharacters; position += 1) {
    const character = crockfordAlphabet[randomIndex(crockfordAlphabet.length)];
    if (character === undefined) {
      throw new RangeError('The random index fell outside the alphabet');
    }
    suffix += character;
  }
  const reference = `RMB-${suffix}`;
  if (!isOrderReference(reference)) {
    throw new RangeError('A new reference must match the reference format');
  }
  return reference;
}

/** The versions the guest accepted at checkout: the marketplace terms, and the host's waiver when one was sent. */
export function acceptedDocumentIds(
  input: Pick<ParsedInput, 'termsDocumentId' | 'waiverDocumentId'>,
): string[] {
  return input.waiverDocumentId === undefined
    ? [input.termsDocumentId]
    : [input.termsDocumentId, input.waiverDocumentId];
}

/** What the guest would pay now: the existing order's amount due, else the new order's, else nothing yet. */
export function amountDueNow(
  order: { amountDueMinor: number } | null,
  priced: Pick<PricingLines, 'totalMinor'> | null,
): number {
  if (order !== null) return order.amountDueMinor;
  return priced === null ? 0 : orderAmountDueMinor(priced.totalMinor, 0);
}

/** A retry after a decline puts the order back to `pending_payment`; any other status is kept. */
export function statusOnRetry(status: OrderStatus): OrderStatus {
  return status === 'payment_failed' &&
    canOrderTransition('payment_failed', 'pending_payment')
    ? 'pending_payment'
    : status;
}

// ---- The decision ----

/** The answer for a hold that is missing, someone else's, or can never be paid (Q1). */
export const unknownHold: StartPaymentResult = {
  status: 'hold_expired',
  canRehold: false,
  spacesLeft: 0,
};

export const tooManyTries: StartPaymentResult = { status: 'too_many_tries' };

/** The `payment_tries` limit, spent before any lock: a try over it is refused and writes nothing. */
export function paymentTriesRefusal(
  tried: RateLimitDecision,
): StartPaymentResult | null {
  return tried.allowed ? null : tooManyTries;
}

type DecisionHold = HoldTimes & {
  sessionId: string;
  deviceKey: string;
  purpose: 'booking' | 'gift_redemption';
};

export type DecisionState = {
  deviceKey: string;
  /** The session the hold named when it was read without a lock; the locked hold must still name it. */
  readSessionId: string;
  hold: DecisionHold | null;
  subject: ReserveSubject | null;
  order: { status: OrderStatus } | null;
  /** The order's attempt with the highest number. A live attempt is always the latest. */
  latestAttempt: {
    id: string;
    attemptNo: number;
    status: AttemptStatus;
    failedTries: number;
    providerPaymentId: string | null;
  } | null;
  issues: FieldErrors;
  /** What would be charged: the order's amount due, or the new order's. */
  amountDueMinor: number;
  chargeLimits: { minMinor: number; maxMinor: number };
  /** The database clock, read after the locks. */
  at: Date;
};

export type StartDecision =
  | { kind: 'refuse'; result: StartPaymentResult }
  | { kind: 'already_confirmed' }
  | { kind: 'lapsed' }
  | { kind: 'in_flight'; attemptId: string; providerPaymentId: string }
  | { kind: 'resume'; attemptId: string }
  | { kind: 'next_attempt'; attemptNo: number }
  | { kind: 'create'; attemptNo: number };

const refuse = (result: StartPaymentResult): StartDecision => ({
  kind: 'refuse',
  result,
});

/** Statuses a pending order can be paid again from. `void` is not terminal (design doc 4.2.3). */
const payableOrderStatuses: readonly OrderStatus[] = [
  'pending_payment',
  'payment_failed',
  'void',
];

/**
 * What `startPayment` does with the state it read under the locks, in order:
 *
 * 1. A hold that is missing, not the caller's, not a booking hold, or moved to another session
 *    answers `hold_expired` with no re-hold, so a guessed id learns nothing. An order that is
 *    cancelled or refunded cannot be paid again and answers the same.
 * 2. A confirmed order answers `already_confirmed` whatever was sent (S9).
 * 3. A form with issues is `invalid`; nothing is written.
 * 4. A latest attempt with 5 failed tries is `too_many_tries`.
 * 5. An attempt that holds the order's payment (any but `canceled`) and has a provider payment is
 *    returned as it is, even when the hold has lapsed since: the guest may already have paid, and
 *    answering "expired" then would invite a second payment. A succeeded attempt is such a payment
 *    until `confirmOrder` runs.
 * 6. Otherwise the session must still take bookings (else the same `hold_expired`), and the hold
 *    must be open now (rule 2): a lapsed one is `lapsed`, which the data layer
 *    turns into `hold_expired` or `sold_out` from the spaces left.
 * 7. An amount the provider would refuse is `invalid`; nothing is written.
 * 8. Then a live attempt with no provider payment yet is resumed, an order with none gets the next
 *    attempt, and a hold with no order gets the order and attempt 1.
 */
export function startPaymentDecision(state: DecisionState): StartDecision {
  const { hold, order, latestAttempt } = state;
  if (
    !isHoldOfDevice(hold, state.deviceKey) ||
    hold.purpose !== 'booking' ||
    hold.sessionId !== state.readSessionId ||
    state.subject === null
  ) {
    return refuse(unknownHold);
  }
  if (order?.status === 'confirmed') return { kind: 'already_confirmed' };
  if (order !== null && !payableOrderStatuses.includes(order.status)) {
    return refuse(unknownHold);
  }
  if (Object.keys(state.issues).length > 0) {
    return refuse({ status: 'invalid', fieldErrors: state.issues });
  }
  if (latestAttempt !== null && latestAttempt.failedTries >= maxFailedTries) {
    return refuse(tooManyTries);
  }
  if (latestAttempt !== null && latestAttempt.status !== 'canceled') {
    if (latestAttempt.providerPaymentId !== null) {
      return {
        kind: 'in_flight',
        attemptId: latestAttempt.id,
        providerPaymentId: latestAttempt.providerPaymentId,
      };
    }
    if (!isLiveAttempt(latestAttempt.status)) return refuse(unknownHold);
  }
  if (reserveRefusal(state.subject, state.at) !== null) {
    return refuse(unknownHold);
  }
  if (!isOpenHold(hold, state.at)) return { kind: 'lapsed' };
  if (
    state.amountDueMinor < state.chargeLimits.minMinor ||
    state.amountDueMinor > state.chargeLimits.maxMinor
  ) {
    return refuse({
      status: 'invalid',
      fieldErrors: { holdId: 'not_payable' },
    });
  }
  if (latestAttempt !== null && isLiveAttempt(latestAttempt.status)) {
    return { kind: 'resume', attemptId: latestAttempt.id };
  }
  const attemptNo = (latestAttempt?.attemptNo ?? 0) + 1;
  if (attemptNo > paymentLimits.maxAttemptNo) return refuse(tooManyTries);
  return order === null
    ? { kind: 'create', attemptNo }
    : { kind: 'next_attempt', attemptNo };
}

/**
 * The answer for a hold that is no longer open, from the spaces left without it. With none left
 * the party is `sold_out` (the data layer then finds other dates); otherwise `hold_expired`, and
 * the guest may hold again only when the whole party still fits.
 */
export function lapsedOutcome(
  seats: number,
  spacesLeftNow: number,
): { kind: 'result'; result: StartPaymentResult } | { kind: 'sold_out' } {
  const left = Math.max(0, spacesLeftNow);
  if (left === 0) return { kind: 'sold_out' };
  return {
    kind: 'result',
    result: {
      status: 'hold_expired',
      canRehold: partyFits(seats, left),
      spacesLeft: left,
    },
  };
}

/**
 * The order token goes to the device whose cookie hash is the hold's `device_key`, and to no other
 * (the capability-token amendment). `token` is called only for that device.
 */
export function orderTokenFor(
  hold: { deviceKey: string },
  deviceKey: string,
  token: () => string,
): string | undefined {
  return isHoldOfDevice(hold, deviceKey) ? token() : undefined;
}

export function alreadyConfirmedResult(
  reference: string,
  orderToken: string | undefined,
): StartPaymentResult {
  return orderToken === undefined
    ? { status: 'already_confirmed', reference }
    : { status: 'already_confirmed', reference, orderToken };
}

export function requiresPaymentResult(
  order: { id: string; reference: string; amountDueMinor: number },
  payment: { provider: PaymentProvider; clientSecret: string },
  orderToken: string | undefined,
): StartPaymentResult {
  const result = {
    status: 'requires_payment' as const,
    orderId: order.id,
    reference: order.reference,
    payment: {
      provider: payment.provider,
      clientSecret: payment.clientSecret,
    },
    amountDueMinor: order.amountDueMinor,
  };
  return orderToken === undefined ? result : { ...result, orderToken };
}

// ---- The provider ----

export type ProviderStep =
  | { step: 'retrieve'; paymentId: string }
  | { step: 'find_or_create' }
  | { step: 'create' };

/**
 * What to ask the provider for an attempt. One that has a provider payment is read again (rule 4).
 * One made by an earlier call that never stored its payment is looked up by Ramble's ids first
 * (rule 7), because the provider may hold a payment under its key that was never recorded. A new
 * attempt just made here can have none, so it is created.
 */
export function providerStep(attempt: {
  providerPaymentId: string | null;
  existed: boolean;
}): ProviderStep {
  if (attempt.providerPaymentId !== null) {
    return { step: 'retrieve', paymentId: attempt.providerPaymentId };
  }
  return attempt.existed ? { step: 'find_or_create' } : { step: 'create' };
}

/**
 * Whether the provider's payment id may be written to an attempt: once, and only while the attempt
 * is live (rule 3). The same id again is a repeat, and a different id never replaces the first.
 */
export function storeProviderPayment(
  attempt: { status: AttemptStatus; providerPaymentId: string | null },
  paymentId: string,
): { write: boolean; stored: boolean } {
  if (attempt.providerPaymentId === paymentId) {
    return { write: false, stored: true };
  }
  if (attempt.providerPaymentId !== null || !isLiveAttempt(attempt.status)) {
    return { write: false, stored: false };
  }
  return { write: true, stored: true };
}

/**
 * What a lookup at the provider means for a step: use the payment found; create one when an
 * earlier call's attempt has none at the provider, or when the attempt is new; and refuse when a
 * payment id Ramble stored is gone from the provider, because making another would leave the
 * guest paying for a payment Ramble cannot match.
 */
export function lookupVerdict(
  step: ProviderStep,
  found: boolean,
): 'use' | 'create' | 'refuse' {
  if (found) return 'use';
  return step.step === 'retrieve' ? 'refuse' : 'create';
}

/** Only a payment the attempt did not already hold is written to it. */
export function storesPayment(step: ProviderStep): boolean {
  return step.step !== 'retrieve';
}

/** The newsletter consent a checkout records: a grant, only when the box was ticked. */
export function newsletterConsent(guestId: string, optIn: boolean) {
  return optIn
    ? {
        guestId,
        kind: 'newsletter' as const,
        status: 'granted' as const,
        source: 'checkout' as const,
      }
    : null;
}
