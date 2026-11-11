import { describe, expect, it } from 'vitest';
import { cancelPlan, cancelStart, missingOrderResult } from './cancelBooking';
import type { CancelFacts } from './cancelBooking';

// Behaviours under test, one per decision, branch, or risk:
// - a cancellation starts only for a manage token and only for an order with a session and a hold; every other token kind, missing order,
//   and non-booking order is the missing-order answer, before any lock
// - a plan for an order that is gone is that same answer
// - a plan that goes on carries the very order it was made on, for the writes that follow

const ids = { sessionId: 'session-1', holdId: 'hold-1' };

describe('whether a cancellation starts', () => {
  it('locks the session and the hold of a booking opened with a manage token', () => {
    expect(cancelStart({ tokenKind: 'manage', ids })).toEqual({
      kind: 'lock',
      ...ids,
    });
  });

  it.each([
    ['a gift token', 'gift', ids],
    ['an order token', 'order', ids],
    ['no order', 'manage', null],
    ['an order with no session', 'manage', { ...ids, sessionId: null }],
    ['an order with no hold', 'manage', { ...ids, holdId: null }],
    ['an order with neither', 'manage', { sessionId: null, holdId: null }],
  ] as const)('stops for %s', (_name, tokenKind, row) => {
    expect(cancelStart({ tokenKind, ids: row })).toEqual({
      kind: 'stop',
      result: missingOrderResult,
    });
  });
});

describe('the plan for an order', () => {
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
    freeCancelUntil: new Date('2026-11-19T18:00:00Z'),
    manageTokenVersion: 1,
    sessionStartsAt: new Date('2026-11-20T18:00:00Z'),
    seats: 2,
  };
  const now = new Date('2026-11-19T17:00:00Z');

  it('is the missing-order answer when the order is gone', () => {
    expect(
      cancelPlan({
        facts: null,
        openedTokenVersion: 1,
        expectedRefundMinor: 0,
        now,
      }),
    ).toEqual({ kind: 'stop', result: missingOrderResult });
  });

  it('carries the order it was made on', () => {
    const plan = cancelPlan({
      facts,
      openedTokenVersion: 1,
      expectedRefundMinor: 13_000,
      now,
    });

    expect(plan).toEqual({
      kind: 'proceed',
      refundMinor: 13_000,
      requestsRefund: true,
      facts,
    });
    expect(plan.kind === 'proceed' && plan.facts).toBe(facts);
  });
});
