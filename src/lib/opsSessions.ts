import { z } from 'zod';
import {
  fanOutLimit,
  orderFanOut,
  type CancelSessionResult,
  type SessionCancelReason,
} from './cancelSession';
import { WriteIdSchema } from './catalog';
import { pauseActionFor } from './experiencePause';
import {
  hostSessionFormValues,
  hostSessionProblemMessages,
} from './hostSessions';
import { isOpenHold, openHeldSeats, type HoldTimes } from './holds';
import { formatMoney } from './money';
import {
  formHas,
  invalidFormNotice,
  formText,
  parseIdField,
  parseNotice,
  type FormGetter,
  type FormResult,
  type NoticeText,
} from './opsForm';
import { refundableAttempt, planRefund, type RefundableOrder } from './refunds';
import {
  isUpcoming,
  sessionStatusLabels,
  UpdateSessionAllocationInputSchema,
  type UpdateSessionAllocationInput,
  type sessionStatuses,
} from './sessions';
import { parseStatusParam, type StatusTone } from './statusBadge';
import { countLabel } from './text';
import { tableHref } from './tableQuery';
import { zonedDeadlineLabel } from './zonedLabels';

// Ops session management (PRD-28, PRD-33, PRD-51): finding sessions, the guest impact of a
// cancellation shown before it, and the form that cancels. What cancelling does lives in
// `cancelSession.ts`; this file decides what the preview says and when the form is refused.

export const opsSessionsPath = '/ops/sessions';
export const opsSessionsPageSize = 25;

/** The list cursor an address carries, lower-cased; none, or one that is no id (a hand-edited address), starts again from the first page. */
export function cursorFrom(raw: string | null | undefined): string | null {
  const parsed = WriteIdSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export function opsSessionPath(sessionId: string): string {
  return `${opsSessionsPath}/${sessionId}`;
}

const whenFilters = ['upcoming', 'past'] as const;
export type SessionWhen = (typeof whenFilters)[number];

export const sessionWhenOptions = [
  { value: 'upcoming', label: 'Upcoming' },
  { value: 'past', label: 'Past' },
] as const satisfies readonly { value: SessionWhen; label: string }[];

/** The filter the address names, or null (every session) for none, a repeated one, or one the list does not have. */
export function parseSessionWhen(
  raw: string | readonly string[] | undefined,
): SessionWhen | null {
  return parseStatusParam(raw, whenFilters, sessionWhenOptions);
}

/** Upcoming sessions run soonest first; past and unfiltered ones, latest first. */
export function sessionListDirection(when: SessionWhen | null): 'asc' | 'desc' {
  return when === 'upcoming' ? 'asc' : 'desc';
}

type SessionStatus = (typeof sessionStatuses)[number];

const sessionStatusTones = {
  scheduled: 'success',
  cancelled: 'danger',
  completed: 'neutral',
} as const satisfies Record<SessionStatus, StatusTone>;

type SessionHold = HoldTimes & { sessionId: string; seats: number };

/** The seats the open holds take, per session. A session with no open hold is not in the map. */
export function openHeldSeatsBySession(
  holds: readonly SessionHold[],
  at: Date,
): ReadonlyMap<string, number> {
  const seats = new Map<string, number>();
  for (const hold of holds) {
    if (isOpenHold(hold, at)) {
      seats.set(hold.sessionId, (seats.get(hold.sessionId) ?? 0) + hold.seats);
    }
  }
  return seats;
}

export type OpsSessionRecord = {
  id: string;
  experienceName: string;
  hostName: string;
  startsAt: Date;
  timeZone: string;
  allocation: number;
  seatsSold: number;
  heldSeats: number;
  status: SessionStatus;
};

export type OpsSessionRow = {
  id: string;
  href: string;
  whenLabel: string;
  experienceName: string;
  hostName: string;
  sold: number;
  held: number;
  capacity: number;
  statusLabel: string;
  statusTone: StatusTone;
};

export function buildOpsSessionRows(
  records: readonly OpsSessionRecord[],
): OpsSessionRow[] {
  return records.map((record) => ({
    id: record.id,
    href: opsSessionPath(record.id),
    whenLabel: zonedDeadlineLabel(record.startsAt, record.timeZone),
    experienceName: record.experienceName,
    hostName: record.hostName,
    sold: record.seatsSold,
    held: record.heldSeats,
    capacity: record.allocation,
    statusLabel: sessionStatusLabels[record.status],
    statusTone: sessionStatusTones[record.status],
  }));
}

/** What an order is, to the guest impact: its refund arithmetic, the payment attempts a refund goes back to, and the reference ops can read out. */
export type ImpactOrder = RefundableOrder & {
  reference: string;
  attempts: readonly { status: string; providerPaymentId: string | null }[];
};

type AttemptRow = {
  orderId: string;
  status: string;
  providerPaymentId: string | null;
};

/** The orders with the payment attempts each refund would go back to. */
export function impactOrders(
  orders: readonly (RefundableOrder & { id: string; reference: string })[],
  attempts: readonly AttemptRow[],
): ImpactOrder[] {
  const byOrder = new Map<string, AttemptRow[]>();
  for (const attempt of attempts) {
    byOrder.set(attempt.orderId, [
      ...(byOrder.get(attempt.orderId) ?? []),
      attempt,
    ]);
  }
  return orders.map((order) => ({
    ...order,
    attempts: byOrder.get(order.id) ?? [],
  }));
}

type BlockedReason = 'gift' | 'no_payment' | 'other';

const blockedReasonTexts = {
  gift: 'paid in part by a gift',
  no_payment: 'has no payment to send the money back to',
  other: 'cannot be refunded in full',
} as const satisfies Record<BlockedReason, string>;

/** The bookings and amounts that cancelling would touch, before any of it is written. */
export type Impact = {
  /** Confirmed bookings that would be cancelled and refunded in full. */
  refunds: { reference: string; amountMinor: number }[];
  /** Confirmed bookings the refund cannot send back in full: cancelling is refused while any exist. */
  blocked: { reference: string; reason: BlockedReason }[];
  /** Orders still waiting for payment, which would be voided. */
  unpaidCount: number;
  /** Holds the cancellation would release, and the seats the open ones take. */
  openHolds: number;
  heldSeats: number;
};

/**
 * What cancelling a session does to its orders and holds, by the same rules the cancellation runs:
 * a confirmed booking is refunded in full (planned the way the refund will be, and only when a
 * single succeeded payment can take the money back), an unpaid order is voided, every other order
 * is left alone.
 */
export function sessionImpact(
  orders: readonly ImpactOrder[],
  holds: readonly (HoldTimes & { seats: number })[],
  at: Date,
): Impact {
  const impact: Impact = {
    refunds: [],
    blocked: [],
    unpaidCount: 0,
    openHolds: holds.length,
    heldSeats: openHeldSeats(holds, at),
  };
  for (const order of orders) {
    switch (orderFanOut(order.status)) {
      case 'refund': {
        if (refundableAttempt(order.attempts) === null) {
          impact.blocked.push({
            reference: order.reference,
            reason: 'no_payment',
          });
          break;
        }
        const plan = planRefund(order, 'remaining');
        if (plan.status === 'planned') {
          impact.refunds.push({
            reference: order.reference,
            amountMinor: plan.split.amountMinor,
          });
        } else {
          impact.blocked.push({
            reference: order.reference,
            reason: plan.reason === 'exceeds_card_payment' ? 'gift' : 'other',
          });
        }
        break;
      }
      case 'void':
        impact.unpaidCount += 1;
        break;
      case 'leave':
        break;
    }
  }
  return impact;
}

/** Cancelling is refused while a booking cannot be refunded in full: the cancellation would roll back whole. */
export function cancelBlocked(impact: Impact): boolean {
  return impact.blocked.length > 0;
}

const refundTotalMinor = (impact: Impact) =>
  impact.refunds.reduce((sum, r) => sum + r.amountMinor, 0);

/** What the forms carry back so the server can tell the impact they read from the impact now: everything the page shows (the refunds' count and sum, the unpaid orders, the holds and the seats they hold) and the blocked bookings. */
function impactFingerprint(impact: Impact): string {
  return [
    impact.refunds.length,
    refundTotalMinor(impact),
    impact.unpaidCount,
    impact.heldSeats,
    impact.openHolds,
    impact.blocked.length,
  ].join(':');
}

/** The impact a form was shown, as `impactFingerprint` wrote it: six counts and amounts joined by colons. The pattern has no nested repeat, so it is linear. */
export const ImpactFingerprintSchema = z
  .string()
  .max(100)
  .regex(/^\d{1,15}(?::\d{1,15}){5}$/);

/** The bookings listed one by one; the rest are counted. */
const impactListLimit = 50;

export type ImpactView = {
  summary: string;
  bookings: { reference: string; amountLabel: string }[];
  moreLabel: string | null;
  blockedText: string | null;
  fingerprint: string;
};

export function impactView(impact: Impact): ImpactView {
  const total = refundTotalMinor(impact);
  const parts = [
    `${countLabel(impact.refunds.length, 'booking')} refunded in full, ${formatMoney(total)} in all`,
    `${countLabel(impact.unpaidCount, 'unpaid order')} voided`,
    `${countLabel(impact.openHolds, 'hold')} released`,
  ];
  const shown = impact.refunds.slice(0, impactListLimit);
  const more = impact.refunds.length - shown.length;
  return {
    summary: `${parts.join('; ')}.`,
    bookings: shown.map((r) => ({
      reference: r.reference,
      amountLabel: formatMoney(r.amountMinor),
    })),
    moreLabel: more > 0 ? `and ${String(more)} more` : null,
    blockedText: cancelBlocked(impact)
      ? `This cannot be cancelled here: ${impact.blocked
          .map((b) => `${b.reference} ${blockedReasonTexts[b.reason]}`)
          .join('; ')}.`
      : null,
    fingerprint: impactFingerprint(impact),
  };
}

/** The impact the form showed is still the impact now. */
export function impactIsCurrent(shown: string, impact: Impact): boolean {
  return shown === impactFingerprint(impact);
}

export type SessionDetailRecord = {
  id: string;
  experienceId: string;
  experienceName: string;
  hostName: string;
  startsAt: Date;
  timeZone: string;
  allocation: number;
  seatsSold: number;
  heldSeats: number;
  status: SessionStatus;
  version: number;
};

/** A session that has started, or starts now, is over for cancelling. */
export function cancelGate(
  session: { startsAt: Date },
  now: Date,
): 'ok' | 'ended' {
  return isUpcoming(session.startsAt, now) ? 'ok' : 'ended';
}

export type OpsSessionView = {
  id: string;
  title: string;
  whenLabel: string;
  hostName: string;
  experienceName: string;
  experienceId: string;
  statusLabel: string;
  statusTone: StatusTone;
  seatsLabel: string;
  /** The session can be cancelled: not started, and no booking blocks it. */
  canCancel: boolean;
  /** A scheduled session that has not started: the only kind whose capacity is changed. */
  canEditCapacity: boolean;
  capacity: number;
  /** The lowest capacity the server accepts: the seats sold plus the seats held. */
  minCapacity: number;
  capacityHint: string;
  /** The version the editor read, posted back so a second edit cannot overwrite a first unseen. */
  version: number;
};

export function buildOpsSessionView(
  record: SessionDetailRecord,
  now: Date,
  impact: Impact,
): OpsSessionView {
  const whenLabel = zonedDeadlineLabel(record.startsAt, record.timeZone);
  const open =
    record.status === 'scheduled' && cancelGate(record, now) === 'ok';
  const minCapacity = record.seatsSold + record.heldSeats;
  return {
    id: record.id,
    title: `${record.experienceName}, ${whenLabel}`,
    whenLabel,
    hostName: record.hostName,
    experienceName: record.experienceName,
    experienceId: record.experienceId,
    statusLabel: sessionStatusLabels[record.status],
    statusTone: sessionStatusTones[record.status],
    seatsLabel: `${String(record.seatsSold)} sold, ${String(record.heldSeats)} held, ${String(record.allocation)} capacity`,
    canCancel: open && !cancelBlocked(impact),
    canEditCapacity: open,
    capacity: record.allocation,
    minCapacity,
    capacityHint: `At least ${String(minCapacity)}, the seats sold and held.`,
    version: record.version,
  };
}

/** The reasons ops cancels for: Ramble's own, or the weather. A host's own cancellation is the host's to make. */
const opsCancelReasons = [
  'ramble',
  'weather',
] as const satisfies readonly SessionCancelReason[];

export const opsCancelReasonOptions = [
  { value: 'ramble', label: 'Ramble cancelled it' },
  { value: 'weather', label: 'Weather' },
] as const satisfies readonly { value: SessionCancelReason; label: string }[];

export type OpsCancelInput = {
  sessionId: string;
  reason: (typeof opsCancelReasons)[number];
  /** The impact the person read, as `impactFingerprint` wrote it into the form. */
  fingerprint: string;
};

export type ImpactFormInput = Pick<OpsCancelInput, 'sessionId' | 'fingerprint'>;

/** What the cancel and pause forms share: the session, the impact that was read, and the box ticked to say so. Nothing is repaired. */
function parseImpactForm(get: FormGetter): ImpactFormInput | null {
  const sessionId = parseIdField(get('sessionId'));
  const fingerprint = ImpactFingerprintSchema.safeParse(
    formText(get, 'fingerprint'),
  );
  if (sessionId === null || !fingerprint.success || !formHas(get, 'confirm')) {
    return null;
  }
  return { sessionId, fingerprint: fingerprint.data };
}

/** The cancel form: the impact form and a reason ops may give. */
export function parseCancelForm(get: FormGetter): FormResult<OpsCancelInput> {
  const impact = parseImpactForm(get);
  const reason = opsCancelReasons.find((r) => r === formText(get, 'reason'));
  return impact === null || reason === undefined
    ? { ok: false }
    : { ok: true, value: { ...impact, reason } };
}

/** The pause form: the impact form alone. */
export function parsePauseForm(get: FormGetter): FormResult<ImpactFormInput> {
  const impact = parseImpactForm(get);
  return impact === null ? { ok: false } : { ok: true, value: impact };
}

/** The capacity form, read the way the host's is. */
export function parseAllocationForm(
  get: FormGetter,
): FormResult<UpdateSessionAllocationInput> {
  const parsed = UpdateSessionAllocationInputSchema.safeParse(
    hostSessionFormValues.capacity(get),
  );
  return parsed.success ? { ok: true, value: parsed.data } : { ok: false };
}

export const opsSessionNoticeCodes = [
  'cancelled',
  'cancelled_payments_left',
  'already_cancelled',
  'completed',
  'not_found',
  'blocked',
  'stale',
  'in_the_past',
  'allocation_saved',
  'version_conflict',
  'not_scheduled',
  'below_sold_and_held',
  'paused',
  'paused_some_left',
  'pause_incomplete',
  'not_pausable',
  'invalid',
] as const;
export type OpsSessionNoticeCode = (typeof opsSessionNoticeCodes)[number];

export const opsSessionNotices = {
  cancelled: {
    tone: 'success',
    title:
      'Session cancelled. Its bookings are refunded and its guests emailed.',
  },
  cancelled_payments_left: {
    tone: 'info',
    title:
      'Session cancelled. A payment still in progress will be refunded when it lands.',
  },
  already_cancelled: {
    tone: 'info',
    title: 'That session was already cancelled; anything left over was tidied.',
  },
  completed: {
    tone: 'warning',
    title: 'That session has already taken place.',
  },
  not_found: {
    tone: 'warning',
    title: hostSessionProblemMessages.session_not_found,
  },
  blocked: {
    tone: 'danger',
    title:
      'Nothing was cancelled: a booking cannot be refunded in full here. The session page names it.',
  },
  stale: {
    tone: 'warning',
    title:
      'This changed since you read it, so nothing was cancelled. Read who it affects again.',
  },
  in_the_past: {
    tone: 'warning',
    title: hostSessionProblemMessages.in_the_past,
  },
  allocation_saved: { tone: 'success', title: 'Capacity saved.' },
  version_conflict: {
    tone: 'warning',
    title: hostSessionProblemMessages.version_conflict,
  },
  not_scheduled: {
    tone: 'warning',
    title: hostSessionProblemMessages.not_scheduled,
  },
  below_sold_and_held: {
    tone: 'warning',
    title: hostSessionProblemMessages.below_sold_and_held,
  },
  paused: {
    tone: 'success',
    title:
      'Experience paused. Its future booked sessions are cancelled and refunded.',
  },
  paused_some_left: {
    tone: 'warning',
    title:
      'Experience paused. Some sessions could not be cancelled here; the page names them.',
  },
  pause_incomplete: {
    tone: 'danger',
    title:
      'Experience paused, but something went wrong on our side before every session was cancelled. Use the button to cancel the rest.',
  },
  not_pausable: {
    tone: 'warning',
    title:
      'Only an experience guests can see, or one already paused, is paused here.',
  },
  invalid: invalidFormNotice,
} as const satisfies Record<OpsSessionNoticeCode, NoticeText>;

/** What asking to cancel came to: refused before anything was written, or handed to `cancelSession`. */
export type OpsCancelOutcome =
  | { kind: 'blocked' | 'stale' | 'ended' }
  | { kind: 'done'; result: CancelSessionResult };

/** The notice an outcome names. */
export function cancelOutcomeNotice(
  outcome: OpsCancelOutcome,
): OpsSessionNoticeCode {
  switch (outcome.kind) {
    case 'blocked':
    case 'stale':
      return outcome.kind;
    case 'ended':
      return 'in_the_past';
    case 'done':
      return cancelNotice(outcome.result);
  }
}

function cancelNotice(result: CancelSessionResult): OpsSessionNoticeCode {
  switch (result.status) {
    case 'cancelled':
      return result.attemptsLeft > 0 ? 'cancelled_payments_left' : 'cancelled';
    case 'already_cancelled':
      return 'already_cancelled';
    case 'completed':
      return 'completed';
    case 'not_found':
      return 'not_found';
  }
}

const allocationRefusalNotices = {
  session_not_found: 'not_found',
  not_scheduled: 'not_scheduled',
  version_conflict: 'version_conflict',
  in_the_past: 'in_the_past',
  below_sold_and_held: 'below_sold_and_held',
} as const satisfies Record<string, OpsSessionNoticeCode>;

/** The notice a capacity change's result names. */
export function allocationNotice(
  result:
    { ok: true } | { ok: false; reason: keyof typeof allocationRefusalNotices },
): OpsSessionNoticeCode {
  return result.ok
    ? 'allocation_saved'
    : allocationRefusalNotices[result.reason];
}

type SessionStub = {
  id: string;
  startsAt: Date;
  status: SessionStatus;
  seatsSold: number;
  heldSeats: number;
};

/** A future scheduled session guests have a claim on (seats sold, or seats held mid-booking) is one the pause cancels. */
export function pauseCancelTargets<T extends SessionStub>(
  sessions: readonly T[],
  now: Date,
): T[] {
  return sessions.filter(
    (session) =>
      session.status === 'scheduled' &&
      isUpcoming(session.startsAt, now) &&
      (session.seatsSold > 0 || session.heldSeats > 0),
  );
}

export type PausePlan = 'pause' | 'finish' | 'not_pausable';

/** An experience guests can see is paused; a paused one is walked again (a repeat after a failure finishes the cancelling); any other has nothing to pause. */
export function pausePlanFor(
  status: Parameters<typeof pauseActionFor>[0],
): PausePlan {
  switch (pauseActionFor(status)) {
    case 'pause':
      return 'pause';
    case 'unpause':
      return 'finish';
    case null:
      return 'not_pausable';
  }
}

export type PauseView = {
  explainer: string;
  sessionsLabel: string;
  buttonLabel: string;
  impact: ImpactView;
  canPause: boolean;
};

/** What the pause section says and offers, or null when the experience has nothing to pause. */
export function pauseView(input: {
  experienceName: string;
  plan: PausePlan;
  targetCount: number;
  impact: Impact;
}): PauseView | null {
  const { plan, targetCount, impact } = input;
  // Nothing to pause, and on a paused experience nothing left to cancel: no panel.
  if (plan === 'not_pausable' || (plan === 'finish' && targetCount === 0)) {
    return null;
  }
  const sessions = countLabel(targetCount, 'future session');
  return plan === 'pause'
    ? {
        explainer: `Hides ${input.experienceName} from guests, then cancels its future sessions that have guests and refunds their bookings.`,
        sessionsLabel: `${sessions} with guests on them would be cancelled.`,
        buttonLabel: 'Pause experience and cancel its sessions',
        impact: impactView(impact),
        canPause: !cancelBlocked(impact),
      }
    : {
        explainer: `${input.experienceName} is paused. Some of its future sessions with guests are still scheduled.`,
        sessionsLabel: `${sessions} with guests on them still to cancel.`,
        buttonLabel: 'Cancel the remaining sessions',
        impact: impactView(impact),
        canPause: targetCount > 0,
      };
}

/**
 * What pausing came to. Of the `total` sessions it walked: `cancelled` were cancelled by this run,
 * `alreadyCancelled` had been cancelled by someone else meanwhile (not a failure, and not this
 * run's doing), and `left` are still scheduled (a booking blocks them, or the session was gone or
 * over). `incomplete` is a failure part-way.
 */
export type PauseOutcome =
  | { status: 'not_found' | 'not_pausable' | 'blocked' | 'stale' }
  | ({ status: 'paused' } & PauseTally)
  /** `total` is null when the failure came before the number of sessions was known. */
  | { status: 'incomplete'; cancelled: number; total: number | null };

export type PauseTally = {
  cancelled: number;
  alreadyCancelled: number;
  left: number;
  total: number;
};

/** One session of the pause walk: skipped because a booking on it cannot be refunded in full, or `cancelSession`'s answer. */
export type PauseStep =
  { kind: 'skipped' } | { kind: 'result'; result: CancelSessionResult };

/** On a paused experience a session whose booking cannot be refunded in full is skipped and reported, never a reason to strand the others. */
export function shouldCancelTarget(impact: Impact): boolean {
  return !cancelBlocked(impact);
}

/**
 * Tallies the walk, every step into exactly one count: a cancellation this run made is
 * `cancelled`; one already made is `alreadyCancelled`; a skipped session, and any other answer
 * (the session is over, or gone), is `left`, so the outcome never reads as complete over a
 * session that was passed by.
 */
export function tallyPauseResults(steps: readonly PauseStep[]): PauseTally {
  const tally: PauseTally = {
    cancelled: 0,
    alreadyCancelled: 0,
    left: 0,
    total: steps.length,
  };
  for (const step of steps) {
    if (step.kind === 'skipped') {
      tally.left += 1;
    } else if (step.result.status === 'cancelled') {
      tally.cancelled += 1;
    } else if (step.result.status === 'already_cancelled') {
      tally.alreadyCancelled += 1;
    } else {
      tally.left += 1;
    }
  }
  return tally;
}

/** Thrown when a session's cancellation fails part-way through the pause: the experience is paused, and the sessions cancelled so far stay cancelled. */
export class PauseIncompleteError extends Error {
  constructor(
    readonly cancelled: number,
    readonly total: number | null,
    cause: unknown,
  ) {
    super('The pause stopped before every session was cancelled', { cause });
  }
}

const progressCodes = ['paused_some_left', 'pause_incomplete'] as const;

/** Where the pause sends the person: the session's page, with the notice, and for a progress notice the counts. */
export function pauseOutcomeHref(path: string, outcome: PauseOutcome): string {
  switch (outcome.status) {
    case 'paused':
      return tableHref(path, {
        notice: outcome.left > 0 ? 'paused_some_left' : 'paused',
        done: String(outcome.cancelled),
        of: String(outcome.total),
        ...(outcome.alreadyCancelled > 0
          ? { already: String(outcome.alreadyCancelled) }
          : {}),
      });
    case 'incomplete':
      return outcome.total === null
        ? tableHref(path, { notice: 'pause_incomplete' })
        : tableHref(path, {
            notice: 'pause_incomplete',
            done: String(outcome.cancelled),
            of: String(outcome.total),
          });
    default:
      return tableHref(path, { notice: outcome.status });
  }
}

const countText = z
  .string()
  .regex(/^\d{1,5}$/)
  .transform((text) => Math.min(Number(text), fanOutLimit));

/** The counts a progress notice carries: how many sessions were cancelled, of how many, and how many were already cancelled. Digits only, clamped to what a pause can walk, and no part more than the whole. */
const ProgressCountsSchema = z
  .object({ done: countText, of: countText, already: countText.optional() })
  .refine((counts) => counts.done + (counts.already ?? 0) <= counts.of);

/** The notice the address names. A progress notice says how many of the sessions were cancelled when the address carries both counts. */
export function sessionNotice(query: {
  notice?: string | readonly string[] | undefined;
  done?: string | readonly string[] | undefined;
  of?: string | readonly string[] | undefined;
  already?: string | readonly string[] | undefined;
}): NoticeText | null {
  const code = parseNotice(query.notice, opsSessionNoticeCodes);
  if (code === null) return null;
  const counts = ProgressCountsSchema.safeParse({
    done: query.done,
    of: query.of,
    already: query.already,
  });
  if (!counts.success || !progressCodes.some((c) => c === code)) {
    return opsSessionNotices[code];
  }
  const { done, of, already = 0 } = counts.data;
  const { tone, title } = opsSessionNotices[code];
  const alreadyText =
    already > 0 ? `, ${String(already)} already cancelled` : '';
  return {
    tone,
    title: `${String(done)} of ${countLabel(of, 'session')} cancelled${alreadyText}. ${title}`,
  };
}
