import { z } from 'zod';
import type { AlertTone } from './alertTone';
import { cancellationWindow } from './cancellation';
import {
  cancelQuote,
  isBookingRow,
  missingOrderResult,
  type CancelFacts,
} from './cancelBooking';
import {
  CapabilityTokenSchema,
  maxTokenVersion,
  type CapabilityTokenKind,
} from './capabilityTokens';
import type { CacheChange } from './cacheTags';
import { WriteIdSchema } from './catalog';
import { partyFits, reserveRefusal, type ReserveSubject } from './holds';
import { managePath } from './routes';
import { spacesLabel } from './spaces';
import {
  zonedDayLabel,
  zonedDeadlineLabel,
  zonedTimeLabel,
} from './zonedLabels';

// What moving a booking to another date decides (PRD-30). A move keeps the experience, the party,
// and every amount on the order: only the session changes, so there is nothing to charge or refund
// (price is per experience; a session has none). It is allowed while the booking could still be
// cancelled for a full refund, and only onto a date that could be too. The data layer locks and
// writes; the page and the action both ask these functions.

/** The most other dates the picker reads. */
export const moveChoiceLimit = 20;

const MoveBookingInputSchema = z.strictObject({
  manageToken: CapabilityTokenSchema,
  targetSessionId: WriteIdSchema,
});
export type MoveBookingInput = z.input<typeof MoveBookingInputSchema>;

/** What the data layer moves: the order the token opened, at the version it opened, onto the date chosen. */
export const MoveOrderInputSchema = z.strictObject({
  orderId: WriteIdSchema,
  openedTokenVersion: z.int().min(1).max(maxTokenVersion),
  targetSessionId: WriteIdSchema,
});

/** The job a move queues: ids only, so a job row holds no address or name. */
export const GuestMovePayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  /** Names this move, so a second move of the booking sends its own email. */
  moveId: z.uuid(),
});

/** The booking and the terms it was made under, read under the locks. */
export type MoveSubject = {
  facts: CancelFacts;
  sessionId: string;
  experienceId: string;
  experienceStatus: ReserveSubject['experienceStatus'];
  /** The booking's own cancellation tier, so the new date's deadline is made the way the old one was. */
  fullRefundHoursBefore: number;
};

/** A date the booking could move to, with the spaces left in it for the party. */
export type MoveTarget = {
  id: string;
  experienceId: string;
  status: ReserveSubject['sessionStatus'];
  startsAt: Date;
  timeZone: string;
  /** Allocation less the seats sold and the seats of open holds. */
  spacesLeft: number;
};

/**
 * Whether the booking can be moved now: exactly when cancelling it would refund it in full. A
 * cancelled or started booking, a closed window, a gift-paid order, and one with nothing left to
 * refund are all outside the terms, and say so by the cancel quote they already get.
 */
export function isMovable(facts: CancelFacts, now: Date): boolean {
  const quote = cancelQuote(facts, now);
  return quote.kind === 'cancellable' && quote.basis === 'full';
}

type TargetRefusal = 'same_date' | 'date_unavailable' | 'sold_out' | 'too_soon';

type TargetVerdict =
  | { kind: 'ok'; target: MoveTarget; freeCancelUntil: Date }
  | { kind: 'refused'; refusal: TargetRefusal };

/**
 * Whether the booking may move onto `target` at `now`. A date that is missing, of another
 * experience, cancelled, or already started is one answer (`date_unavailable`), so an id says
 * nothing about sessions it does not belong to. The new deadline is the booking's own tier before
 * the new start; a date already inside it would make a booking that cannot be cancelled.
 */
function moveTargetVerdict(input: {
  subject: MoveSubject;
  target: MoveTarget | null;
  now: Date;
}): TargetVerdict {
  const { subject, target, now } = input;
  const refuse = (refusal: TargetRefusal): TargetVerdict => ({
    kind: 'refused',
    refusal,
  });
  if (target === null) return refuse('date_unavailable');
  if (target.id === subject.sessionId) return refuse('same_date');
  if (target.experienceId !== subject.experienceId) {
    return refuse('date_unavailable');
  }
  if (
    reserveRefusal(
      {
        experienceStatus: subject.experienceStatus,
        sessionStatus: target.status,
        startsAt: target.startsAt,
      },
      now,
    ) !== null
  ) {
    return refuse('date_unavailable');
  }
  if (!partyFits(subject.facts.seats, target.spacesLeft)) {
    return refuse('sold_out');
  }
  const window = cancellationWindow(
    { fullRefundHoursBefore: subject.fullRefundHoursBefore },
    target.startsAt,
    now,
    target.timeZone,
  );
  return window.isFree
    ? { kind: 'ok', target, freeCancelUntil: window.freeCancelUntil }
    : refuse('too_soon');
}

export type MoveBookingResult =
  | { status: 'moved' }
  /** The booking is outside the terms: not active, started, past its free window, or paid with a gift. */
  | { status: 'not_movable' }
  | { status: 'same_date' }
  | { status: 'date_unavailable' }
  | { status: 'sold_out' }
  /** The chosen date starts inside the cancellation window, so it could not be cancelled for free. */
  | { status: 'too_soon' }
  /** A malformed token, a token that opens nothing, and a stale one all end here, alike. */
  | { status: 'not_found' }
  | { status: 'rate_limited'; retryAfterSeconds: number };

export type MovePlan =
  | {
      kind: 'proceed';
      fromSessionId: string;
      toSessionId: string;
      seats: number;
      freeCancelUntil: Date;
    }
  | { kind: 'stop'; result: MoveBookingResult };

/**
 * The one decision of the move action, made on the locked order: a token from before a bump opens
 * nothing; then whether the booking is still inside the terms; then the date chosen.
 */
export function movePlan(input: {
  subject: MoveSubject | null;
  target: MoveTarget | null;
  openedTokenVersion: number;
  now: Date;
}): MovePlan {
  const { subject, target, openedTokenVersion, now } = input;
  if (
    subject === null ||
    subject.facts.manageTokenVersion !== openedTokenVersion
  ) {
    return { kind: 'stop', result: missingOrderResult };
  }
  if (!isMovable(subject.facts, now)) {
    return { kind: 'stop', result: { status: 'not_movable' } };
  }
  const verdict = moveTargetVerdict({ subject, target, now });
  if (verdict.kind === 'refused') {
    return { kind: 'stop', result: { status: verdict.refusal } };
  }
  return {
    kind: 'proceed',
    fromSessionId: subject.sessionId,
    toSessionId: verdict.target.id,
    seats: subject.facts.seats,
    freeCancelUntil: verdict.freeCancelUntil,
  };
}

/**
 * Whether a move may start, from the kind of token it was opened with and the lock ids read for
 * its order: only a manage token moves, and only an order with a session and a hold behind it.
 * The sessions to lock are the booking's and the chosen date's, in id order, so two moves between
 * the same dates in opposite directions take the locks the same way round and cannot wait on each other.
 */
export function moveStart(input: {
  tokenKind: CapabilityTokenKind;
  ids: { sessionId: string | null; holdId: string | null } | null;
  targetSessionId: string;
}):
  | {
      kind: 'lock';
      sessionIds: string[];
      /** The session the order pointed at when the ids were read, to check against the locked order. */
      fromSessionId: string;
      holdId: string;
    }
  | { kind: 'stop'; result: MoveBookingResult } {
  const { ids } = input;
  if (input.tokenKind !== 'manage' || ids === null || !isBookingRow(ids)) {
    return { kind: 'stop', result: missingOrderResult };
  }
  return {
    kind: 'lock',
    sessionIds: [...new Set([ids.sessionId, input.targetSessionId])].sort(),
    fromSessionId: ids.sessionId,
    holdId: ids.holdId,
  };
}

/** The audit row of a move: ids and counts only. */
export function moveAuditEntry(input: {
  orderId: string;
  fromSessionId: string;
  toSessionId: string;
  seats: number;
}) {
  return {
    actorKind: 'guest',
    action: 'order.moved',
    subjectKind: 'order',
    subjectId: input.orderId,
    details: {
      from_session_id: input.fromSessionId,
      to_session_id: input.toSessionId,
      seats_moved: input.seats,
    },
  } as const;
}

/** Only a move that went through changes the spaces of either date. */
export function moveCacheChanges(plan: MovePlan): CacheChange[] {
  return plan.kind === 'proceed'
    ? [
        { kind: 'spaces', sessionId: plan.fromSessionId },
        { kind: 'spaces', sessionId: plan.toSessionId },
      ]
    : [];
}

/** The action's input, or the answer for input that cannot be one (not found: nothing says why). */
export function parseMoveInput(
  input: unknown,
):
  | { kind: 'ok'; input: z.output<typeof MoveBookingInputSchema> }
  | { kind: 'refused'; result: MoveBookingResult } {
  const parsed = MoveBookingInputSchema.safeParse(input);
  return parsed.success
    ? { kind: 'ok', input: parsed.data }
    : { kind: 'refused', result: missingOrderResult };
}

/** The form's two fields as the action's input. */
export function moveInputFromForm(fields: {
  manageToken: unknown;
  targetSessionId: unknown;
}): MoveBookingInput {
  const { manageToken, targetSessionId } = fields;
  return {
    manageToken: typeof manageToken === 'string' ? manageToken : '',
    targetSessionId: typeof targetSessionId === 'string' ? targetSessionId : '',
  };
}

// What the manage page says about moving.

export type MoveChoice = {
  sessionId: string;
  /** "Saturday, November 14, 2026 · 4:00 PM EST". */
  label: string;
  /** "6 spaces", "2 left". */
  spacesLabel: string;
};

/** The dates the booking can move to, soonest first as read: every one the verdict accepts. */
export function moveChoices(input: {
  subject: MoveSubject;
  candidates: readonly MoveTarget[];
  now: Date;
}): MoveChoice[] {
  return input.candidates.flatMap((target) =>
    moveTargetVerdict({ subject: input.subject, target, now: input.now })
      .kind === 'ok'
      ? [
          {
            sessionId: target.id,
            label: `${zonedDayLabel(target.startsAt, target.timeZone)} · ${zonedTimeLabel(target.startsAt, target.timeZone)}`,
            spacesLabel: spacesLabel(target.spacesLeft),
          },
        ]
      : [],
  );
}

export type MovePrompt = {
  heading: string;
  body: string;
  linkLabel: string;
  /** Null until the guest opens the second step. */
  picker: {
    legend: string;
    choices: MoveChoice[];
    emptyLine: string;
    note: string;
    submitLabel: string;
    keepLabel: string;
  } | null;
};

/** The offer on a movable booking, and its picker when the guest has opened it. */
export function movePrompt(input: {
  freeCancelUntil: Date | null;
  timeZone: string;
  /** Null when the picker is closed. */
  choices: MoveChoice[] | null;
}): MovePrompt {
  const deadline =
    input.freeCancelUntil === null
      ? null
      : zonedDeadlineLabel(input.freeCancelUntil, input.timeZone);
  return {
    heading: 'Need a different date?',
    body:
      deadline === null
        ? 'You can move this booking to another date of the same experience at the same price.'
        : `You can move this booking to another date of the same experience at the same price until ${deadline}.`,
    linkLabel: 'Move to another date',
    picker:
      input.choices === null
        ? null
        : {
            legend: 'Choose a new date',
            choices: input.choices,
            emptyLine:
              'No other dates have room for your group right now. Your booking stays as it is.',
            note: 'The price stays the same: nothing more to pay and nothing refunded.',
            submitLabel: 'Move my booking',
            keepLabel: 'Keep my current date',
          },
  };
}

const moveNoticeCodes = [
  'moved',
  'not_movable',
  'same_date',
  'date_unavailable',
  'sold_out',
  'too_soon',
] as const satisfies readonly MoveBookingResult['status'][];
export type MoveNoticeCode = (typeof moveNoticeCodes)[number];

type MoveNotice = { tone: AlertTone; title: string; body: string };

/** What the page says for an answer of the move action. */
export function moveNotice(code: MoveNoticeCode): MoveNotice {
  switch (code) {
    case 'moved':
      return {
        tone: 'success',
        title: 'Your booking is moved',
        body: 'You are booked for the new date, and we have emailed you the details. Nothing more to pay and nothing refunded.',
      };
    case 'not_movable':
      return {
        tone: 'info',
        title: "This booking can't be moved",
        body: 'Bookings can be moved while they can still be cancelled for a full refund. Contact us if you need help.',
      };
    case 'same_date':
      return {
        tone: 'info',
        title: 'That is the date you already have',
        body: 'Nothing was changed. Choose a different date to move.',
      };
    case 'date_unavailable':
      return {
        tone: 'warning',
        title: 'That date is no longer available',
        body: 'Nothing was changed. Choose another date.',
      };
    case 'sold_out':
      return {
        tone: 'warning',
        title: 'That date is full',
        body: 'There is no room there for your group. Nothing was changed. Choose another date.',
      };
    case 'too_soon':
      return {
        tone: 'warning',
        title: 'That date is too soon',
        body: "It starts inside the cancellation window, so it couldn't be cancelled for a refund. Nothing was changed. Choose a later date.",
      };
  }
}

export function isMoveNoticeCode(value: string): value is MoveNoticeCode {
  return (moveNoticeCodes as readonly string[]).includes(value);
}

/** The second step: the same page with the picker open. */
export function movePickerPath(token: string): string {
  return `${managePath(token)}?move=1`;
}

/**
 * Where a move lands the guest: the same page, with its answer in the query. The statuses a move
 * shares with a cancel (a link that opens nothing, a count used up) use the cancel's own parameter.
 */
export function moveResultPath(
  token: string,
  result: MoveBookingResult,
): string {
  return isMoveNoticeCode(result.status)
    ? `${managePath(token)}?moved=${result.status}`
    : `${managePath(token)}?result=${result.status}`;
}
