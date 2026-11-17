import { z } from 'zod';
import { CapabilityTokenSchema } from './capabilityTokens';
import { WriteIdSchema } from './catalog';
import { isOrderReference } from './orders';
import {
  fieldsFromIssues,
  formText,
  parseProblemFields,
  type FormGetter,
} from './opsForm';
import type { RateLimitDecision } from './rateLimits';
import { reviewPath } from './routes';
import { msPerDay, msPerHour } from './time';
import { oneLineClipped, requiredText, wholeNumberText } from './text';
import { zonedDayLabel } from './zonedLabels';

// Review collection (PRD-29). A verified booker is the contact on a confirmed booking whose session
// has ended; for a gift the booking is the recipient's own redemption, so the recipient is that
// contact. One review per order. Showing reviews and hiding them are not here.

export const reviewStatuses = ['visible', 'hidden'] as const;

export const reviewLimits = {
  minRating: 1,
  maxRating: 5,
  bodyMaxChars: 2000,
} as const;

/** How long after a session ends the invite goes out: time to get home, not so long the memory fades. */
export const reviewInviteDelayMs = 3 * msPerHour;

/** How long a session's guests can still review it. Past this the link says it has closed. */
export const reviewWindowMs = 90 * msPerDay;

/** The most invites one sweep queues, so a long outage catches up over several pulses and no pulse grows with the backlog. */
export const reviewInviteBatchSize = 200;

/** The job kind that sends one invite. */
export const reviewInviteKind = 'review-invite';

/** What every order's invite dedupe key starts with, for the sweep's query as well as `reviewInviteKey`. */
export const reviewInviteKeyPrefix = 'review-invite:';

/** Where a booking's invite becomes due: the delay after its session ends, or `now` when that has passed. */
export function reviewInviteRunAt(endsAt: Date, now: Date): Date {
  return new Date(
    Math.max(endsAt.getTime() + reviewInviteDelayMs, now.getTime()),
  );
}

/**
 * The sessions a sweep invites for, as the bounds of their end times: ended at least `delayMs` ago
 * (the invite delay unless told otherwise; 0 for sessions that have simply ended), and not so long
 * ago that the review window has closed. A WHERE clause reads these two dates and nothing else
 * about time.
 */
export function reviewInviteWindow(
  now: Date,
  delayMs: number = reviewInviteDelayMs,
): {
  endedBefore: Date;
  endedAfter: Date;
} {
  return {
    endedBefore: new Date(now.getTime() - delayMs),
    endedAfter: new Date(now.getTime() - reviewWindowMs),
  };
}

/** One invite email per order. */
export function reviewInviteKey(orderId: string): string {
  return `${reviewInviteKeyPrefix}${orderId.toLowerCase()}`;
}

/** One invite email per hand-sent invite, so a tester can send the same order's invite again. */
export function reviewInviteResendKey(sendId: string): string {
  return `review-invite-resend:${sendId.toLowerCase()}`;
}

/** The email key for the invite a job sends: the order's own, or the hand-sent invite's when the payload names one. */
export function reviewInviteEmailKey(payload: ReviewInvitePayload): string {
  return payload.sendId === undefined
    ? reviewInviteKey(payload.orderId)
    : reviewInviteResendKey(payload.sendId);
}

export const ReviewInvitePayloadSchema = z.strictObject({
  orderId: WriteIdSchema,
  /** Set by the test console, so a second hand-sent invite is a new email; the sweep leaves it out. */
  sendId: WriteIdSchema.optional(),
});
export type ReviewInvitePayload = z.output<typeof ReviewInvitePayloadSchema>;

/** What eligibility is judged on, read from one order, its session, and its review if any. */
export type ReviewFacts = {
  kind: 'booking' | 'gift_purchase';
  status: string;
  /** What the order has given back to the booker, ticket and tax, in minor units. */
  refundedTicketMinor: number;
  refundedTaxMinor: number;
  endsAt: Date;
  reviewed: boolean;
};

type ReviewRefusal =
  | 'not_a_booking'
  | 'not_confirmed'
  | 'refunded'
  | 'already_reviewed'
  | 'session_not_ended'
  | 'window_closed';

export type ReviewEligibility =
  { ok: true } | { ok: false; reason: ReviewRefusal };

/**
 * Whether the order's booker may review now. Only a confirmed booking counts (a gift purchase has
 * no session, a cancelled booking was not taken), and a booking that was refunded, in whole or in
 * part, does not (PRD-29: a paid, non-refunded booking). The session must have ended, nobody has
 * reviewed the order, and the window must still be open. The first rule that fails is the reason.
 */
export function reviewEligibility(
  facts: ReviewFacts,
  now: Date,
): ReviewEligibility {
  if (facts.kind !== 'booking') return { ok: false, reason: 'not_a_booking' };
  if (facts.status !== 'confirmed') {
    return { ok: false, reason: 'not_confirmed' };
  }
  if (facts.refundedTicketMinor + facts.refundedTaxMinor > 0) {
    return { ok: false, reason: 'refunded' };
  }
  if (facts.reviewed) return { ok: false, reason: 'already_reviewed' };
  if (facts.endsAt.getTime() > now.getTime()) {
    return { ok: false, reason: 'session_not_ended' };
  }
  if (now.getTime() > facts.endsAt.getTime() + reviewWindowMs) {
    return { ok: false, reason: 'window_closed' };
  }
  return { ok: true };
}

export type ReviewInviteDecision = 'send' | 'skip' | 'refuse';

/**
 * What the invite job does for its order. A job for something that is not a booking is a bug in
 * its caller (`refuse`: the job fails and alerts). A booking that was cancelled since, already
 * reviewed, or whose window has closed sends nothing (`skip`), and so does one whose session has
 * not ended when the job runs, because the invite would open a form that is not yet open.
 */
export function reviewInviteDecision(
  facts: ReviewFacts,
  now: Date,
): ReviewInviteDecision {
  const eligibility = reviewEligibility(facts, now);
  if (eligibility.ok) return 'send';
  return eligibility.reason === 'not_a_booking' ? 'refuse' : 'skip';
}

// ---- The review form ----

const reviewFormFields = ['rating', 'body'] as const;
export type ReviewFormField = (typeof reviewFormFields)[number];

const ReviewLinkSchema = z.object({
  reference: z.string().refine(isOrderReference),
  token: CapabilityTokenSchema,
});

const ReviewFieldsSchema = z.object({
  rating: wholeNumberText(reviewLimits.minRating, reviewLimits.maxRating),
  body: requiredText(reviewLimits.bodyMaxChars),
});

export type ReviewInput = {
  reference: string;
  token: string;
  rating: number;
  body: string;
};

export type ReviewFormParse =
  | { ok: true; value: ReviewInput }
  | { ok: false; reason: 'link' }
  | {
      ok: false;
      reason: 'fields';
      reference: string;
      token: string;
      fields: ReviewFormField[];
    };

/**
 * The review a posted form carries. A reference or token of the wrong shape is a bad link, which
 * is answered like any other (the page says the link does not work); a bad rating or body names
 * the fields to look at again. The body is trimmed, and its length is counted as Postgres counts it.
 */
export function parseReviewForm(get: FormGetter): ReviewFormParse {
  const link = ReviewLinkSchema.safeParse({
    reference: formText(get, 'reference'),
    token: formText(get, 'token'),
  });
  if (!link.success) return { ok: false, reason: 'link' };
  const fields = ReviewFieldsSchema.safeParse({
    rating: formText(get, 'rating'),
    body: formText(get, 'body'),
  });
  if (fields.success) {
    return { ok: true, value: { ...link.data, ...fields.data } };
  }
  return {
    ok: false,
    reason: 'fields',
    ...link.data,
    fields: fieldsFromIssues(fields.error.issues, reviewFormFields),
  };
}

// ---- What a submit comes to ----

export type ReviewSubmitStatus =
  | 'created'
  | 'invalid'
  | 'already_reviewed'
  | 'expired'
  | 'not_found'
  | 'rate_limited';

type ReviewRefused = Extract<ReviewEligibility, { ok: false }>;

/**
 * What a submit comes to when the booker may not review: a second review is `already_reviewed`, a
 * closed window is `expired`, and every other reason is `not_found`, so a link says nothing about
 * an order beyond what its holder is owed.
 */
export function reviewSubmitStatus(
  refusal: ReviewRefused,
): Exclude<ReviewSubmitStatus, 'created' | 'invalid' | 'rate_limited'> {
  switch (refusal.reason) {
    case 'already_reviewed':
      return 'already_reviewed';
    case 'window_closed':
      return 'expired';
    case 'not_a_booking':
    case 'not_confirmed':
    case 'refunded':
    case 'session_not_ended':
      return 'not_found';
    default:
      return refusal.reason satisfies never;
  }
}

/** Where a submit lands the booker: the same page, which reads the answer from the order and says `done` only for a review just made. */
export function reviewResultPath(
  reference: string,
  token: string,
  status: ReviewSubmitStatus,
): string {
  const path = reviewPath(reference, token);
  return status === 'created' ? `${path}?done=1` : path;
}

/** Where a form with a bad rating or body lands the booker: the form again, with the fields named. */
export function reviewProblemPath(
  reference: string,
  token: string,
  fields: readonly ReviewFormField[],
): string {
  return `${reviewPath(reference, token)}?problem=${fields.join(',')}`;
}

type ReviewQuery = {
  done?: string | string[] | undefined;
  problem?: string | string[] | undefined;
};

/** What the address says about the last submit: that it went through, or which fields to look at again. */
function parseReviewQuery(query: ReviewQuery): {
  done: boolean;
  problems: ReviewFormField[];
} {
  return {
    done: query.done === '1',
    problems: parseProblemFields(query.problem, reviewFormFields),
  };
}

/** What the gate in front of a review link decides: the order's id, or the one answer every refusal shares, or a wait. */
export type ReviewGate<Row> =
  | { kind: 'opened'; row: Row }
  | { kind: 'refused'; reason: 'invalid' }
  | { kind: 'refused'; reason: 'rate_limited'; retryAfterSeconds: number };

/**
 * The one gate in front of every review link, for the page and the action alike: a reference or
 * token of the wrong shape does no work and spends no try; a token over the count is told to wait;
 * a link that opens nothing is invalid. `steps` does the counting and the lookup, in that order.
 */
export async function openReviewGate<Row>(
  link: { reference: unknown; token: unknown },
  steps: {
    spendTry: (token: string) => Promise<RateLimitDecision>;
    open: (reference: string, token: string) => Promise<Row | null>;
  },
): Promise<ReviewGate<Row>> {
  const parsed = ReviewLinkSchema.safeParse(link);
  if (!parsed.success) return { kind: 'refused', reason: 'invalid' };
  const spent = await steps.spendTry(parsed.data.token);
  if (!spent.allowed) {
    return {
      kind: 'refused',
      reason: 'rate_limited',
      retryAfterSeconds: spent.retryAfterSeconds,
    };
  }
  const row = await steps.open(parsed.data.reference, parsed.data.token);
  return row === null
    ? { kind: 'refused', reason: 'invalid' }
    : { kind: 'opened', row };
}

/** What a refused gate comes to, for the page that read the link and for the submit that posted it. */
export function reviewRefusalFor(
  gate: Extract<ReviewGate<unknown>, { kind: 'refused' }>,
): { read: ReviewRead; submit: ReviewSubmitStatus } {
  return gate.reason === 'rate_limited'
    ? {
        read: {
          kind: 'rate_limited',
          retryAfterSeconds: gate.retryAfterSeconds,
        },
        submit: 'rate_limited',
      }
    : { read: { kind: 'invalid' }, submit: 'not_found' };
}

// ---- The page ----

/** What the page read for a link: nothing opens, the guest was counted out, or the order with its review state and the database's time. */
export type ReviewRead =
  | { kind: 'invalid' }
  | { kind: 'rate_limited'; retryAfterSeconds: number }
  | { kind: 'found'; facts: ReviewFacts; now: Date };

export type ReviewScreen =
  | { kind: 'invalid' }
  | { kind: 'too_many_tries'; retryAfterSeconds: number }
  | { kind: 'form'; problems: ReviewFormField[] }
  | { kind: 'success' }
  | { kind: 'already_reviewed' }
  | { kind: 'expired' };

/**
 * The state the page shows. Every reason a link cannot be used for a review that was not made
 * here (not a booking, cancelled, refunded, not yet ended) is `invalid`, so the page says nothing
 * about an order beyond what the link's holder is owed. A review just made shows `success` only
 * when the address says so, and `already_reviewed` otherwise.
 */
export function reviewScreen(
  read: ReviewRead,
  query: ReviewQuery,
): ReviewScreen {
  if (read.kind === 'invalid') return { kind: 'invalid' };
  if (read.kind === 'rate_limited') {
    return {
      kind: 'too_many_tries',
      retryAfterSeconds: read.retryAfterSeconds,
    };
  }
  const eligibility = reviewEligibility(read.facts, read.now);
  const state = parseReviewQuery(query);
  if (eligibility.ok) return { kind: 'form', problems: state.problems };
  switch (reviewSubmitStatus(eligibility)) {
    case 'already_reviewed':
      return state.done ? { kind: 'success' } : { kind: 'already_reviewed' };
    case 'expired':
      return { kind: 'expired' };
    case 'not_found':
      return { kind: 'invalid' };
  }
}

/** The screen for what the page read, and the session summary it may show: none for a link that opens nothing, however the order was read. */
export function reviewView(
  page: { read: ReviewRead; summary: ReviewSummary | null },
  query: ReviewQuery,
): { screen: ReviewScreen; summary: ReviewSummary | null } {
  const screen = reviewScreen(page.read, query);
  return {
    screen,
    summary: screen.kind === 'invalid' ? null : page.summary,
  };
}

/** Which fields of the form to flag, and the first of them in reading order, which the summary links to. */
export function reviewProblemState(problems: readonly ReviewFormField[]): {
  rating: boolean;
  body: boolean;
  first: ReviewFormField | null;
} {
  return {
    rating: problems.includes('rating'),
    body: problems.includes('body'),
    first: reviewFormFields.find((field) => problems.includes(field)) ?? null,
  };
}

/** What the page says about the session being reviewed: finished text, so no stored name of any length can break the layout. */
export type ReviewSummary = {
  experienceName: string;
  hostName: string;
  dayLabel: string;
};

export function reviewSummary(source: {
  experienceName: string;
  hostName: string;
  startsAt: Date;
  timeZone: string;
}): ReviewSummary {
  return {
    experienceName: oneLineClipped(source.experienceName, 200),
    hostName: oneLineClipped(source.hostName, 120),
    dayLabel: zonedDayLabel(source.startsAt, source.timeZone),
  };
}
