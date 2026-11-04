import { describe, expect, it } from 'vitest';
import { providerEventAction, type EventAttempt } from './providerEvents';
import {
  now,
  later,
  earlier,
  orderId,
  recordId as attemptId,
  attempt,
  facts,
  holdId,
  hold,
  order,
  same,
} from './providerEvents.fixtures';

//   and nothing matching is "none"
// - each row of design doc 4.2.3 "What each event does", from a seeded state:
//   succeeded on the live attempt (confirm from each confirmable order state, duplicate from the others),
//   on an attempt already succeeded (no-op once the order is settled, confirm again when confirming did not finish),
//   on a canceled attempt or another payment (duplicate); failed on the live attempt (a try, the fifth try cancels
//   and voids, the hold reopens only while it is paying and unexpired), failed on anything else (the attempt's row only);
//   requires_action (live attempt, pending order, extension only for a paying hold), canceled (any non-terminal attempt);

describe('providerEventAction: payment.succeeded', () => {
  it.each([
    ['created', 'pending_payment'],
    ['processing', 'pending_payment'],
    ['requires_action', 'pending_payment'],
    ['failed_try', 'payment_failed'],
    ['created', 'void'],
  ] as const)(
    'confirms from the live attempt (%s) on a %s order',
    (status, orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.succeeded', { method: 'google_pay' }),
          same(attempt({ status })),
          order(orderStatus),
          now,
        ),
      ).toEqual({
        kind: 'confirm',
        orderId,
        attemptId,
        attemptFrom: status,
        markSucceeded: true,
        method: 'google_pay',
      });
    },
  );

  it.each(['confirmed', 'cancelled', 'refunded_after_lapse'] as const)(
    'is a duplicate payment when the live attempt succeeds on a %s order',
    (orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.succeeded'),
          same(attempt({ status: 'processing' })),
          order(orderStatus),
          now,
        ),
      ).toEqual({ kind: 'duplicate_payment' });
    },
  );

  it.each(['confirmed', 'cancelled', 'refunded_after_lapse'] as const)(
    'is a no-op for an attempt already succeeded on a %s order',
    (orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.succeeded'),
          same(attempt({ status: 'succeeded' })),
          order(orderStatus),
          now,
        ),
      ).toEqual({ kind: 'noop' });
    },
  );

  it.each(['pending_payment', 'payment_failed', 'void'] as const)(
    'confirms again, without moving the attempt, when it is succeeded but the %s order was never confirmed',
    (orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.succeeded'),
          same(attempt({ status: 'succeeded' })),
          order(orderStatus),
          now,
        ),
      ).toEqual({
        kind: 'confirm',
        orderId,
        attemptId,
        attemptFrom: 'succeeded',
        markSucceeded: false,
        method: 'card',
      });
    },
  );

  it.each(['pending_payment', 'confirmed', 'void'] as const)(
    'is a duplicate payment for a canceled attempt on a %s order',
    (orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.succeeded'),
          same(attempt({ status: 'canceled' })),
          order(orderStatus),
          now,
        ),
      ).toEqual({ kind: 'duplicate_payment' });
    },
  );

  it('is a duplicate payment for another payment on the order', () => {
    expect(
      providerEventAction(
        facts('payment.succeeded', { objectId: 'pay_2' }),
        { kind: 'other', attempt: attempt() },
        order('pending_payment'),
        now,
      ),
    ).toEqual({ kind: 'duplicate_payment' });
  });
});

describe('providerEventAction: payment.failed', () => {
  const live = (over: Partial<EventAttempt> = {}) => same(attempt(over));

  it('moves the live attempt to a failed try, the order to payment_failed, and reopens a paying hold', () => {
    expect(
      providerEventAction(
        facts('payment.failed'),
        live({ status: 'created' }),
        order('pending_payment'),
        now,
      ),
    ).toEqual({
      kind: 'payment_failed',
      attemptId,
      attemptFrom: 'created',
      attemptStatus: 'failed_try',
      failedTries: 1,
      failureCode: 'card_declined',
      orderMove: { id: orderId, from: 'pending_payment', to: 'payment_failed' },
      reopenHoldId: holdId,
    });
  });

  it('counts another try on an attempt that already failed once', () => {
    expect(
      providerEventAction(
        facts('payment.failed'),
        live({ status: 'failed_try', failedTries: 3 }),
        order('pending_payment'),
        now,
      ),
    ).toMatchObject({
      attemptStatus: 'failed_try',
      failedTries: 4,
      orderMove: { to: 'payment_failed' },
    });
  });

  it('cancels the attempt and voids the order on the fifth try', () => {
    expect(
      providerEventAction(
        facts('payment.failed'),
        live({ status: 'failed_try', failedTries: 4 }),
        order('pending_payment'),
        now,
      ),
    ).toMatchObject({
      attemptStatus: 'canceled',
      failedTries: 5,
      orderMove: { to: 'void' },
      reopenHoldId: holdId,
    });
  });

  it.each([
    ['an expired hold', hold('paying', earlier)],
    ['a hold expiring right now', hold('paying', now)],
    ['an active hold', hold('active', later)],
    ['a converted hold', hold('converted', later)],
    ['no hold', null],
  ] as const)('leaves the hold alone for %s', (_name, heldBy) => {
    expect(
      providerEventAction(
        facts('payment.failed'),
        live(),
        order('pending_payment', heldBy),
        now,
      ),
    ).toMatchObject({
      orderMove: { to: 'payment_failed' },
      reopenHoldId: null,
    });
  });

  it('judges the hold by processing time, not by when the provider says it happened', () => {
    const heldBy = hold('paying', later);
    expect(
      providerEventAction(
        facts('payment.failed'),
        live(),
        order('pending_payment', heldBy),
        new Date(later.getTime() + 1),
      ),
    ).toMatchObject({ reopenHoldId: null });
  });

  it.each(['payment_failed', 'void', 'confirmed'] as const)(
    'changes the attempt row only when the order is %s',
    (orderStatus) => {
      expect(
        providerEventAction(
          facts('payment.failed'),
          live({ status: 'failed_try', failedTries: 1 }),
          order(orderStatus),
          now,
        ),
      ).toEqual({
        kind: 'payment_failed',
        attemptId,
        attemptFrom: 'failed_try',
        attemptStatus: 'failed_try',
        failedTries: 2,
        failureCode: 'card_declined',
        orderMove: null,
        reopenHoldId: null,
      });
    },
  );

  it.each(['succeeded', 'canceled'] as const)(
    'never changes a %s attempt',
    (status) => {
      expect(
        providerEventAction(
          facts('payment.failed'),
          live({ status }),
          order('pending_payment'),
          now,
        ),
      ).toEqual({ kind: 'noop' });
    },
  );

  it('stores no failure code that is not a failure code', () => {
    expect(
      providerEventAction(
        facts('payment.failed', { failureCode: 'Card Declined!' }),
        live(),
        order('pending_payment'),
        now,
      ),
    ).toMatchObject({ failureCode: null });
  });

  it('is a no-op for a failure of another payment', () => {
    expect(
      providerEventAction(
        facts('payment.failed', { objectId: 'pay_2' }),
        { kind: 'other', attempt: attempt() },
        order('pending_payment'),
        now,
      ),
    ).toEqual({ kind: 'noop' });
  });
});

describe('providerEventAction: payment.requires_action', () => {
  it.each(['created', 'processing', 'failed_try'] as const)(
    'moves a %s attempt to requires_action and extends a paying hold',
    (status) => {
      expect(
        providerEventAction(
          facts('payment.requires_action'),
          same(
            attempt({ status, failedTries: status === 'failed_try' ? 1 : 0 }),
          ),
          order('pending_payment'),
          now,
        ),
      ).toEqual({
        kind: 'requires_action',
        attemptId,
        attemptFrom: status,
        extendHold: { id: holdId, payingUntil: null },
      });
    },
  );

  it.each([
    ['an active hold', hold('active', later)],
    ['no hold', null],
  ] as const)('does not extend %s', (_name, heldBy) => {
    expect(
      providerEventAction(
        facts('payment.requires_action'),
        same(attempt()),
        order('pending_payment', heldBy),
        now,
      ),
    ).toEqual({
      kind: 'requires_action',
      attemptId,
      attemptFrom: 'created',
      extendHold: null,
    });
  });

  it.each([
    [
      'a repeat for an attempt already requiring action',
      'requires_action',
      'pending_payment',
    ],
    ['a terminal attempt', 'succeeded', 'pending_payment'],
    ['an order that is not pending payment', 'created', 'payment_failed'],
  ] as const)('does nothing for %s', (_name, status, orderStatus) => {
    expect(
      providerEventAction(
        facts('payment.requires_action'),
        same(attempt({ status })),
        order(orderStatus),
        now,
      ),
    ).toEqual({ kind: 'noop' });
  });
});
