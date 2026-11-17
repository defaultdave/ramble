import { describe, expect, it, vi } from 'vitest';
import {
  openReviewGate,
  parseReviewForm,
  ReviewInvitePayloadSchema,
  reviewEligibility,
  reviewInviteDecision,
  reviewInviteDelayMs,
  reviewInviteEmailKey,
  reviewInviteKey,
  reviewInviteKeyPrefix,
  reviewInviteResendKey,
  reviewInviteRunAt,
  reviewInviteWindow,
  reviewLimits,
  reviewProblemPath,
  reviewProblemState,
  reviewRefusalFor,
  reviewResultPath,
  reviewScreen,
  reviewSubmitStatus,
  reviewSummary,
  reviewView,
  reviewWindowMs,
  type ReviewFacts,
  type ReviewRead,
} from './reviews';

// Behaviours under test, one per decision, branch, or risk.
// eligibility
// - a confirmed booking whose session ended, with no review, inside the window, is eligible
// - each reason it is not, with the first failing rule as the reason: a gift purchase, a cancelled or unpaid order,
//   a booking refunded in whole or in part, a review that exists, a session still running or ahead, a window that has closed; the edges (ended this instant,
//   closed this instant) are eligible and still open
// - a refund of ticket or tax, however small, refuses; a booking with nothing refunded does not
// - the invite job sends for an eligible booking, refuses what is not a booking, and skips every other reason
// timing
// - the invite is due the delay after the session ends, or now when that has passed
// - the sweep's window is bounded by the delay and by the review window, on the clock it is given; with no delay it is bounded by now
// - the keys are per order and per hand-sent invite, lower-cased, and the per-order one starts with the prefix the sweep's query uses
// - the email's key is the order's for the sweep and the send's for a hand-sent invite
// what a refusal comes to
// - each eligibility reason maps to a submit status: already reviewed, expired, or not found for every other reason
// - a refused gate reads as invalid or too many tries on the page, and submits as not found or rate limited
// the form
// - a good form parses to the reference, token, a whole rating 1 to 5 and the trimmed body
// - a reference or token of the wrong shape is a bad link, whatever the rest says
// - a missing, out-of-range, fractional, or non-numeric rating, and a missing, blank, or over-long body, name their field
// - a body at the limit passes and one character over fails, counted in characters
// - the payload takes an order id, an optional send id, and nothing else
// the gate
// - a link of the wrong shape spends no try and opens nothing; a spent count is told to wait; a link that opens nothing is invalid
// the page
// - a link that opened nothing is invalid, a counted-out one is too many tries
// - an eligible booking shows the form, with the fields a failed submit named
// - a reviewed booking says already reviewed, and success only when the address says done
// - a closed window says expired; a cancelled booking, a gift purchase, and a session not over are all just invalid
// - the form's problem flags name each field and the first in reading order, or none
// - the summary is dropped for an invalid screen and kept otherwise
// - paths: a created review lands on the page with done, anything else on the bare page, a bad field list names the fields
// - the summary clips long names to one line and words the day in the session's zone

const now = new Date('2026-11-17T12:00:00Z');
const hour = 3_600_000;
const day = 24 * hour;

const facts = (overrides: Partial<ReviewFacts> = {}): ReviewFacts => ({
  kind: 'booking',
  status: 'confirmed',
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  endsAt: new Date(now.getTime() - 5 * hour),
  reviewed: false,
  ...overrides,
});

const orderId = 'a0000000-0000-4000-8000-000000000001';
const token = 'A'.repeat(43);
const reference = 'RMB-7K3M9Q';

describe('reviewEligibility', () => {
  it('lets the booker of an ended, confirmed, unreviewed booking review', () => {
    expect(reviewEligibility(facts(), now)).toEqual({ ok: true });
  });

  it.each([
    ['a gift purchase', { kind: 'gift_purchase' as const }, 'not_a_booking'],
    ['a cancelled booking', { status: 'cancelled' }, 'not_confirmed'],
    ['an unpaid booking', { status: 'pending_payment' }, 'not_confirmed'],
    ['a booking refunded its ticket', { refundedTicketMinor: 1 }, 'refunded'],
    ['a booking refunded only tax', { refundedTaxMinor: 1 }, 'refunded'],
    [
      'a reviewed booking that was then refunded',
      { reviewed: true, refundedTicketMinor: 8500 },
      'refunded',
    ],
    ['a booking already reviewed', { reviewed: true }, 'already_reviewed'],
    [
      'a session still running',
      { endsAt: new Date(now.getTime() + 1) },
      'session_not_ended',
    ],
    [
      'a session ahead',
      { endsAt: new Date(now.getTime() + 3 * day) },
      'session_not_ended',
    ],
    [
      'a window that closed a millisecond ago',
      { endsAt: new Date(now.getTime() - reviewWindowMs - 1) },
      'window_closed',
    ],
  ] as const)('refuses %s', (_label, overrides, reason) => {
    expect(reviewEligibility(facts(overrides), now)).toEqual({
      ok: false,
      reason,
    });
  });

  it.each([
    ['ended this instant', { endsAt: now }],
    [
      'the window closing this instant',
      { endsAt: new Date(now.getTime() - reviewWindowMs) },
    ],
  ])('still lets a booking review when it is %s', (_label, overrides) => {
    expect(reviewEligibility(facts(overrides), now)).toEqual({ ok: true });
  });

  it('lets a booking with nothing refunded review', () => {
    expect(
      reviewEligibility(
        facts({ refundedTicketMinor: 0, refundedTaxMinor: 0 }),
        now,
      ),
    ).toEqual({ ok: true });
  });

  it('names the first rule that fails when several do', () => {
    expect(
      reviewEligibility(
        facts({ kind: 'gift_purchase', status: 'cancelled', reviewed: true }),
        now,
      ),
    ).toEqual({ ok: false, reason: 'not_a_booking' });
    expect(
      reviewEligibility(facts({ reviewed: true, status: 'cancelled' }), now),
    ).toEqual({ ok: false, reason: 'not_confirmed' });
  });
});

describe('reviewInviteDecision', () => {
  it('sends for an eligible booking', () => {
    expect(reviewInviteDecision(facts(), now)).toBe('send');
  });

  it('refuses what is not a booking, because no job should exist for it', () => {
    expect(reviewInviteDecision(facts({ kind: 'gift_purchase' }), now)).toBe(
      'refuse',
    );
  });

  it.each([
    ['cancelled since', { status: 'cancelled' }],
    ['reviewed already', { reviewed: true }],
    ['refunded since', { refundedTicketMinor: 100 }],
    ['not over yet', { endsAt: new Date(now.getTime() + hour) }],
    ['past the window', { endsAt: new Date(now.getTime() - 100 * day) }],
  ])('skips a booking %s', (_label, overrides) => {
    expect(reviewInviteDecision(facts(overrides), now)).toBe('skip');
  });
});

describe('invite timing', () => {
  it('is due the delay after the session ends', () => {
    const endsAt = new Date('2026-11-20T20:00:00Z');
    expect(reviewInviteRunAt(endsAt, new Date('2026-11-01T00:00:00Z'))).toEqual(
      new Date(endsAt.getTime() + reviewInviteDelayMs),
    );
  });

  it('is due now when the delay has already passed', () => {
    expect(reviewInviteRunAt(new Date(now.getTime() - 2 * day), now)).toEqual(
      now,
    );
  });

  it('bounds the sweep by the delay and by the review window', () => {
    expect(reviewInviteWindow(now)).toEqual({
      endedBefore: new Date(now.getTime() - reviewInviteDelayMs),
      endedAfter: new Date(now.getTime() - reviewWindowMs),
    });
  });

  it('bounds the sessions that have simply ended by now when given no delay', () => {
    expect(reviewInviteWindow(now, 0)).toEqual({
      endedBefore: now,
      endedAfter: new Date(now.getTime() - reviewWindowMs),
    });
  });
});

describe('email keys', () => {
  it('has one key per order and one per hand-sent invite, lower-cased', () => {
    expect(reviewInviteKey('ABCDEF00-0000-4000-8000-000000000001')).toBe(
      'review-invite:abcdef00-0000-4000-8000-000000000001',
    );
    expect(reviewInviteResendKey('ABCDEF00-0000-4000-8000-000000000001')).toBe(
      'review-invite-resend:abcdef00-0000-4000-8000-000000000001',
    );
  });
});

describe('the invite key prefix', () => {
  it('starts every per-order key, and no hand-sent one', () => {
    expect(reviewInviteKey(orderId).startsWith(reviewInviteKeyPrefix)).toBe(
      true,
    );
    expect(
      reviewInviteResendKey(orderId).startsWith(reviewInviteKeyPrefix),
    ).toBe(false);
  });
});

describe('reviewInviteEmailKey', () => {
  it('is the order key for the sweep, so the order is invited once', () => {
    expect(reviewInviteEmailKey({ orderId })).toBe(reviewInviteKey(orderId));
  });

  it('is the send key for a hand-sent invite, so each send is its own email', () => {
    const sendId = 'b0000000-0000-4000-8000-000000000002';
    expect(reviewInviteEmailKey({ orderId, sendId })).toBe(
      reviewInviteResendKey(sendId),
    );
  });
});

describe('reviewSubmitStatus', () => {
  it.each([
    ['already_reviewed', 'already_reviewed'],
    ['window_closed', 'expired'],
    ['not_a_booking', 'not_found'],
    ['not_confirmed', 'not_found'],
    ['refunded', 'not_found'],
    ['session_not_ended', 'not_found'],
  ] as const)('answers %s with %s', (reason, status) => {
    expect(reviewSubmitStatus({ ok: false, reason })).toBe(status);
  });
});

describe('reviewRefusalFor', () => {
  it('reads an invalid link as invalid and submits it as not found', () => {
    expect(reviewRefusalFor({ kind: 'refused', reason: 'invalid' })).toEqual({
      read: { kind: 'invalid' },
      submit: 'not_found',
    });
  });

  it('reads a counted-out link as a wait and submits it as rate limited', () => {
    expect(
      reviewRefusalFor({
        kind: 'refused',
        reason: 'rate_limited',
        retryAfterSeconds: 42,
      }),
    ).toEqual({
      read: { kind: 'rate_limited', retryAfterSeconds: 42 },
      submit: 'rate_limited',
    });
  });
});

describe('ReviewInvitePayloadSchema', () => {
  it('takes an order id with or without a send id', () => {
    expect(ReviewInvitePayloadSchema.parse({ orderId })).toEqual({ orderId });
    expect(
      ReviewInvitePayloadSchema.parse({ orderId, sendId: orderId }),
    ).toEqual({ orderId, sendId: orderId });
  });

  it.each([
    ['an address', { orderId, email: 'a@example.com' }],
    ['a bad order id', { orderId: 'nope' }],
    ['a bad send id', { orderId, sendId: 'nope' }],
    ['nothing', {}],
  ])('refuses %s', (_label, payload) => {
    expect(ReviewInvitePayloadSchema.safeParse(payload).success).toBe(false);
  });
});

function formOf(fields: Record<string, string>) {
  return (name: string) => fields[name];
}

const goodForm = {
  reference,
  token,
  rating: '4',
  body: '  A lovely evening.  ',
};

describe('parseReviewForm', () => {
  it('parses a good form with the body trimmed and the rating a number', () => {
    expect(parseReviewForm(formOf(goodForm))).toEqual({
      ok: true,
      value: { reference, token, rating: 4, body: 'A lovely evening.' },
    });
  });

  it.each([
    ['no reference', { reference: '' }],
    ['a lower-case reference', { reference: 'rmb-7k3m9q' }],
    ['a short token', { token: 'short' }],
    ['no token', { token: '' }],
  ])(
    'treats %s as a bad link even when the rest is bad too',
    (_l, override) => {
      expect(
        parseReviewForm(formOf({ ...goodForm, rating: '9', ...override })),
      ).toEqual({ ok: false, reason: 'link' });
    },
  );

  it.each([
    ['no rating', { rating: '' }, ['rating']],
    ['a rating of 0', { rating: '0' }, ['rating']],
    ['a rating of 6', { rating: '6' }, ['rating']],
    ['a fractional rating', { rating: '4.5' }, ['rating']],
    ['a rating in words', { rating: 'five' }, ['rating']],
    ['no body', { body: '' }, ['body']],
    ['a blank body', { body: ' \n\t ' }, ['body']],
    ['both bad', { rating: '', body: '' }, ['rating', 'body']],
  ] as const)('names the fields for %s', (_l, override, fields) => {
    expect(parseReviewForm(formOf({ ...goodForm, ...override }))).toEqual({
      ok: false,
      reason: 'fields',
      reference,
      token,
      fields,
    });
  });

  it('takes a body of exactly the limit and refuses one character more, counted in characters', () => {
    const atLimit = 'é'.repeat(reviewLimits.bodyMaxChars);
    expect(parseReviewForm(formOf({ ...goodForm, body: atLimit })).ok).toBe(
      true,
    );
    expect(
      parseReviewForm(formOf({ ...goodForm, body: `${atLimit}é` })),
    ).toMatchObject({ ok: false, fields: ['body'] });
  });

  it.each([1, 2, 3, 4, 5])('takes a rating of %i', (rating) => {
    expect(
      parseReviewForm(formOf({ ...goodForm, rating: String(rating) })),
    ).toMatchObject({ ok: true, value: { rating } });
  });
});

describe('openReviewGate', () => {
  const allowed = { allowed: true, remaining: 3 } as const;

  it('spends no try and opens nothing for a link of the wrong shape', async () => {
    const spendTry = vi.fn();
    const open = vi.fn();
    expect(
      await openReviewGate({ reference: 'x', token }, { spendTry, open }),
    ).toEqual({ kind: 'refused', reason: 'invalid' });
    expect(
      await openReviewGate({ reference, token: 'x' }, { spendTry, open }),
    ).toEqual({ kind: 'refused', reason: 'invalid' });
    expect(spendTry).not.toHaveBeenCalled();
    expect(open).not.toHaveBeenCalled();
  });

  it('tells a token that is over the count to wait, and opens nothing', async () => {
    const open = vi.fn();
    expect(
      await openReviewGate(
        { reference, token },
        {
          spendTry: () =>
            Promise.resolve({ allowed: false, retryAfterSeconds: 42 }),
          open,
        },
      ),
    ).toEqual({
      kind: 'refused',
      reason: 'rate_limited',
      retryAfterSeconds: 42,
    });
    expect(open).not.toHaveBeenCalled();
  });

  it('counts the try before it looks the link up', async () => {
    const calls: string[] = [];
    await openReviewGate(
      { reference, token },
      {
        spendTry: (spent) => {
          calls.push(`spend:${spent}`);
          return Promise.resolve(allowed);
        },
        open: (ref, tok) => {
          calls.push(`open:${ref}:${tok}`);
          return Promise.resolve({ id: orderId });
        },
      },
    );
    expect(calls).toEqual([`spend:${token}`, `open:${reference}:${token}`]);
  });

  it('answers a link that opens nothing as invalid, and one that opens an order with the row', async () => {
    expect(
      await openReviewGate(
        { reference, token },
        {
          spendTry: () => Promise.resolve(allowed),
          open: () => Promise.resolve(null),
        },
      ),
    ).toEqual({ kind: 'refused', reason: 'invalid' });
    expect(
      await openReviewGate(
        { reference, token },
        {
          spendTry: () => Promise.resolve(allowed),
          open: () => Promise.resolve({ id: orderId }),
        },
      ),
    ).toEqual({ kind: 'opened', row: { id: orderId } });
  });
});

describe('reviewScreen', () => {
  const found = (overrides: Partial<ReviewFacts> = {}): ReviewRead => ({
    kind: 'found',
    facts: facts(overrides),
    now,
  });

  it('is invalid for a link that opened nothing, and too many tries for one counted out', () => {
    expect(reviewScreen({ kind: 'invalid' }, {})).toEqual({
      kind: 'invalid',
    });
    expect(
      reviewScreen({ kind: 'rate_limited', retryAfterSeconds: 30 }, {}),
    ).toEqual({ kind: 'too_many_tries', retryAfterSeconds: 30 });
  });

  it('shows the form for an eligible booking, with the fields a failed submit named', () => {
    expect(reviewScreen(found(), {})).toEqual({
      kind: 'form',
      problems: [],
    });
    expect(reviewScreen(found(), { problem: 'body,rating,elsewhere' })).toEqual(
      { kind: 'form', problems: ['rating', 'body'] },
    );
  });

  it('says already reviewed, and success only when the address says done', () => {
    expect(reviewScreen(found({ reviewed: true }), {})).toEqual({
      kind: 'already_reviewed',
    });
    expect(reviewScreen(found({ reviewed: true }), { done: '1' })).toEqual({
      kind: 'success',
    });
    expect(reviewScreen(found({ reviewed: true }), { done: 'yes' })).toEqual({
      kind: 'already_reviewed',
    });
  });

  it('never says success for a booking with no review, whatever the address says', () => {
    expect(reviewScreen(found(), { done: '1' })).toMatchObject({
      kind: 'form',
    });
  });

  it('says expired for a closed window', () => {
    expect(
      reviewScreen(
        found({ endsAt: new Date(now.getTime() - reviewWindowMs - 1) }),
        {},
      ),
    ).toEqual({ kind: 'expired' });
  });

  it.each([
    ['cancelled', { status: 'cancelled' }],
    ['refunded', { refundedTicketMinor: 500 }],
    ['a gift purchase', { kind: 'gift_purchase' as const }],
    ['not over', { endsAt: new Date(now.getTime() + hour) }],
  ])('says only invalid for a booking that is %s', (_label, overrides) => {
    expect(reviewScreen(found(overrides), {})).toEqual({
      kind: 'invalid',
    });
  });
});

describe('reviewProblemState', () => {
  it.each([
    [[], { rating: false, body: false, first: null }],
    [['body'], { rating: false, body: true, first: 'body' }],
    [['rating'], { rating: true, body: false, first: 'rating' }],
    [['body', 'rating'], { rating: true, body: true, first: 'rating' }],
  ] as const)('flags %j as %j', (problems, expected) => {
    expect(reviewProblemState(problems)).toEqual(expected);
  });
});

describe('reviewView', () => {
  const summary = {
    experienceName: 'Kayak',
    hostName: 'Tide',
    dayLabel: 'Sat',
  };

  it('drops the summary for an invalid screen, whatever was read', () => {
    expect(
      reviewView(
        {
          read: { kind: 'found', facts: facts({ status: 'cancelled' }), now },
          summary,
        },
        {},
      ),
    ).toEqual({ screen: { kind: 'invalid' }, summary: null });
  });

  it('keeps the summary for the form', () => {
    expect(
      reviewView({ read: { kind: 'found', facts: facts(), now }, summary }, {}),
    ).toEqual({ screen: { kind: 'form', problems: [] }, summary });
  });
});

describe('result paths', () => {
  it('lands a created review on the page with done, and anything else on the bare page', () => {
    const page = `/review/${reference}/${token}`;
    expect(reviewResultPath(reference, token, 'created')).toBe(
      `${page}?done=1`,
    );
    expect(
      (
        [
          'already_reviewed',
          'expired',
          'not_found',
          'rate_limited',
          'invalid',
        ] as const
      ).map((status) => reviewResultPath(reference, token, status)),
    ).toEqual(Array.from({ length: 5 }, () => page));
  });

  it('names the fields to look at again', () => {
    expect(reviewProblemPath(reference, token, ['rating', 'body'])).toBe(
      `/review/${reference}/${token}?problem=rating,body`,
    );
  });
});

describe('reviewSummary', () => {
  it('clips long names to one line and words the day in the session zone', () => {
    const summary = reviewSummary({
      experienceName: `Sunset\nkayak ${'x'.repeat(300)}`,
      hostName: 'Hudson Paddle Club',
      startsAt: new Date('2026-11-15T02:30:00Z'),
      timeZone: 'America/New_York',
    });
    expect(summary.experienceName).toHaveLength(200);
    expect(summary.experienceName).not.toContain('\n');
    expect(summary.hostName).toBe('Hudson Paddle Club');
    expect(summary.dayLabel).toBe('Saturday, November 14, 2026');
  });
});
