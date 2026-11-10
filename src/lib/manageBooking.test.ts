import { describe, expect, it } from 'vitest';
import { orderA, orderB } from './bookingEmails.fixtures';
import { refundArrivalLine } from './bookingEmails';
import type { CancelBookingResult, CancelFacts } from './cancelBooking';
import { cancelNotice, manageView, retryAfterLine } from './manageBooking';

// Behaviours under test, one per decision, branch, or risk:
// - an active booking shows the refund first, in the guest's words, with a button that names the amount
// - the same booking after its window, paid with a gift, or already refunded shows no refund and a button that says so
// - a cancelled booking and one that cannot be cancelled show the booking and no cancel prompt
// - the booking shows the date, the party, the itemized lines, the tax line when taxable, and a gift split when there is one
// - every answer of the action has a notice; only some settle the page; the wording rounds a wait up to whole minutes

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

describe('the manage view of a booking', () => {
  it('shows the refund first, with a button that names the amount', () => {
    const view = manageView(orderA, facts, before);
    expect(view.kind).toBe('active');
    if (view.kind !== 'active') return;
    expect(view.prompt).toEqual({
      refundMinor: 23_412,
      heading: 'Change of plans',
      body: "Cancel by Fri, Nov 6, 4:00 PM EST for a full refund of $234.12. After that, the booking can't be refunded.",
      buttonLabel: 'Cancel and refund $234.12',
      confirmTitle: 'Cancel this booking?',
      confirmBody:
        'Your booking will be cancelled and $234.12 goes back to your card. This cannot be undone.',
      arrivalLine: refundArrivalLine,
    });
  });

  it('shows the booking itself', () => {
    const view = manageView(orderA, facts, before);
    expect(view.booking).toMatchObject({
      reference: 'RMB-A3K7MN',
      greeting: 'Pat Rivera',
      experienceName: 'Sunset sail on the Hudson',
      hostName: 'Harbor Light Sailing',
      dayLabel: 'Saturday, November 7, 2026',
      timeLabel: '4:00 PM EST',
      partyLabel: '3 guests',
      meetingPoint: 'Pier 40, West Side Highway at Houston Street',
      total: '$234.12',
      giftApplied: null,
      charged: null,
    });
    expect(view.booking.lines).toEqual([
      { label: 'Adult x 2', amount: '$170.00' },
      { label: 'Child x 1', amount: '$45.00' },
    ]);
    expect(view.booking.taxLine?.amount).toBe('$19.12');
  });

  it('says the window closed, and offers a cancel with no refund, after the deadline', () => {
    const view = manageView(orderA, facts, afterWindow);
    if (view.kind !== 'active') throw new Error('not active');
    expect(view.prompt).toMatchObject({
      refundMinor: 0,
      body: "The free cancellation window closed on Fri, Nov 6, 4:00 PM EST, so cancelling now isn't refunded.",
      buttonLabel: 'Cancel without a refund',
      confirmBody:
        'Your booking will be cancelled and nothing will be refunded. This cannot be undone.',
      arrivalLine: null,
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
      greeting: 'there',
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

  it('shows a cancelled booking with no cancel prompt', () => {
    expect(
      manageView(
        { ...orderA, status: 'cancelled' },
        { ...facts, status: 'cancelled' },
        before,
      ).kind,
    ).toBe('cancelled');
  });

  it('shows a booking that has started with no cancel prompt', () => {
    expect(manageView(orderA, facts, orderA.startsAt).kind).toBe('closed');
  });
});

describe('what the page says after a cancel', () => {
  const cases: [CancelBookingResult, string, string, boolean][] = [
    [
      {
        status: 'cancelled',
        refundMinor: 13_000,
        giftReinstated: false,
        refundEta: refundArrivalLine,
      },
      'success',
      `Your refund of $130.00 goes back to your original payment method. ${refundArrivalLine}`,
      true,
    ],
    [
      {
        status: 'cancelled',
        refundMinor: 0,
        giftReinstated: false,
        refundEta: null,
      },
      'success',
      'No refund is due under the cancellation terms.',
      true,
    ],
    [
      {
        status: 'cancelled',
        refundMinor: 0,
        giftReinstated: true,
        refundEta: null,
      },
      'success',
      'Your gift is back, so you can use it again.',
      true,
    ],
    [
      { status: 'terms_changed', refundMinor: 0 },
      'warning',
      'Cancelling now refunds $0.00. Nothing was cancelled. Check the amount below, then cancel again if you still want to.',
      false,
    ],
    [
      { status: 'not_refundable', freeCancelUntil: null },
      'info',
      "It isn't an active booking, or its session has started. Contact us if you need help.",
      true,
    ],
    [
      { status: 'already_cancelled' },
      'info',
      'There is nothing more to do.',
      true,
    ],
    [
      { status: 'refund_unavailable', reason: 'no_payment' },
      'danger',
      'Nothing was cancelled. Try again in a moment, or contact us.',
      false,
    ],
    [
      { status: 'not_found' },
      'danger',
      'Use the link in the latest email we sent you.',
      true,
    ],
    [
      { status: 'rate_limited', retryAfterSeconds: 61 },
      'warning',
      'Try again in 2 minutes.',
      false,
    ],
  ];

  it.each(cases)(
    'says the right thing for %o',
    (result, tone, body, settled) => {
      expect(cancelNotice(result)).toMatchObject({ tone, body, settled });
    },
  );

  it.each([
    [1, 'Try again in 1 minute.'],
    [60, 'Try again in 1 minute.'],
    [61, 'Try again in 2 minutes.'],
    [0, 'Try again in 1 minute.'],
  ])('rounds a wait of %i seconds up', (seconds, line) => {
    expect(retryAfterLine(seconds)).toBe(line);
  });
});
