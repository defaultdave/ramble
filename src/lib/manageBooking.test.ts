import { describe, expect, it } from 'vitest';
import { orderA, orderB } from './bookingEmails.fixtures';
import { type CancelFacts } from './cancelBooking';
import {
  cancelNotice,
  cancelNoticeCodes,
  cancelResultPath,
  confirmPath,
  manageView,
  managePageState,
  parseManageQuery,
} from './manageBooking';

// Behaviours under test, one per decision, branch, or risk:
// - an active booking shows the refund first, in the guest's words, with a button that names the amount and the 5 to 10 day footnote
// - the same booking after its window, paid with a gift, or already refunded shows no refund, a button that says so, and no footnote
// - a cancelled booking and one that cannot be cancelled have no cancel prompt; a cancelled one carries what it gave back
// - the booking shows the date, the party, the itemized lines, the tax line when taxable, a gift split, and "Total charged"
// - every cancel answer has a notice; a wait is rounded up to whole minutes and defaults to the whole window
// - the query is never trusted: only `confirm=1` opens the second step, only a known code is a notice, "cancelled" is believed only of a cancelled booking
// - the page shows the one notice: the answer's, or the standing one of a cancelled or closed booking
// - the second step opens only for an active booking
// - the redirect paths carry the token, and the answer as its status word

const facts: CancelFacts = {
  status: 'confirmed',
  kind: 'booking',
  ticketSubtotalMinor: 21_500,
  taxMinor: 1_912,
  totalMinor: 23_412,
  amountDueMinor: 23_412,
  commissionMinor: 3_225,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  giftAppliedMinor: 0,
  freeCancelUntil: orderA.freeCancelUntil,
  manageTokenVersion: 1,
  sessionStartsAt: orderA.startsAt,
  seats: 3,
};

const before = new Date('2026-11-05T12:00:00Z');
const afterWindow = new Date('2026-11-06T21:00:01Z');
const token = 'A'.repeat(43);

const cancelledFacts: CancelFacts = {
  ...facts,
  status: 'cancelled',
  refundedTicketMinor: 21_500,
  refundedTaxMinor: 1_912,
  commissionReturnedMinor: 3_225,
};
const cancelled = manageView(
  { ...orderA, status: 'cancelled' },
  cancelledFacts,
  before,
);
const active = manageView(orderA, facts, before);
const closed = manageView(orderA, facts, orderA.startsAt);

describe('the manage view of a booking', () => {
  it('shows the refund first, with a button that names the amount', () => {
    expect(active.kind).toBe('active');
    if (active.kind !== 'active') return;
    expect(active.prompt).toEqual({
      refundMinor: 23_412,
      heading: 'Change of plans',
      body: "Cancel by Fri, Nov 6, 4:00 PM EST for a full refund of $234.12. After that, the booking can't be refunded.",
      buttonLabel: 'Cancel and refund $234.12',
      confirmTitle: 'Cancel this booking?',
      confirmBody:
        'Your booking will be cancelled and $234.12 goes back to your card. This cannot be undone.',
      keepLabel: 'Keep my booking',
      footnote: 'Refunds go back to your card in 5 to 10 business days.',
    });
  });

  it('shows the booking itself', () => {
    expect(active.booking).toMatchObject({
      reference: 'RMB-A3K7MN',
      recipientName: 'Pat Rivera',
      experienceName: 'Sunset sail on the Hudson',
      hostName: 'Harbor Light Sailing',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      partyLabel: '3 guests',
      meetingPoint: 'Pier 40, West Side Highway at Houston Street',
      total: '$234.12',
      totalLabel: 'Total charged',
      giftApplied: null,
      charged: null,
    });
    expect(active.booking.lines).toEqual([
      { label: 'Adult x 2', amount: '$170.00' },
      { label: 'Child x 1', amount: '$45.00' },
    ]);
    expect(active.booking.taxLine?.amount).toBe('$19.12');
  });

  it('says the window closed, offers a cancel with no refund, and no footnote, after the deadline', () => {
    const view = manageView(orderA, facts, afterWindow);
    if (view.kind !== 'active') throw new Error('not active');
    expect(view.prompt).toMatchObject({
      refundMinor: 0,
      body: "The free cancellation window closed on Fri, Nov 6, 4:00 PM EST, so cancelling now isn't refunded.",
      buttonLabel: 'Cancel without a refund',
      confirmBody:
        'Your booking will be cancelled and nothing will be refunded. This cannot be undone.',
      footnote: null,
    });
  });

  it('says so when no deadline was recorded', () => {
    const view = manageView(
      { ...orderA, freeCancelUntil: null },
      { ...facts, freeCancelUntil: null },
      before,
    );
    if (view.kind !== 'active') throw new Error('not active');
    expect(view.prompt.body).toBe(
      "The free cancellation window has closed, so cancelling now isn't refunded.",
    );
  });

  it('says a gift-paid booking is not refunded to a card, and shows the split', () => {
    const view = manageView(
      orderB,
      {
        ...facts,
        ticketSubtotalMinor: 9_500,
        taxMinor: 0,
        totalMinor: 9_500,
        amountDueMinor: 5_500,
        giftAppliedMinor: 4_000,
        freeCancelUntil: new Date('2026-12-01T00:00:00Z'),
        sessionStartsAt: orderB.startsAt,
      },
      before,
    );
    if (view.kind !== 'active') throw new Error('not active');
    expect(view.prompt.refundMinor).toBe(0);
    expect(view.prompt.body).toBe(
      "This booking was paid with a gift, so cancelling it doesn't refund your card.",
    );
    expect(view.booking).toMatchObject({
      giftApplied: '$40.00',
      charged: '$55.00',
      taxLine: null,
      meetingPoint: null,
      recipientName: 'there',
    });
  });

  it('says everything was refunded when nothing is left to refund', () => {
    const view = manageView(
      orderA,
      {
        ...facts,
        refundedTicketMinor: 21_500,
        refundedTaxMinor: 1_912,
        commissionReturnedMinor: 3_225,
      },
      before,
    );
    if (view.kind !== 'active') throw new Error('not active');
    expect(view.prompt.body).toBe(
      'Everything on this booking has already been refunded.',
    );
  });

  it('shows a cancelled booking with what it gave back and no cancel prompt', () => {
    expect(cancelled).toMatchObject({
      kind: 'cancelled',
      refundedMinor: 23_412,
    });
    expect('prompt' in cancelled).toBe(false);
  });

  it('shows a booking that has started with no cancel prompt', () => {
    expect(closed.kind).toBe('closed');
    expect('prompt' in closed).toBe(false);
  });
});

describe('the notice for each answer', () => {
  it.each([
    ['cancelled', 'success'],
    ['terms_changed', 'warning'],
    ['not_refundable', 'info'],
    ['already_cancelled', 'info'],
    ['refund_unavailable', 'danger'],
    ['not_found', 'danger'],
    ['rate_limited', 'warning'],
  ] as const)('%s is a %s notice with words', (code, tone) => {
    const notice = cancelNotice(code);
    expect(notice.tone).toBe(tone);
    expect(notice.title).not.toBe('');
    expect(notice.body).not.toBe('');
  });

  it('has a notice for every code, and only the actions statuses are codes', () => {
    expect([...cancelNoticeCodes].sort()).toEqual(
      [
        'already_cancelled',
        'cancelled',
        'not_found',
        'not_refundable',
        'rate_limited',
        'refund_unavailable',
        'terms_changed',
      ].sort(),
    );
  });

  it('says what a cancelled booking gave back, and the arrival', () => {
    expect(cancelNotice('cancelled', { refundMinor: 13_000 }).body).toBe(
      'Your refund of $130.00 goes back to your original payment method. Your bank usually shows it within 5 to 10 business days.',
    );
  });

  it.each([[undefined], [0]])(
    'says no refund is due when a cancelled booking gave back %s',
    (refundMinor) => {
      expect(cancelNotice('cancelled', { refundMinor }).body).toBe(
        'No refund is due under the cancellation terms.',
      );
    },
  );

  it.each([
    [1, 'Try again in 1 minute.'],
    [60, 'Try again in 1 minute.'],
    [61, 'Try again in 2 minutes.'],
    [0, 'Try again in 1 minute.'],
    [undefined, 'Try again in 10 minutes.'],
  ])('rounds a wait of %s seconds to "%s"', (seconds, line) => {
    expect(
      cancelNotice('rate_limited', { retryAfterSeconds: seconds }).body,
    ).toBe(line);
  });
});

describe('the query is not trusted', () => {
  it.each([
    [{}, false, null],
    [{ confirm: '1' }, true, null],
    [{ confirm: '0' }, false, null],
    [{ confirm: 'true' }, false, null],
    [{ confirm: ['1'] }, false, null],
    [{ confirm: ['1', '1'] }, false, null],
    [{ result: 'cancelled' }, false, 'cancelled'],
    [{ result: 'rate_limited' }, false, 'rate_limited'],
    [{ result: 'Cancelled' }, false, null],
    [{ result: '<script>' }, false, null],
    [{ result: ['cancelled'] }, false, null],
    [{ result: 'constructor' }, false, null],
    [{ confirm: '1', result: 'terms_changed' }, true, 'terms_changed'],
  ])('reads %o as confirming %s and code %s', (query, confirming, code) => {
    expect(parseManageQuery(query)).toEqual({ confirming, code });
  });
});

describe('what the page shows', () => {
  it('shows the answer of a cancel as the one notice, with what a cancelled booking gave back', () => {
    expect(managePageState(cancelled, { result: 'cancelled' })).toEqual({
      notice: cancelNotice('cancelled', { refundMinor: 23_412 }),
      confirming: false,
    });
  });

  it('shows the standing notice of a cancelled booking when there is no answer', () => {
    expect(managePageState(cancelled, {}).notice).toEqual(
      cancelNotice('already_cancelled'),
    );
  });

  it('shows the standing notice of a booking that cannot be cancelled', () => {
    expect(managePageState(closed, {}).notice).toEqual(
      cancelNotice('not_refundable'),
    );
  });

  it('shows no notice for an active booking with no answer', () => {
    expect(managePageState(active, {}).notice).toBeNull();
  });

  it('shows the answer over the standing notice', () => {
    expect(
      managePageState(closed, { result: 'not_refundable' }).notice,
    ).toEqual(cancelNotice('not_refundable'));
    expect(managePageState(active, { result: 'terms_changed' }).notice).toEqual(
      cancelNotice('terms_changed'),
    );
  });

  it('does not believe "cancelled" of a booking that is not', () => {
    expect(managePageState(active, { result: 'cancelled' }).notice).toBeNull();
    expect(managePageState(closed, { result: 'cancelled' }).notice).toEqual(
      cancelNotice('not_refundable'),
    );
  });

  it('opens the second step only for an active booking', () => {
    expect(managePageState(active, { confirm: '1' }).confirming).toBe(true);
    expect(managePageState(cancelled, { confirm: '1' }).confirming).toBe(false);
    expect(managePageState(closed, { confirm: '1' }).confirming).toBe(false);
    expect(managePageState(active, {}).confirming).toBe(false);
  });
});

describe('the paths', () => {
  it('puts the second step in the query of the same page', () => {
    expect(confirmPath(token)).toBe(`/manage/${token}?confirm=1`);
  });

  it.each([
    [{ status: 'already_cancelled' }, 'already_cancelled'],
    [{ status: 'terms_changed', refundMinor: 1 }, 'terms_changed'],
    [{ status: 'rate_limited', retryAfterSeconds: 5 }, 'rate_limited'],
  ] as const)('sends the guest back with the answer %o', (result, word) => {
    expect(cancelResultPath(token, result)).toBe(
      `/manage/${token}?result=${word}`,
    );
  });
});
