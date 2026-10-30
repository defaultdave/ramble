import { z } from 'zod';
import { WriteIdSchema } from '../catalog';
import type { FieldErrors, StartPaymentResult } from '../checkout';
import type { CheckoutView } from './checkoutPage';
import {
  experiencePath,
  orderConfirmationPath,
  reheldCheckoutPath,
} from '../routes';
import type {
  ReserveResult,
  ReserveSpacesInput,
  SessionSummary,
} from '../holds';
import { spacesLabel } from '../spaces';
import { calendarDateFormat } from '../time';
import { zonedClockLabel, zonedShortDayLabel } from '../zonedLabels';

// Where the guest is on the checkout page, and what each step says. `startPayment` is called only
// from the guest's own tap on the continue button, never on load, so a refresh spends no try.

export type Payment = {
  id: string;
  clientSecret: string;
};

export type CheckoutStep =
  | {
      step: 'details';
      errors: FieldErrors;
      sending: boolean;
      notice: string | null;
    }
  | {
      step: 'payment';
      payment: Payment;
      amountDueMinor: number;
      reference: string;
      orderToken: string | undefined;
      lost: boolean;
    }
  | {
      step: 'expired';
      /** Known once `startPayment` has answered; null when the timer ran out first. */
      canRehold: boolean | null;
      spacesLeft: number | null;
      reholding: boolean;
      /** True once the lapsed hold has been released: holding it again from this page cannot work. */
      released: boolean;
      notice: string | null;
    }
  | { step: 'sold_out'; alternatives: SessionSummary[] }
  | { step: 'too_many_tries' };

const secretMarker = '_secret_';

/**
 * The payment a client secret opens. The provider's secret is its payment id, then `_secret_`,
 * then the secret part; a value that is not that shape names no payment and is refused.
 */
export function paymentFromSecret(clientSecret: string): Payment | null {
  const at = clientSecret.indexOf(secretMarker);
  if (at < 1 || at + secretMarker.length >= clientSecret.length) return null;
  return { id: clientSecret.slice(0, at), clientSecret };
}

export const initialStep: Extract<CheckoutStep, { step: 'details' }> = {
  step: 'details',
  errors: {},
  sending: false,
  notice: null,
};

export type CheckoutEvent =
  | { type: 'sending' }
  | { type: 'errors'; errors: FieldErrors }
  | { type: 'answered'; result: StartPaymentResult }
  | { type: 'request_failed' }
  | { type: 'timer_ended' }
  | { type: 'reholding' }
  | { type: 'rehold_answered'; result: ReholdResult }
  | { type: 'connection_lost' };

export const connectionFailedNotice =
  "We couldn't reach Ramble. Check your connection and try again. You haven't been charged.";

/**
 * What the re-hold action answers: a `reserveSpaces` result, or one of two answers of its own.
 * `try_later` means the device's `reserve` tries were spent before anything was touched, and
 * `unreachable` that the answer never arrived. Neither has released the old hold, so a retry can
 * work. Any other refusal comes after the lapsed hold was released, and says so.
 */
export type ReholdResult =
  ReserveResult | { status: 'try_later' } | { status: 'unreachable' };

const heldAgainLater =
  'Your earlier hold has ended. Choose these spaces again on the experience page';

/** What a refused re-hold says, and whether pressing the button again can work. */
export function reholdOutcome(
  result: Exclude<ReholdResult, { status: 'held' | 'sold_out' }>,
): { notice: string; canRehold: boolean } {
  switch (result.status) {
    case 'try_later':
      return {
        notice:
          'You have held spaces several times in a row. Try again in a little while.',
        canRehold: true,
      };
    case 'unreachable':
      return {
        notice:
          "We couldn't reach Ramble. Check your connection and try again.",
        canRehold: true,
      };
    case 'blocked':
      return {
        notice:
          result.reason === 'device_limit'
            ? `You already hold the most spaces one person can. ${heldAgainLater} once another hold ends.`
            : `You have held spaces several times in a row, so we could not hold these again. ${heldAgainLater} in a little while.`,
        canRehold: false,
      };
    case 'unavailable':
      return {
        notice:
          result.reason === 'bookings_paused'
            ? `Bookings are paused for now. ${heldAgainLater} when they resume.`
            : `This session is no longer open for booking. ${heldAgainLater} to pick another date.`,
        canRehold: false,
      };
    case 'invalid':
      return {
        notice: `We couldn't hold those spaces again. ${heldAgainLater}.`,
        canRehold: false,
      };
  }
}

function afterAnswer(
  state: CheckoutStep,
  result: StartPaymentResult,
): CheckoutStep {
  switch (result.status) {
    case 'requires_payment': {
      const payment = paymentFromSecret(result.payment.clientSecret);
      if (payment === null) {
        return checkoutReducer(state, { type: 'request_failed' });
      }
      return {
        step: 'payment',
        payment,
        amountDueMinor: result.amountDueMinor,
        reference: result.reference,
        orderToken: result.orderToken,
        lost: false,
      };
    }
    case 'already_confirmed':
      return state;
    case 'hold_expired':
      return {
        step: 'expired',
        canRehold: result.canRehold,
        spacesLeft: result.spacesLeft,
        reholding: false,
        released: false,
        notice: null,
      };
    case 'sold_out':
      return { step: 'sold_out', alternatives: result.alternatives };
    case 'too_many_tries':
      return { step: 'too_many_tries' };
    case 'invalid':
      return {
        step: 'details',
        errors: result.fieldErrors,
        sending: false,
        notice: null,
      };
  }
}

export function checkoutReducer(
  state: CheckoutStep,
  event: CheckoutEvent,
): CheckoutStep {
  switch (event.type) {
    case 'sending':
      return state.step === 'details'
        ? { ...state, sending: true, notice: null }
        : state;
    case 'errors':
      return {
        step: 'details',
        errors: event.errors,
        sending: false,
        notice: null,
      };
    case 'answered':
      return afterAnswer(state, event.result);
    case 'request_failed':
      return {
        step: 'details',
        errors: {},
        sending: false,
        notice: connectionFailedNotice,
      };
    case 'timer_ended':
      // A guest who is paying keeps the form: the payment decides, and a late success is refunded
      // by the server (S10), never turned away mid-card.
      return state.step === 'details'
        ? {
            step: 'expired',
            canRehold: null,
            spacesLeft: null,
            reholding: false,
            released: false,
            notice: null,
          }
        : state;
    case 'reholding':
      return state.step === 'expired'
        ? { ...state, reholding: true, notice: null }
        : state;
    case 'rehold_answered':
      if (event.result.status === 'sold_out') {
        return { step: 'sold_out', alternatives: event.result.alternatives };
      }
      if (state.step !== 'expired' || event.result.status === 'held') {
        return state;
      }
      {
        const outcome = reholdOutcome(event.result);
        return {
          ...state,
          reholding: false,
          notice: outcome.notice,
          canRehold: outcome.canRehold ? state.canRehold : false,
          released: state.released || !outcome.canRehold,
        };
      }
    case 'connection_lost':
      return state.step === 'payment' ? { ...state, lost: true } : state;
  }
}

/** Where to go once a result ends the page: the confirmation, or the new hold's checkout. */
export function destination(
  result: StartPaymentResult | ReholdResult,
): string | null {
  if (result.status === 'already_confirmed') {
    return orderConfirmationPath(result.reference, result.orderToken);
  }
  if (result.status === 'held') return reheldCheckoutPath(result.holdId);
  return null;
}

/** What the browser sends to hold the same spaces again: only the lapsed hold's id (S6). */
export const ReholdInputSchema = z.object({ holdId: WriteIdSchema });
export type ReholdInput = z.input<typeof ReholdInputSchema>;

export function reholdRequest(view: Pick<CheckoutView, 'holdId'>): ReholdInput {
  return { holdId: view.holdId };
}

/** The party of a new hold on the same session, from the page's own read of the lapsed hold, never from the browser. */
export function partyReserveInput(
  view: Pick<CheckoutView, 'sessionId' | 'party'>,
): ReserveSpacesInput {
  return {
    sessionId: view.sessionId,
    items: view.party,
    purpose: 'booking',
  };
}

// ---- Copy ----

function whenLabel(view: Pick<CheckoutView, 'startsAt' | 'timeZone'>) {
  const at = new Date(view.startsAt);
  return `${zonedShortDayLabel(at, view.timeZone)} at ${zonedClockLabel(at, view.timeZone)}`;
}

/** S6: the hold ended. With the spaces still there it offers them back. */
export function expiredCopy(
  view: CheckoutView,
  step: Extract<CheckoutStep, { step: 'expired' }>,
  holdMinutes: number,
): { title: string; body: string; canRehold: boolean } {
  const released = `We released your spaces after ${String(holdMinutes)} minutes.`;
  if (step.released) {
    return { title: 'Your hold ended', body: released, canRehold: false };
  }
  if (step.canRehold === false) {
    return {
      title: 'Your hold ended',
      body: `${released} There is not room for your whole party at ${whenLabel(view)} now.`,
      canRehold: false,
    };
  }
  const spaces =
    step.spacesLeft === null
      ? ''
      : ` ${zonedClockLabel(new Date(view.startsAt), view.timeZone)} still has ${String(step.spacesLeft)} ${step.spacesLeft === 1 ? 'space' : 'spaces'}, so`;
  return {
    title: 'Your hold ended',
    body:
      spaces === ''
        ? `${released} You can hold them again and carry on, if they are still free.`
        : `${released}${spaces} you can hold them again and carry on.`,
    canRehold: true,
  };
}

/** S7: the hold lapsed and the spaces went. */
export function soldOutCopy(view: CheckoutView): {
  title: string;
  body: string;
  heading: string;
} {
  return {
    title: 'These spaces are gone',
    body: `Your hold ended and the last spaces for ${whenLabel(view)} sold. You haven't been charged. Choose another date and enter your details again.`,
    heading: `Other dates for ${view.guests === 1 ? '1 guest' : `${String(view.guests)} guests`}`,
  };
}

export const tooManyTriesCopy = {
  title: 'Too many tries',
  body: "You've tried to pay several times in the last hour. You haven't been charged. Wait a little while, then start again from the experience.",
};

export const maintenanceCopy = {
  title: 'Checkout is paused',
  body: "We're making a quick change to checkout. Nothing was charged. Please try again in a few minutes; your spaces stay held until the timer ends.",
};

export type AlternativeRow = {
  key: string;
  href: string;
  label: string;
  note: string;
  tone: 'few-left' | 'open';
};

/** One row of S7: the day and time, and how many spaces are left, linking to the experience on that day. */
export function alternativeRow(
  view: CheckoutView,
  alternative: SessionSummary,
): AlternativeRow {
  const at = new Date(alternative.startsAt);
  const day = calendarDateFormat(alternative.timeZone).format(at);
  const left = alternative.spacesLeft;
  return {
    key: alternative.sessionId,
    href: `${experiencePath(view.experience)}?date=${day}`,
    label: `${zonedShortDayLabel(at, alternative.timeZone)} · ${zonedClockLabel(at, alternative.timeZone)}`,
    note: spacesLabel(left),
    tone: left <= 3 ? 'few-left' : 'open',
  };
}

/** Whether the confirm step of the page's own form may be sent: one request at a time, details only. */
export function canSend(state: CheckoutStep): boolean {
  return state.step === 'details' && !state.sending;
}
