import { describe, expect, it } from 'vitest';
import { manageViewOf } from './manageBooking.fixtures';
import { orderA, orderB } from './bookingEmails.fixtures';
import { type CancelFacts } from './cancelBooking';
import { manageReadOutcome } from './manageBooking';
import {
  cancelNotice,
  cancelResultPath,
  confirmPath,
  managePageState,
  type CancelNoticeCode,
  type ManageQuery,
} from './manageBooking';

// Behaviours under test, one per decision, branch, or risk:
// - an active booking shows the refund first, in the guest's words, with a button that names the amount and the 5 to 10 day footnote
// - the same booking after its window, paid with a gift, or already refunded shows no refund, a button that says so, and no footnote
// - a cancelled booking and one that cannot be cancelled have no cancel prompt; a cancelled one carries what it gave back
// - the booking shows the date, the party, the itemized lines, the tax line when taxable, a gift split, and "Total charged"
// - every cancel answer has its full notice (tone, title, body); a wait is rounded up to whole minutes and defaults to the whole window
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
const cancelled = manageViewOf(
  { ...orderA, status: 'cancelled' },
  cancelledFacts,
  before,
);
const active = manageViewOf(orderA, facts, before);
const closed = manageViewOf(orderA, facts, orderA.startsAt);

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
      footnote: 'Your bank usually shows it within 5 to 10 business days.',
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
      metaLine: 'Saturday, November 7, 2026 · 4:00 PM EST · 3 guests',
      referenceLine: 'Confirmation RMB-A3K7MN · with Harbor Light Sailing',
      meetingLine: 'Meet at Pier 40, West Side Highway at Houston Street',
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
    const view = manageViewOf(orderA, facts, afterWindow);
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
    const view = manageViewOf(
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
    const view = manageViewOf(
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
      giftAppliedLabel: 'Paid with your gift',
      chargedLabel: 'Charged to your card',
      charged: '$55.00',
      taxLine: null,
      meetingPoint: null,
      meetingLine: null,
      recipientName: 'there',
    });
  });

  it('says everything was refunded when nothing is left to refund', () => {
    const view = manageViewOf(
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
    [
      'cancelled',
      'success',
      'Your booking is cancelled',
      'No refund is due under the cancellation terms.',
    ],
    [
      'terms_changed',
      'warning',
      'The refund has changed',
      'Nothing was cancelled. Check the refund below, then cancel again if you still want to.',
    ],
    [
      'not_refundable',
      'info',
      "This booking can't be cancelled here",
      "It isn't an active booking, or its session has started. Contact us if you need help.",
    ],
    [
      'already_cancelled',
      'info',
      'This booking is already cancelled',
      'There is nothing more to do.',
    ],
    [
      'refund_unavailable',
      'danger',
      "We couldn't start your refund",
      'Nothing was cancelled. Try again in a moment, or contact us.',
    ],
    [
      'not_found',
      'danger',
      'This link no longer works',
      'Use the link in the latest email we sent you.',
    ],
    ['rate_limited', 'warning', 'Too many tries', 'Try again in 10 minutes.'],
  ] as const)('%s is the whole notice', (code, tone, title, body) => {
    expect(cancelNotice(code)).toEqual({ tone, title, body });
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

  it('says the refund of one minor unit, the smallest there is', () => {
    expect(cancelNotice('cancelled', { refundMinor: 1 }).body).toBe(
      'Your refund of $0.01 goes back to your original payment method. Your bank usually shows it within 5 to 10 business days.',
    );
  });

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
  // Read through the page state of an active booking; `result` is shown only when it fits the booking.
  it.each<[ManageQuery, boolean, CancelNoticeCode | null]>([
    [{}, false, null],
    [{ confirm: '1' }, true, null],
    [{ confirm: '0' }, false, null],
    [{ confirm: 'true' }, false, null],
    [{ confirm: ['1'] }, true, null],
    [{ confirm: ['1', '1'] }, false, null],
    [{ result: ['terms_changed', 'terms_changed'] }, false, null],
    [{ result: 'terms_changed' }, false, 'terms_changed'],
    [{ result: 'rate_limited' }, false, 'rate_limited'],
    [{ result: 'Rate_limited' }, false, null],
    [{ result: '<script>' }, false, null],
    [{ result: ['terms_changed'] }, false, 'terms_changed'],
    [{ result: 'constructor' }, false, null],
    [{ result: '' }, false, null],
    [
      { confirm: '1', result: 'refund_unavailable' },
      true,
      'refund_unavailable',
    ],
  ] as const)(
    'reads %o as confirming %s and notice %s',
    (query, confirming, code) => {
      const state = managePageState(active, query);

      expect(state.confirming).toBe(confirming);
      expect(state.notice).toEqual(code === null ? null : cancelNotice(code));
    },
  );
});

describe('which answer fits which booking', () => {
  const views = { active, cancelled, closed };
  const fits = {
    cancelled: ['cancelled'],
    already_cancelled: ['cancelled'],
    terms_changed: ['active'],
    refund_unavailable: ['active'],
    not_refundable: ['closed'],
    not_found: ['active', 'cancelled', 'closed'],
    rate_limited: ['active', 'cancelled', 'closed'],
  } as const;

  it.each(
    Object.entries(fits).flatMap(([code, kinds]) =>
      (['active', 'cancelled', 'closed'] as const).map(
        (kind) =>
          [code, kind, (kinds as readonly string[]).includes(kind)] as const,
      ),
    ),
  )('the answer %s on a %s booking is shown: %s', (code, kind, shown) => {
    const { notice } = managePageState(views[kind], { result: code });
    const standing = managePageState(views[kind], {}).notice;

    expect(notice).toEqual(
      shown
        ? cancelNotice(code as keyof typeof fits, {
            refundMinor: kind === 'cancelled' ? 23_412 : 0,
          })
        : standing,
    );
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

describe('a refund of one minor unit, the smallest there is', () => {
  // After a partial refund the rest of an order can be a single cent.
  const oneCentLeft: CancelFacts = {
    ...facts,
    ticketSubtotalMinor: 13_000,
    taxMinor: 0,
    totalMinor: 13_000,
    amountDueMinor: 13_000,
    commissionMinor: 1_950,
    refundedTicketMinor: 12_999,
    commissionReturnedMinor: 1_949,
  };

  it('is still a refund: the button, the confirmation, and the footnote say so', () => {
    const view = manageViewOf(orderA, oneCentLeft, before);
    if (view.kind !== 'active') throw new Error('not active');

    expect(view.prompt).toMatchObject({
      refundMinor: 1,
      buttonLabel: 'Cancel and refund $0.01',
      confirmBody:
        'Your booking will be cancelled and $0.01 goes back to your card. This cannot be undone.',
      footnote: 'Your bank usually shows it within 5 to 10 business days.',
    });
  });
});

describe('what a cancelled booking gave back', () => {
  it.each([
    ['nothing', 0, 0, 'No refund is due under the cancellation terms.'],
    ['one cent of ticket', 1, 0, 'Your refund of $0.01 goes back'],
    ['ticket and tax', 100, 25, 'Your refund of $1.25 goes back'],
  ])(
    'for %s of a larger order: the sum of the refunded ticket and tax, not the total',
    (_name, ticket, tax, line) => {
      const view = manageViewOf(
        { ...orderA, status: 'cancelled' },
        {
          ...facts,
          status: 'cancelled',
          refundedTicketMinor: ticket,
          refundedTaxMinor: tax,
        },
        before,
      );

      expect(view).toMatchObject({
        kind: 'cancelled',
        refundedMinor: ticket + tax,
      });
      expect(
        managePageState(view, { result: 'cancelled' }).notice?.body,
      ).toContain(line);
    },
  );
});

describe('reading the page', () => {
  const read = { order: orderA, facts, now: before };

  it('judges the booking at the time it is given: past the window the prompt is the closed one', () => {
    const outcome = manageReadOutcome({ ...read, now: afterWindow });

    expect(outcome).toMatchObject({
      kind: 'ok',
      view: {
        kind: 'active',
        prompt: { refundMinor: 0, buttonLabel: 'Cancel without a refund' },
      },
    });
  });

  it('is the page for a booking that was found', () => {
    expect(manageReadOutcome(read)).toEqual({
      kind: 'ok',
      view: manageViewOf(orderA, facts, before),
    });
  });

  it.each([
    ['no order', { order: null }],
    ['no booking behind the order', { facts: null }],
    ['neither', { order: null, facts: null }],
  ])('is not found for %s', (_name, over) => {
    expect(manageReadOutcome({ ...read, ...over })).toEqual({
      kind: 'refused',
      refusal: { status: 'not_found' },
    });
  });
});
