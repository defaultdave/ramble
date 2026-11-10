import { describe, expect, it } from 'vitest';
import {
  CancelBookingInputSchema,
  cancelQuote,
  cancelRefundKey,
  cancelRefundReason,
  cancelVerdict,
  cancellationAuditEntry,
  giftReinstated,
  refundEtaLine,
  refundRequestOutcome,
  refusalResult,
  tierRefundsInFull,
  type CancelFacts,
} from './cancelBooking';
import { refundArrivalLine } from './bookingEmails';
import { parseAuditEntry } from './audit';

// Behaviours under test, one per decision, branch, or risk:
// - the input takes a token-shaped string and a whole refund in range; anything else is refused, extra keys too
// - the tier is free up to and including its deadline, to the millisecond, and never with no deadline
// - the quote: a confirmed booking ahead of its start refunds the rest of the order inside the window, nothing
//   after it, nothing for a gift-paid order, nothing when everything was refunded; the exact start refuses
// - a refusal of the plan that is not "nothing left" is an error, never a zero refund
// - the verdict checks the token version first, then the order's state, then the shown refund to the minor unit
// - each refusal verdict is its own typed answer; a stale token reads as not found
// - the refund request's answer: a refund of the shown amount goes on, a refusal is passed on, another amount throws
// - the gift hook reinstates nothing; the eta line exists only when money is coming back
// - the audit row names the order, session, amounts, and seats, and the audit schema accepts it

const startsAt = new Date('2026-11-20T18:00:00.000Z');
const freeUntil = new Date('2026-11-19T18:00:00.000Z');

const facts: CancelFacts = {
  status: 'confirmed',
  kind: 'booking',
  ticketSubtotalMinor: 13_000,
  taxMinor: 0,
  totalMinor: 13_000,
  amountDueMinor: 13_000,
  commissionMinor: 1_950,
  commissionRateBps: 1_500,
  refundedTicketMinor: 0,
  refundedTaxMinor: 0,
  commissionReturnedMinor: 0,
  giftAppliedMinor: 0,
  freeCancelUntil: freeUntil,
  manageTokenVersion: 1,
  sessionStartsAt: startsAt,
  seats: 2,
};

const inside = new Date(freeUntil.getTime() - 60_000);
const token = 'A'.repeat(43);

describe('the input', () => {
  it('takes a token and a refund', () => {
    expect(
      CancelBookingInputSchema.parse({
        manageToken: token,
        expectedRefundMinor: 0,
      }),
    ).toEqual({ manageToken: token, expectedRefundMinor: 0 });
  });

  it.each([
    ['a short token', { manageToken: 'A'.repeat(42), expectedRefundMinor: 1 }],
    ['a long token', { manageToken: 'A'.repeat(44), expectedRefundMinor: 1 }],
    [
      'a token with a bad character',
      { manageToken: `${'A'.repeat(42)}!`, expectedRefundMinor: 1 },
    ],
    ['a negative refund', { manageToken: token, expectedRefundMinor: -1 }],
    ['a fractional refund', { manageToken: token, expectedRefundMinor: 1.5 }],
    [
      'a refund over the limit',
      { manageToken: token, expectedRefundMinor: 2_000_000_001 },
    ],
    [
      'an extra key',
      { manageToken: token, expectedRefundMinor: 1, orderId: 'x' },
    ],
    ['no refund', { manageToken: token }],
  ])('refuses %s', (_name, input) => {
    expect(CancelBookingInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('the tier', () => {
  it.each([
    [
      'a minute before the deadline',
      new Date(freeUntil.getTime() - 60_000),
      true,
    ],
    ['the deadline to the millisecond', freeUntil, true],
    [
      'one millisecond after the deadline',
      new Date(freeUntil.getTime() + 1),
      false,
    ],
  ])('at %s', (_name, now, expected) => {
    expect(tierRefundsInFull(freeUntil, now)).toBe(expected);
  });

  it('is never free for an order with no deadline snapshot', () => {
    expect(tierRefundsInFull(null, new Date(0))).toBe(false);
  });
});

describe('the quote', () => {
  it('refunds the rest of the order inside the window', () => {
    expect(cancelQuote(facts, inside)).toEqual({
      kind: 'cancellable',
      refundMinor: 13_000,
      basis: 'full',
    });
  });

  it('refunds ticket and tax together', () => {
    expect(
      cancelQuote(
        {
          ...facts,
          ticketSubtotalMinor: 17_000,
          taxMinor: 1_509,
          totalMinor: 18_509,
          amountDueMinor: 18_509,
          commissionMinor: 2_550,
        },
        inside,
      ),
    ).toMatchObject({ refundMinor: 18_509, basis: 'full' });
  });

  it('refunds only what earlier refunds left', () => {
    expect(
      cancelQuote(
        {
          ...facts,
          refundedTicketMinor: 5_000,
          commissionReturnedMinor: 750,
        },
        inside,
      ),
    ).toMatchObject({ refundMinor: 8_000, basis: 'full' });
  });

  it('refunds nothing after the window, and says why', () => {
    expect(cancelQuote(facts, new Date(freeUntil.getTime() + 1))).toEqual({
      kind: 'cancellable',
      refundMinor: 0,
      basis: 'window_closed',
    });
  });

  it('refunds nothing for a booking paid in part by a gift, even inside the window', () => {
    expect(
      cancelQuote(
        { ...facts, giftAppliedMinor: 1, amountDueMinor: 12_999 },
        inside,
      ),
    ).toEqual({ kind: 'cancellable', refundMinor: 0, basis: 'gift_paid' });
  });

  it('refunds nothing when everything was refunded already', () => {
    expect(
      cancelQuote(
        {
          ...facts,
          refundedTicketMinor: 13_000,
          commissionReturnedMinor: 1_950,
        },
        inside,
      ),
    ).toEqual({
      kind: 'cancellable',
      refundMinor: 0,
      basis: 'already_refunded',
    });
  });

  it('throws when the order cannot say what it holds', () => {
    expect(() => cancelQuote({ ...facts, totalMinor: 12_999 }, inside)).toThrow(
      RangeError,
    );
  });

  it('throws when the card paid less than the order but no gift is recorded', () => {
    expect(() =>
      cancelQuote({ ...facts, amountDueMinor: 100 }, inside),
    ).toThrow('exceeds_card_payment');
  });

  it('a cancelled order is already cancelled, whenever it is asked', () => {
    expect(cancelQuote({ ...facts, status: 'cancelled' }, inside)).toEqual({
      kind: 'already_cancelled',
    });
  });

  it.each([
    ['a pending payment', { status: 'pending_payment' as const }],
    ['a refund after lapse', { status: 'refunded_after_lapse' as const }],
    ['a gift purchase', { kind: 'gift_purchase' as const }],
  ])('cannot cancel %s', (_name, over) => {
    expect(cancelQuote({ ...facts, ...over }, inside)).toEqual({
      kind: 'not_cancellable',
    });
  });

  it.each([
    ['the exact start', startsAt, 'not_cancellable'],
    ['after the start', new Date(startsAt.getTime() + 1), 'not_cancellable'],
    [
      'a millisecond before the start',
      new Date(startsAt.getTime() - 1),
      'cancellable',
    ],
  ])('at %s', (_name, now, kind) => {
    expect(cancelQuote(facts, now).kind).toBe(kind);
  });
});

describe('the verdict', () => {
  const ask = (over: Partial<Parameters<typeof cancelVerdict>[0]> = {}) =>
    cancelVerdict({
      facts,
      openedTokenVersion: 1,
      expectedRefundMinor: 13_000,
      now: inside,
      ...over,
    });

  it('goes on when the refund shown is the refund now', () => {
    expect(ask()).toEqual({ kind: 'proceed', refundMinor: 13_000 });
  });

  it.each([12_999, 13_001, 0])(
    'reports changed terms for a shown refund of %i',
    (shown) => {
      expect(ask({ expectedRefundMinor: shown })).toEqual({
        kind: 'terms_changed',
        refundMinor: 13_000,
      });
    },
  );

  it('goes on at no refund when no refund was shown and none is due', () => {
    expect(
      ask({
        now: new Date(freeUntil.getTime() + 1),
        expectedRefundMinor: 0,
      }),
    ).toEqual({ kind: 'proceed', refundMinor: 0 });
  });

  it('reports changed terms when the window closed after a refund was shown', () => {
    expect(ask({ now: new Date(freeUntil.getTime() + 1) })).toEqual({
      kind: 'terms_changed',
      refundMinor: 0,
    });
  });

  it('reads a token from before a bump as stale, before anything else', () => {
    expect(
      ask({
        openedTokenVersion: 1,
        facts: { ...facts, manageTokenVersion: 2, status: 'cancelled' },
      }),
    ).toEqual({ kind: 'token_stale' });
  });

  it('says a cancelled order is already cancelled, whatever refund was shown', () => {
    expect(
      ask({
        facts: { ...facts, status: 'cancelled' },
        expectedRefundMinor: 5,
      }),
    ).toEqual({ kind: 'already_cancelled' });
  });

  it('says a booking that cannot be cancelled is not cancellable', () => {
    expect(ask({ now: startsAt })).toEqual({ kind: 'not_cancellable' });
  });
});

describe('the answer for a refusal', () => {
  it.each([
    [
      { kind: 'terms_changed', refundMinor: 5 } as const,
      { status: 'terms_changed', refundMinor: 5 },
    ],
    [{ kind: 'already_cancelled' } as const, { status: 'already_cancelled' }],
    [{ kind: 'token_stale' } as const, { status: 'not_found' }],
  ])('maps %o', (verdict, expected) => {
    expect(refusalResult(verdict, freeUntil)).toEqual(expected);
  });

  it('gives the deadline of a booking that cannot be cancelled', () => {
    expect(refusalResult({ kind: 'not_cancellable' }, freeUntil)).toEqual({
      status: 'not_refundable',
      freeCancelUntil: freeUntil.toISOString(),
    });
  });

  it('gives no deadline for an order with none', () => {
    expect(refusalResult({ kind: 'not_cancellable' }, null)).toEqual({
      status: 'not_refundable',
      freeCancelUntil: null,
    });
  });
});

describe('the refund request answer', () => {
  const refund = { refundId: 'r-1', amountMinor: 13_000 };

  it.each(['requested', 'already_requested'] as const)(
    'goes on with a refund of the shown amount (%s)',
    (status) => {
      expect(refundRequestOutcome({ status, refund }, 13_000)).toEqual({
        kind: 'go',
        refundId: 'r-1',
      });
    },
  );

  it('passes a refusal on', () => {
    expect(
      refundRequestOutcome({ status: 'refused', reason: 'no_payment' }, 13_000),
    ).toEqual({ kind: 'refused', reason: 'no_payment' });
  });

  it.each([12_999, 13_001])(
    'throws for a refund of another amount (%i)',
    (shown) => {
      expect(() =>
        refundRequestOutcome({ status: 'requested', refund }, shown),
      ).toThrow(RangeError);
    },
  );
});

describe('the rest of the cancellation', () => {
  it('reinstates no gift', () => {
    expect(giftReinstated()).toBe(false);
  });

  it('says when the money arrives only when money is coming back', () => {
    expect(refundEtaLine(1)).toBe(refundArrivalLine);
    expect(refundEtaLine(0)).toBeNull();
  });

  it('names the refund by reason and key', () => {
    expect([cancelRefundReason, cancelRefundKey]).toEqual([
      'guest_cancel',
      'guest-cancel',
    ]);
  });

  it('writes an audit row the audit schema accepts, with ids and amounts only', () => {
    const entry = cancellationAuditEntry({
      orderId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
      sessionId: '7d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e02',
      refundMinor: 13_000,
      refundId: '5c1e2f30-4a5b-5c6d-8e7f-9a0b1c2d3e03',
      seatsReturned: 2,
      giftReinstated: false,
    });
    expect(entry).toEqual({
      actorKind: 'guest',
      action: 'order.cancelled',
      subjectKind: 'order',
      subjectId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
      details: {
        cancelled_by: 'guest',
        session_id: '7d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e02',
        refund_minor: 13_000,
        refund_id: '5c1e2f30-4a5b-5c6d-8e7f-9a0b1c2d3e03',
        seats_returned: 2,
        gift_reinstated: false,
      },
    });
    expect(parseAuditEntry(entry)).toMatchObject({ actorId: null });
  });

  it('writes a null refund id when no refund was requested', () => {
    const entry = cancellationAuditEntry({
      orderId: '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01',
      sessionId: '7d1e2f30-4a5b-4c6d-8e7f-9a0b1c2d3e02',
      refundMinor: 0,
      refundId: null,
      seatsReturned: 2,
      giftReinstated: false,
    });
    expect(parseAuditEntry(entry).details).toMatchObject({ refund_id: null });
  });
});
