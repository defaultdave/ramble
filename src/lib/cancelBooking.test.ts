import { describe, expect, it, vi } from 'vitest';
import {
  CancelOrderInputSchema,
  GuestCancellationPayloadSchema,
  GuestRefundPayloadSchema,
  HostCancellationPayloadSchema,
  cancelInputFromForm,
  cancelPlan,
  cancelQuote,
  cancelRefundKey,
  cancelRefundReason,
  cancellationAuditEntry,
  giftReinstated,
  isBookingRow,
  openManageGate,
  parseCancelInput,
  reconcileReadLimit,
  refundEtaLine,
  refundRequestOutcome,
  refundsReconcileWithin,
  missingOrderResult,
  returnsSpaces,
  type CancelBookingResult,
  type CancelFacts,
} from './cancelBooking';
import { refundArrivalLine } from './bookingEmails';
import { CapabilityTokenSchema } from './capabilityTokens';
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
      parseCancelInput({ manageToken: token, expectedRefundMinor: 0 }),
    ).toEqual({
      kind: 'ok',
      input: { manageToken: token, expectedRefundMinor: 0 },
    });
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
    expect(parseCancelInput(input)).toEqual({
      kind: 'refused',
      result: { status: 'not_found' },
    });
  });
});

describe('the tier, through the quote', () => {
  it.each([
    [
      'a minute before the deadline',
      new Date(freeUntil.getTime() - 60_000),
      'full',
    ],
    ['the deadline to the millisecond', freeUntil, 'full'],
    [
      'one millisecond after the deadline',
      new Date(freeUntil.getTime() + 1),
      'window_closed',
    ],
  ])('at %s the basis is %s', (_name, now, basis) => {
    expect(cancelQuote(facts, now)).toMatchObject({ basis });
  });

  it('is never free for an order with no deadline snapshot', () => {
    expect(
      cancelQuote({ ...facts, freeCancelUntil: null }, new Date(0)),
    ).toMatchObject({ refundMinor: 0, basis: 'window_closed' });
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

describe('the verdict, through the plan', () => {
  const ask = (over: Partial<Parameters<typeof cancelPlan>[0]> = {}) =>
    cancelPlan({
      facts,
      openedTokenVersion: 1,
      expectedRefundMinor: 13_000,
      now: inside,
      ...over,
    });

  it('goes on when the refund shown is the refund now', () => {
    expect(ask()).toEqual({
      kind: 'proceed',
      refundMinor: 13_000,
      requestsRefund: true,
    });
  });

  it.each([12_999, 13_001, 0])(
    'reports changed terms for a shown refund of %i',
    (shown) => {
      expect(ask({ expectedRefundMinor: shown })).toEqual({
        kind: 'stop',
        result: { status: 'terms_changed', refundMinor: 13_000 },
      });
    },
  );

  it('asks for a refund of one minor unit, the rest of an order after partial refunds', () => {
    expect(
      ask({
        facts: {
          ...facts,
          refundedTicketMinor: 12_999,
          commissionReturnedMinor: 1_949,
        },
        expectedRefundMinor: 1,
      }),
    ).toEqual({ kind: 'proceed', refundMinor: 1, requestsRefund: true });
  });

  it('goes on at no refund when no refund was shown and none is due', () => {
    expect(
      ask({
        now: new Date(freeUntil.getTime() + 1),
        expectedRefundMinor: 0,
      }),
    ).toEqual({ kind: 'proceed', refundMinor: 0, requestsRefund: false });
  });

  it('reports changed terms when the window closed after a refund was shown', () => {
    expect(ask({ now: new Date(freeUntil.getTime() + 1) })).toEqual({
      kind: 'stop',
      result: { status: 'terms_changed', refundMinor: 0 },
    });
  });

  it('reads a token from before a bump as not found, before anything else', () => {
    expect(
      ask({
        openedTokenVersion: 1,
        facts: { ...facts, manageTokenVersion: 2, status: 'cancelled' },
      }),
    ).toEqual({ kind: 'stop', result: { status: 'not_found' } });
  });

  it('says a cancelled order is already cancelled, whatever refund was shown', () => {
    expect(
      ask({
        facts: { ...facts, status: 'cancelled' },
        expectedRefundMinor: 5,
      }),
    ).toEqual({ kind: 'stop', result: { status: 'already_cancelled' } });
  });

  it('gives the deadline of a booking that cannot be cancelled', () => {
    expect(ask({ now: startsAt })).toEqual({
      kind: 'stop',
      result: {
        status: 'not_refundable',
        freeCancelUntil: freeUntil.toISOString(),
      },
    });
  });

  it('gives no deadline for an order with none', () => {
    expect(
      ask({ now: startsAt, facts: { ...facts, freeCancelUntil: null } }),
    ).toEqual({
      kind: 'stop',
      result: { status: 'not_refundable', freeCancelUntil: null },
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

  it.each([
    'order_not_found',
    'order_not_refundable',
    'nothing_left',
    'exceeds_remaining',
    'exceeds_card_payment',
    'no_payment',
    'request_changed',
  ] as const)('passes the refusal %s on, as its own reason', (reason) => {
    expect(refundRequestOutcome({ status: 'refused', reason }, 13_000)).toEqual(
      {
        kind: 'refused',
        result: { status: 'refund_unavailable', reason },
      },
    );
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

describe('the plan for the locked order', () => {
  const plan = (over: Partial<Parameters<typeof cancelPlan>[0]> = {}) =>
    cancelPlan({
      facts,
      openedTokenVersion: 1,
      expectedRefundMinor: 13_000,
      now: inside,
      ...over,
    });

  it('answers not found for an order with no booking behind it', () => {
    expect(missingOrderResult).toEqual({ status: 'not_found' });
  });

  it('goes on, asking for a refund, when one is due', () => {
    expect(plan()).toEqual({
      kind: 'proceed',
      refundMinor: 13_000,
      requestsRefund: true,
    });
  });

  it('goes on, asking for no refund, when none is due', () => {
    expect(
      plan({ now: new Date(freeUntil.getTime() + 1), expectedRefundMinor: 0 }),
    ).toEqual({ kind: 'proceed', refundMinor: 0, requestsRefund: false });
  });

  it.each([
    [
      'changed terms',
      { expectedRefundMinor: 1 },
      { status: 'terms_changed', refundMinor: 13_000 },
    ],
    ['a stale token', { openedTokenVersion: 2 }, { status: 'not_found' }],
    [
      'a cancelled order',
      { facts: { ...facts, status: 'cancelled' as const } },
      { status: 'already_cancelled' },
    ],
    [
      'a started session',
      { now: startsAt },
      { status: 'not_refundable', freeCancelUntil: freeUntil.toISOString() },
    ],
  ])('stops with the typed answer for %s', (_name, over, result) => {
    expect(plan(over)).toEqual({ kind: 'stop', result });
  });
});

describe('what is a booking row', () => {
  it.each([
    ['a session and a hold', 's', 'h', true],
    ['no session', null, 'h', false],
    ['no hold', 's', null, false],
    ['neither', null, null, false],
  ])('%s', (_name, sessionId, holdId, expected) => {
    expect(isBookingRow({ sessionId, holdId })).toBe(expected);
  });
});

describe('the reconcile check after a cancellation', () => {
  const order = {
    totalMinor: 13_000,
    refundedTicketMinor: 13_000,
    refundedTaxMinor: 0,
    commissionReturnedMinor: 1_950,
  };
  const line = {
    status: 'pending' as const,
    ticketMinor: 13_000,
    taxMinor: 0,
    commissionReturnedMinor: 1_950,
  };

  it('reads 101 rows at most', () => {
    expect(reconcileReadLimit).toBe(101);
  });

  it('passes refunds that add up to the order, read short of the limit', () => {
    expect(refundsReconcileWithin(order, [line], reconcileReadLimit)).toBe(
      true,
    );
  });

  it('fails refunds that do not add up', () => {
    expect(
      refundsReconcileWithin(
        order,
        [{ ...line, ticketMinor: 12_999 }],
        reconcileReadLimit,
      ),
    ).toBe(false);
  });

  it.each([
    ['one short of the limit', 100, true],
    ['at the limit: a read cut off there cannot say', 101, false],
  ])('a read of %s', (_name, count, expected) => {
    // Rows of nothing add up to the order whatever their number, so only the cut-off can fail it.
    const rows = Array.from({ length: count }, () => ({
      status: 'failed' as const,
      ticketMinor: 0,
      taxMinor: 0,
      commissionReturnedMinor: 0,
    }));
    expect(
      refundsReconcileWithin(
        { ...order, refundedTicketMinor: 0, commissionReturnedMinor: 0 },
        rows,
        reconcileReadLimit,
      ),
    ).toBe(expected);
  });
});

describe('whether spaces return', () => {
  it.each([
    [
      {
        status: 'cancelled',
        refundMinor: 0,
        giftReinstated: false,
        refundEta: null,
      },
      true,
    ],
    [{ status: 'already_cancelled' }, false],
    [{ status: 'terms_changed', refundMinor: 0 }, false],
    [{ status: 'not_found' }, false],
  ] as [CancelBookingResult, boolean][])('for %o', (result, expected) => {
    expect(returnsSpaces(result)).toBe(expected);
  });
});

describe('the gate in front of a manage link', () => {
  const steps = (over: { spendTry?: unknown; open?: unknown } = {}) => ({
    spendTry: vi.fn(() =>
      Promise.resolve({ allowed: true as const, remaining: 5 }),
    ),
    open: vi.fn(() =>
      Promise.resolve<{ id: string } | null>({ id: 'order-1' }),
    ),
    ...(over as object),
  });

  it.each([
    ['a short token', 'short'],
    ['a long token', 'A'.repeat(44)],
    ['an empty token', ''],
    ['a token with a bad character', `${'A'.repeat(42)}!`],
    ['not a string', 7],
  ])(
    'answers not found for %s without spending a try or looking it up',
    async (_name, bad) => {
      const gate = steps();

      expect(await openManageGate(bad, gate)).toEqual({
        kind: 'refused',
        refusal: { status: 'not_found' },
      });
      expect(gate.spendTry).not.toHaveBeenCalled();
      expect(gate.open).not.toHaveBeenCalled();
    },
  );

  it('tells a token over the count how long to wait, and looks nothing up', async () => {
    const gate = steps({
      spendTry: vi.fn(() =>
        Promise.resolve({ allowed: false as const, retryAfterSeconds: 90 }),
      ),
    });

    expect(await openManageGate(token, gate)).toEqual({
      kind: 'refused',
      refusal: { status: 'rate_limited', retryAfterSeconds: 90 },
    });
    expect(gate.open).not.toHaveBeenCalled();
  });

  it('answers not found for a token that opens nothing', async () => {
    const gate = steps({ open: vi.fn(() => Promise.resolve(null)) });

    expect(await openManageGate(token, gate)).toEqual({
      kind: 'refused',
      refusal: { status: 'not_found' },
    });
  });

  it('opens what the lookup found, after counting the try, with the checked token', async () => {
    const gate = steps();

    expect(await openManageGate(token, gate)).toEqual({
      kind: 'opened',
      row: { id: 'order-1' },
    });
    expect(gate.spendTry).toHaveBeenCalledExactlyOnceWith(token);
    expect(gate.open).toHaveBeenCalledExactlyOnceWith(token);
    expect(gate.spendTry.mock.invocationCallOrder[0]).toBeLessThan(
      gate.open.mock.invocationCallOrder[0] ?? 0,
    );
  });

  it('lets a failed count or lookup propagate, so it fails closed', async () => {
    await expect(
      openManageGate(
        token,
        steps({
          spendTry: vi.fn(() => Promise.reject(new Error('store down'))),
        }),
      ),
    ).rejects.toThrow('store down');
    await expect(
      openManageGate(
        token,
        steps({ open: vi.fn(() => Promise.reject(new Error('lookup down'))) }),
      ),
    ).rejects.toThrow('lookup down');
  });
});

describe('the action input', () => {
  it('parses a good input', () => {
    expect(
      parseCancelInput({ manageToken: token, expectedRefundMinor: 5 }),
    ).toEqual({
      kind: 'ok',
      input: { manageToken: token, expectedRefundMinor: 5 },
    });
  });

  it.each([undefined, null, {}, { manageToken: 'x', expectedRefundMinor: 5 }])(
    'is not found for %o',
    (bad) => {
      expect(parseCancelInput(bad)).toEqual({
        kind: 'refused',
        result: { status: 'not_found' },
      });
    },
  );

  it.each([
    ['digits', '13000', 13_000],
    ['zero', '0', 0],
    ['ten digits', '2000000000', 2_000_000_000],
    ['eleven digits', '12345678901', -1],
    ['letters', '12a', -1],
    ['a sign', '-5', -1],
    ['a fraction', '1.5', -1],
    ['nothing', '', -1],
    ['not a string', null, -1],
  ])('reads a form refund of %s', (_name, value, expected) => {
    expect(
      cancelInputFromForm({ manageToken: token, expectedRefundMinor: value })
        .expectedRefundMinor,
    ).toBe(expected);
  });

  it('reads a form token that is not a string as no token', () => {
    expect(
      cancelInputFromForm({ manageToken: null, expectedRefundMinor: '1' })
        .manageToken,
    ).toBe('');
  });
});

describe('the schemas', () => {
  it('takes a manage token by shape alone', () => {
    expect(CapabilityTokenSchema.safeParse(token).success).toBe(true);
    expect(CapabilityTokenSchema.safeParse('A'.repeat(44)).success).toBe(false);
  });

  const orderId = '0f6c9a52-3b8e-4f43-9a55-1a2b3c4d5e01';
  it.each([
    ['good', {}, true],
    ['upper-case id', { orderId: orderId.toUpperCase() }, true],
    ['not an id', { orderId: 'nope' }, false],
    ['version 0', { openedTokenVersion: 0 }, false],
    ['version past Postgres', { openedTokenVersion: 2_147_483_648 }, false],
    ['a negative refund', { expectedRefundMinor: -1 }, false],
    ['a refund over the limit', { expectedRefundMinor: 2_000_000_001 }, false],
    ['an extra key', { extra: 1 }, false],
  ])('what the data layer cancels: %s', (_name, over, ok) => {
    expect(
      CancelOrderInputSchema.safeParse({
        orderId,
        openedTokenVersion: 1,
        expectedRefundMinor: 0,
        ...over,
      }).success,
    ).toBe(ok);
  });

  const schemas = {
    guest: [
      GuestCancellationPayloadSchema,
      { orderId, cancelledBy: 'guest', refundMinor: 100 },
    ],
    host: [HostCancellationPayloadSchema, { orderId, cancelledBy: 'guest' }],
    refund: [GuestRefundPayloadSchema, { refundId: orderId }],
  } as const;

  it.each(Object.keys(schemas))(
    'the %s job payload takes its own shape',
    (name) => {
      const [schema, good] = schemas[name as keyof typeof schemas];
      expect(schema.safeParse(good).success).toBe(true);
      expect(schema.safeParse({ ...good, extra: 1 }).success).toBe(false);
    },
  );

  it.each([
    ['a negative amount', { refundMinor: -1 }],
    ['a fractional amount', { refundMinor: 1.5 }],
    ['an amount over the limit', { refundMinor: 2_000_000_001 }],
    ['an unknown canceller', { cancelledBy: 'someone' }],
    ['a bad order id', { orderId: 'nope' }],
  ])('the guest cancellation payload refuses %s', (_name, over) => {
    expect(
      GuestCancellationPayloadSchema.safeParse({
        orderId,
        cancelledBy: 'guest',
        refundMinor: 100,
        ...over,
      }).success,
    ).toBe(false);
  });

  it('the guest cancellation payload takes the limit itself and zero', () => {
    for (const refundMinor of [0, 2_000_000_000]) {
      expect(
        GuestCancellationPayloadSchema.safeParse({
          orderId,
          cancelledBy: 'ramble',
          refundMinor,
        }).success,
      ).toBe(true);
    }
  });
});
