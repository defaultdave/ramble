import type { ReserveResult, SessionSummary } from './holds';
import { spacesLabel } from './spaces';
import { venueTimeZone } from './venue';
import { zonedShortDayLabel, zonedTimeLabel } from './zonedLabels';

// What the booking choices say and do with each answer of `reserveSpaces` (S4, S5, PRD-17, PRD-21).
// The browser loads this file, so it imports types only from the hold rules: that module pulls in Zod,
// which Chromium reports as a CSP violation on every guest page (see `botChallenge.ts`).

type NoticeTone = 'info' | 'warning' | 'danger';

export type BookingNotice = {
  tone: NoticeTone;
  title: string;
  body: string;
  /** Offer the link to similar experiences: there is nowhere else to go from here. */
  similar: boolean;
};

/** What the page does with an answer. */
export type ReserveEffect =
  | { kind: 'held'; href: string }
  /** Ops paused bookings: the bar, sheet, and panel switch to their paused state. */
  | { kind: 'paused' }
  | {
      kind: 'notice';
      notice: BookingNotice;
      /** The session the guest tried can no longer be booked, so it is struck from the choices. */
      closeSession: boolean;
      /** Other dates with room for the party (S5), to offer in place of the one that sold out. */
      alternatives: SessionSummary[];
    };

type OutcomeContext = {
  /** `/checkout/`, passed in because the route builder imports Zod. */
  checkoutBase: string;
  maxSeats: number;
};

type NoticeOptions = {
  closeSession?: boolean;
  alternatives?: SessionSummary[];
  similar?: boolean;
};

const notice = (
  tone: NoticeTone,
  title: string,
  body: string,
  {
    closeSession = false,
    alternatives = [],
    similar = false,
  }: NoticeOptions = {},
): ReserveEffect => ({
  kind: 'notice',
  notice: { tone, title, body, similar },
  closeSession,
  alternatives,
});

/** Nothing was held and the guest was told nothing specific: the action threw, or answered a shape this page never sends. */
export const somethingWentWrong: ReserveEffect = notice(
  'danger',
  'Something went wrong',
  "We couldn't place your hold, and nothing was held. Try again in a moment.",
);

function soldOutEffect(alternatives: SessionSummary[]): ReserveEffect {
  return notice(
    'warning',
    'Those spaces just sold out',
    alternatives.length > 0
      ? 'Someone booked them before you. These other dates have room for your party.'
      : 'Someone booked them before you, and no other date in the next two weeks has room for your party. Try fewer guests, or see similar experiences.',
    { closeSession: true, alternatives, similar: alternatives.length === 0 },
  );
}

function blockedEffect(
  reason: 'device_limit' | 'too_many_holds',
  until: string | undefined,
  maxSeats: number,
): ReserveEffect {
  if (reason === 'device_limit') {
    return notice(
      'warning',
      "You're holding as many spaces as one device can",
      `One device can hold up to ${String(maxSeats)} spaces at once. Finish booking the spaces you hold, wait for that hold to run out, or choose a smaller party.`,
    );
  }
  if (until === undefined) {
    return notice(
      'warning',
      "We couldn't place your hold",
      'The request looked automated, so we stopped it. Try again in a moment. If it keeps happening, contact us.',
    );
  }
  const at = zonedTimeLabel(new Date(until), venueTimeZone);
  return notice(
    'warning',
    'Please wait a little',
    `You've started, or let lapse, several holds in a short time. You can try again at ${at}.`,
  );
}

function unavailableEffect(
  reason: Extract<ReserveResult, { status: 'unavailable' }>['reason'],
): ReserveEffect {
  switch (reason) {
    case 'bookings_paused':
      return { kind: 'paused' };
    case 'session_cancelled':
      return notice(
        'warning',
        'That session was cancelled',
        'Pick another date and time.',
        { closeSession: true },
      );
    case 'past':
      return notice(
        'warning',
        'That session has already started',
        'Pick a later date and time.',
        { closeSession: true },
      );
    case 'gift_not_valid':
      return somethingWentWrong;
  }
}

function invalidEffect(
  fieldErrors: Extract<ReserveResult, { status: 'invalid' }>['fieldErrors'],
  maxSeats: number,
): ReserveEffect {
  if ('sessionId' in fieldErrors) {
    return notice(
      'warning',
      "That date isn't available any more",
      'Pick another date and time.',
      { closeSession: true },
    );
  }
  if (fieldErrors.items === 'party_size') {
    return notice(
      'warning',
      "That party size isn't available",
      `One booking takes 1 to ${String(maxSeats)} guests.`,
    );
  }
  if (fieldErrors.items === 'not_offered') {
    return notice(
      'warning',
      'The prices changed',
      'Reload the page to see the current prices, then try again.',
    );
  }
  return somethingWentWrong;
}

/** The effect of an answer: where to go, or what to tell the guest. Exhaustive over the contract's statuses. */
export function describeReserve(
  result: ReserveResult,
  context: OutcomeContext,
): ReserveEffect {
  switch (result.status) {
    case 'held':
      return { kind: 'held', href: `${context.checkoutBase}${result.holdId}` };
    case 'sold_out':
      return soldOutEffect(result.alternatives);
    case 'blocked':
      return blockedEffect(result.reason, result.until, context.maxSeats);
    case 'unavailable':
      return unavailableEffect(result.reason);
    case 'invalid':
      return invalidEffect(result.fieldErrors, context.maxSeats);
  }
}

/** One alternative as a button label: "Sat, Nov 7 · 2:00 PM EST · 6 spaces". */
export function alternativeLabel(summary: SessionSummary): string {
  const start = new Date(summary.startsAt);
  return `${zonedShortDayLabel(start, summary.timeZone)} · ${zonedTimeLabel(start, summary.timeZone)} · ${spacesLabel(summary.spacesLeft)}`;
}
