import {
  orderFanOut,
  type CancelSessionResult,
  type SessionCancelReason,
} from './cancelSession';
import { hostSessionProblemMessages } from './hostSessions';
import { isOpenHold, openHeldSeats, type HoldTimes } from './holds';
import { formatMoney } from './money';
import {
  formHas,
  invalidFormNotice,
  formText,
  parseIdField,
  type FormGetter,
  type FormResult,
  type NoticeText,
} from './opsForm';
import { refundableAttempt, planRefund, type RefundableOrder } from './refunds';
import {
  isUpcoming,
  sessionStatusLabels,
  type sessionStatuses,
} from './sessions';
import { parseStatusParam, type StatusTone } from './statusBadge';
import { countLabel } from './text';
import { zonedDeadlineLabel } from './zonedLabels';

// Ops session management (PRD-28, PRD-33, PRD-51): finding sessions, the guest impact of a
// cancellation shown before it, and the form that cancels. What cancelling does lives in
// `cancelSession.ts`; this file decides what the preview says and when the form is refused.

export const opsSessionsPath = '/ops/sessions';
export const opsSessionsPageSize = 25;

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

/** What the forms carry back so the server can tell the impact they read from the impact now: the refunds (count and sum), the unpaid orders, the held seats, and the blocked bookings. */
export function impactFingerprint(impact: Impact): string {
  const refundSum = impact.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
  return [
    impact.refunds.length,
    refundSum,
    impact.unpaidCount,
    impact.heldSeats,
    impact.blocked.length,
  ].join(':');
}

const fingerprintPattern = /^\d{1,15}(?::\d{1,15}){4}$/;

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
  const total = impact.refunds.reduce((sum, r) => sum + r.amountMinor, 0);
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
};

export function buildOpsSessionView(
  record: SessionDetailRecord,
  now: Date,
  impact: Impact,
): OpsSessionView {
  const whenLabel = zonedDeadlineLabel(record.startsAt, record.timeZone);
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
    canCancel:
      record.status === 'scheduled' &&
      cancelGate(record, now) === 'ok' &&
      !cancelBlocked(impact),
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

/** The cancel form: a session, a reason, the impact that was read, and the box ticked to say so. Nothing is repaired. */
export function parseCancelForm(get: FormGetter): FormResult<OpsCancelInput> {
  const sessionId = parseIdField(get('sessionId'));
  const reason = opsCancelReasons.find((r) => r === formText(get, 'reason'));
  const fingerprint = formText(get, 'fingerprint');
  if (
    sessionId === null ||
    reason === undefined ||
    fingerprint === undefined ||
    !fingerprintPattern.test(fingerprint) ||
    !formHas(get, 'confirm')
  ) {
    return { ok: false };
  }
  return { ok: true, value: { sessionId, reason, fingerprint } };
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
