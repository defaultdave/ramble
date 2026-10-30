import { describe, expect, it } from 'vitest';
import {
  NotBuiltError,
  confirmDecision,
  isPaymentMismatch,
  isSeatsSoldRefusal,
  isSimulatedPayment,
  notBuiltBranches,
  refundPathReasons,
  type ConfirmDecisionInput,
} from './confirmOrder';

// Behaviours under test, one per decision, branch, or risk:
// - an order already confirmed is left alone, whatever the payment says
// - a cancelled or refunded order, and a converted hold on an unconfirmed order, are bugs and throw
// - the branches no unit has built answer not_built, before the amount is compared
// - the payment must equal what was due: amount and currency, null counts as different, currency is named first
// - a booking needs a scheduled session; an open hold confirms; a lapsed hold confirms only with room for its party
// - a payment mismatch is the reason that raises an alert
// - the seat-count CHECK is told apart from any other refusal, through the wrapping query error
// - the fake gateway's money is simulated, Stripe's is not

const at = new Date('2026-11-01T12:00:00Z');
const minute = 60_000;

function input(
  change: {
    order?: Partial<ConfirmDecisionInput['order']>;
    payment?: Partial<ConfirmDecisionInput['payment']>;
    session?: Partial<NonNullable<ConfirmDecisionInput['booking']>['session']>;
    hold?: Partial<NonNullable<ConfirmDecisionInput['booking']>['hold']>;
    openHeldSeats?: number;
    booking?: null;
  } = {},
): ConfirmDecisionInput {
  return {
    order: {
      status: 'pending_payment',
      kind: 'booking',
      amountDueMinor: 18509,
      giftAppliedMinor: 0,
      currency: 'USD',
      ...change.order,
    },
    payment: { amountMinor: 18509, currency: 'USD', ...change.payment },
    booking:
      change.booking === null
        ? null
        : {
            session: {
              status: 'scheduled',
              allocation: 10,
              seatsSold: 4,
              ...change.session,
            },
            hold: {
              status: 'paying',
              seats: 2,
              expiresAt: new Date(at.getTime() - 20 * minute),
              payingUntil: new Date(at.getTime() + 5 * minute),
              ...change.hold,
            },
            openHeldSeats: change.openHeldSeats ?? 2,
          },
    at,
  };
}

const lapsed = {
  status: 'released' as const,
  payingUntil: null,
};

describe('confirmDecision', () => {
  it.each([
    ['an order already confirmed', input({ order: { status: 'confirmed' } })],
    [
      'an order already confirmed, even for a payment that is not what was due',
      input({ order: { status: 'confirmed' }, payment: { amountMinor: 1 } }),
    ],
  ])('leaves %s alone', (_name, given) => {
    expect(confirmDecision(given)).toEqual({ kind: 'already_confirmed' });
  });

  it.each(['pending_payment', 'payment_failed', 'void'] as const)(
    'confirms a %s booking on an open hold',
    (status) => {
      expect(confirmDecision(input({ order: { status } }))).toEqual({
        kind: 'confirm',
      });
    },
  );

  it.each([
    ['gift purchase', { kind: 'gift_purchase' as const }, 'gift_purchase'],
    ['zero due', { amountDueMinor: 0 }, 'zero_due'],
    ['gift applied', { giftAppliedMinor: 500 }, 'zero_due'],
  ])('names the %s branch as not built', (_name, order, branch) => {
    expect(
      confirmDecision(
        input({ order, payment: { amountMinor: 5 }, booking: null }),
      ),
    ).toEqual({ kind: 'not_built', branch });
  });

  it.each([
    ['amount short', { amountMinor: 18508 }, 'amount_mismatch'],
    ['amount over', { amountMinor: 18510 }, 'amount_mismatch'],
    ['amount not reported', { amountMinor: null }, 'amount_mismatch'],
    ['currency differs', { currency: 'EUR' }, 'currency_mismatch'],
    ['currency not reported', { currency: null }, 'currency_mismatch'],
    ['both differ', { amountMinor: 1, currency: 'EUR' }, 'currency_mismatch'],
  ])('takes the refund path when the %s', (_name, payment, reason) => {
    expect(confirmDecision(input({ payment }))).toEqual({
      kind: 'refund_path',
      reason,
    });
  });

  it.each(['cancelled', 'completed'] as const)(
    'takes the refund path for a %s session, even with an open hold',
    (status) => {
      expect(confirmDecision(input({ session: { status } }))).toEqual({
        kind: 'refund_path',
        reason: 'session_cancelled',
      });
    },
  );

  it('confirms an active hold before its expiry and a paying hold before its deadline', () => {
    const future = new Date(at.getTime() + minute);
    expect(
      confirmDecision(
        input({
          hold: { status: 'active', expiresAt: future, payingUntil: null },
          session: { seatsSold: 8 },
          openHeldSeats: 2,
        }),
      ),
    ).toEqual({ kind: 'confirm' });
  });

  describe('a hold that lapsed', () => {
    // allocation 10, sold 4, a party of 2: room exists while the other open holds take at most 4
    it.each([
      ['plenty of room', 0, 'confirm'],
      ['exactly enough room', 4, 'confirm'],
      ['one seat short', 5, 'refund_path'],
    ] as const)('with %s', (_name, others, kind) => {
      const decision = confirmDecision(
        input({ hold: lapsed, openHeldSeats: others }),
      );
      expect(decision.kind).toBe(kind);
      if (decision.kind === 'refund_path') {
        expect(decision.reason).toBe('sold_out_after_lapse');
      }
    });

    it('counts a paying hold whose deadline is exactly now as lapsed', () => {
      expect(
        confirmDecision(
          input({
            hold: { status: 'paying', payingUntil: at },
            openHeldSeats: 5,
          }),
        ),
      ).toEqual({ kind: 'refund_path', reason: 'sold_out_after_lapse' });
    });

    it('reads a capacity lowered below what is sold as no room', () => {
      expect(
        confirmDecision(
          input({
            hold: lapsed,
            session: { allocation: 3, seatsSold: 4 },
            openHeldSeats: 0,
          }),
        ),
      ).toEqual({ kind: 'refund_path', reason: 'sold_out_after_lapse' });
    });
  });

  it.each([
    ['a cancelled order', input({ order: { status: 'cancelled' } })],
    [
      'an order refunded after the lapse',
      input({ order: { status: 'refunded_after_lapse' } }),
    ],
    [
      'a converted hold on an unconfirmed order',
      input({ hold: { status: 'converted' } }),
    ],
    ['a booking with no session and hold', input({ booking: null })],
  ])('throws for %s', (_name, given) => {
    expect(() => confirmDecision(given)).toThrow(RangeError);
  });
});

describe('isPaymentMismatch', () => {
  it.each(refundPathReasons)('%s', (reason) => {
    expect(isPaymentMismatch(reason)).toBe(
      reason === 'amount_mismatch' || reason === 'currency_mismatch',
    );
  });
});

describe('NotBuiltError', () => {
  it.each([
    ['gift_purchase', 'U-062a'],
    ['zero_due', 'U-064a'],
    ['exchange', 'U-065a'],
  ] as const)('%s names %s', (branch, unit) => {
    expect(notBuiltBranches).toContain(branch);
    expect(new NotBuiltError(branch).message).toContain(unit);
  });
});

describe('isSeatsSoldRefusal', () => {
  const driver = (code: string, constraint: string) =>
    Object.assign(new Error('check violation'), { code, constraint });
  const wrapped = (inner: Error) => new Error('Failed query', { cause: inner });

  it.each([
    [
      'the driver error itself',
      driver('23514', 'sessions_seats_sold_within_allocation'),
      true,
    ],
    [
      'the driver error under the query error',
      wrapped(driver('23514', 'sessions_seats_sold_within_allocation')),
      true,
    ],
    [
      'another CHECK',
      wrapped(driver('23514', 'orders_confirmed_at_matches_status')),
      false,
    ],
    [
      'another failure on that constraint name',
      wrapped(driver('23505', 'sessions_seats_sold_within_allocation')),
      false,
    ],
    ['an error with no cause', new Error('boom'), false],
    ['a value that is not an error', 'sessions_seats_sold', false],
  ])('%s', (_name, error, expected) => {
    expect(isSeatsSoldRefusal(error)).toBe(expected);
  });
});

describe('isSimulatedPayment', () => {
  it.each([
    ['fake', true],
    ['stripe', false],
  ] as const)('%s is %s', (provider, expected) => {
    expect(isSimulatedPayment(provider)).toBe(expected);
  });
});
