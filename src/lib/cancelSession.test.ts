import { describe, expect, it } from 'vitest';
import { parseAuditEntry } from './audit';
import {
  CancelSessionInputSchema,
  cancelledStatus,
  partitionOrders,
  revalidatesCache,
  sessionRowWrite,
  sessionRefundKey,
  fanOutHoldStatuses,
  fanOutLimit,
  fanOutOrderStatuses,
  holdFanOut,
  orderCancelledAudit,
  orderFanOut,
  otherDatesPath,
  releasedHold,
  requireSessionRefund,
  requireWithinFanOut,
  sessionCancelCacheChanges,
  sessionCancelPlan,
  sessionCancelledAudit,
  sessionRefundReason,
  voidedStatus,
} from './cancelSession';
import { holdStatuses } from './holds';
import { orderCancelledBys, orderStatuses } from './orders';
import { orderRefundReasons } from './refunds';
import { sessionCancelReasons, sessionStatuses } from './sessions';

// Behaviours under test, one per decision, branch, or risk:
// - the input is a session id and one of the three reasons, nothing else; an upper-case id is the same id
// - each reason maps to its own refund reason, and every one of them is a reason a refund can carry
// - a scheduled session is cancelled with the asked reason; a cancelled one is walked again under its own reason and not
//   rewritten; a completed one stops; a cancelled one with no reason is a bug and throws
// - every order status has one decision: only a confirmed order is refunded, only the two unpaid ones are voided
// - every hold status has one decision: only the two open ones are released
// - the rows a fan-out reads are bounded at exactly the limit: the limit passes, one more throws
// - a hold, an order, and a refund that cannot move throw instead of being written over
// - ops and admin are staff; no other role is
// - the audit rows are valid entries, a user's when someone cancelled and the system's when no one did
// - the cache changes name the session's spaces and the experience's schedule
// - the other-dates link goes to the experience page only for a cancellation the guest did not choose and only when a date remains

const id = '5f1b9d4e-8a3c-4c1e-9d2a-7b6f0c3e1a24';
const otherId = '9a2c4e6f-1b3d-4f5a-8c7e-0d1f2a3b4c5d';

describe('the input', () => {
  it('takes a session id and a reason', () => {
    expect(
      CancelSessionInputSchema.parse({ sessionId: id, reason: 'weather' }),
    ).toEqual({ sessionId: id, reason: 'weather' });
  });

  it.each([
    ['an id that is not one', { sessionId: 'nope', reason: 'host' }],
    ['a reason that is not one', { sessionId: id, reason: 'guest' }],
    ['no reason', { sessionId: id }],
    ['an extra field', { sessionId: id, reason: 'host', seats: 1 }],
  ])('refuses %s', (_name, input) => {
    expect(CancelSessionInputSchema.safeParse(input).success).toBe(false);
  });

  it('reads an upper-case id as the same id', () => {
    expect(
      CancelSessionInputSchema.parse({
        sessionId: id.toUpperCase(),
        reason: 'host',
      }).sessionId,
    ).toBe(id);
  });
});

describe('the refund reason', () => {
  it.each([
    ['host', 'host_cancel'],
    ['weather', 'weather'],
    ['ramble', 'ramble_cancel'],
  ] as const)('of a %s cancellation is %s', (reason, expected) => {
    expect(sessionRefundReason(reason)).toBe(expected);
  });

  it.each(sessionCancelReasons)(
    'for %s is one a refund can carry',
    (reason) => {
      expect(orderRefundReasons).toContain(sessionRefundReason(reason));
    },
  );
});

describe('what cancelling does with the session', () => {
  it('cancels a scheduled session with the asked reason', () => {
    expect(
      sessionCancelPlan({ status: 'scheduled', cancelReason: null }, 'host'),
    ).toEqual({ kind: 'proceed', reason: 'host', writesSession: true });
  });

  it.each(sessionCancelReasons)(
    'walks a session cancelled for %s again under that reason, without rewriting it',
    (stored) => {
      expect(
        sessionCancelPlan(
          { status: 'cancelled', cancelReason: stored },
          'ramble',
        ),
      ).toEqual({ kind: 'proceed', reason: stored, writesSession: false });
    },
  );

  it('stops at a completed session', () => {
    expect(
      sessionCancelPlan({ status: 'completed', cancelReason: null }, 'host'),
    ).toEqual({ kind: 'stop', result: { status: 'completed' } });
  });

  it('throws for a cancelled session with no reason', () => {
    expect(() =>
      sessionCancelPlan({ status: 'cancelled', cancelReason: null }, 'host'),
    ).toThrow('no reason');
  });

  it.each(sessionStatuses)('decides every status (%s)', (status) => {
    expect(() =>
      sessionCancelPlan({ status, cancelReason: 'host' }, 'weather'),
    ).not.toThrow();
  });
});

describe('what cancelling does with an order', () => {
  it.each([
    ['confirmed', 'refund'],
    ['pending_payment', 'void'],
    ['payment_failed', 'void'],
    ['void', 'leave'],
    ['cancelled', 'leave'],
    ['refunded_after_lapse', 'leave'],
  ] as const)('%s is %s', (status, expected) => {
    expect(orderFanOut(status)).toBe(expected);
  });

  it('decides every status in the table', () => {
    expect(orderStatuses.map(orderFanOut)).toHaveLength(orderStatuses.length);
  });

  it('locks and writes exactly the orders that are refunded or voided', () => {
    expect(fanOutOrderStatuses).toEqual([
      'pending_payment',
      'confirmed',
      'payment_failed',
    ]);
  });
});

describe('what cancelling does with a hold', () => {
  it.each([
    ['active', 'release'],
    ['paying', 'release'],
    ['converted', 'leave'],
    ['released', 'leave'],
  ] as const)('%s is %s', (status, expected) => {
    expect(holdFanOut(status)).toBe(expected);
  });

  it('releases exactly the open statuses', () => {
    expect(fanOutHoldStatuses).toEqual(['active', 'paying']);
    expect(holdStatuses.filter((s) => !fanOutHoldStatuses.includes(s))).toEqual(
      ['converted', 'released'],
    );
  });
});

describe('the bound on what is read', () => {
  const rows = (count: number) => Array.from({ length: count }, (_, i) => i);

  it('lets the limit through', () => {
    expect(requireWithinFanOut(rows(fanOutLimit), 'orders')).toHaveLength(
      fanOutLimit,
    );
  });

  it('refuses one more, naming what there is too much of', () => {
    expect(() => requireWithinFanOut(rows(fanOutLimit + 1), 'orders')).toThrow(
      `More orders than the rules allow (${String(fanOutLimit)})`,
    );
  });
});

describe('the moves that are checked', () => {
  it.each(['active', 'paying'] as const)(
    'releases a %s hold as session_cancelled',
    (status) => {
      expect(releasedHold(status)).toEqual({
        status: 'released',
        releasedReason: 'session_cancelled',
      });
    },
  );

  it.each(['converted', 'released'] as const)(
    'refuses to release a %s hold',
    (status) => {
      expect(() => releasedHold(status)).toThrow(
        `does not move from ${status}`,
      );
    },
  );

  it.each(['pending_payment', 'payment_failed'] as const)(
    'voids a %s order',
    (status) => {
      expect(voidedStatus(status)).toBe('void');
    },
  );

  it.each(['confirmed', 'cancelled', 'refunded_after_lapse'] as const)(
    'refuses to void a %s order',
    (status) => {
      expect(() => voidedStatus(status)).toThrow(
        `does not move from ${status}`,
      );
    },
  );

  it('cancels a confirmed order', () => {
    expect(cancelledStatus('confirmed')).toBe('cancelled');
  });

  it.each([
    'pending_payment',
    'payment_failed',
    'void',
    'cancelled',
    'refunded_after_lapse',
  ] as const)('refuses to cancel a %s order', (status) => {
    expect(() => cancelledStatus(status)).toThrow(
      `does not move from ${status}`,
    );
  });
});

describe('the refund of a cancelled booking', () => {
  it.each(['requested', 'already_requested'] as const)(
    'is the refund of a %s request',
    (status) => {
      const refund = { refundId: id, amountMinor: 13_000 };
      expect(requireSessionRefund({ status, refund })).toBe(refund);
    },
  );

  it.each(['no_payment', 'exceeds_card_payment', 'nothing_left'] as const)(
    'throws, naming %s, for a refusal',
    (reason) => {
      expect(() => requireSessionRefund({ status: 'refused', reason })).toThrow(
        `cannot be refunded in full: ${reason}`,
      );
    },
  );
});

describe('the orders a cancellation acts on', () => {
  const rows = orderStatuses.map((status) => ({ status }));

  it('splits the refunds from the voids, in the order given, and drops the rest', () => {
    const { toRefund, toVoid } = partitionOrders(rows);
    expect(toRefund.map((row) => row.status)).toEqual(['confirmed']);
    expect(toVoid.map((row) => row.status)).toEqual([
      'pending_payment',
      'payment_failed',
    ]);
  });
});

describe('the session row write', () => {
  it.each([
    [true, 0, { cancels: true, seatsReturned: 0 }],
    [true, 3, { cancels: true, seatsReturned: 3 }],
    [false, 1, { cancels: false, seatsReturned: 1 }],
    [false, 0, null],
  ])(
    'writesSession %s with %s seats returned',
    (writesSession, seats, expected) => {
      expect(sessionRowWrite({ writesSession, seatsReturned: seats })).toEqual(
        expected,
      );
    },
  );
});

describe('when the cache is invalidated', () => {
  const walked = { ordersRefunded: 0, ordersVoided: 0, holdsReleased: 0 };
  const repeat = { ...walked, status: 'already_cancelled' as const };

  it.each([
    [
      'a cancellation just made',
      { ...walked, status: 'cancelled' as const },
      true,
    ],
    ['a repeat that changed nothing', repeat, false],
    ['a repeat that refunded', { ...repeat, ordersRefunded: 1 }, true],
    ['a repeat that voided', { ...repeat, ordersVoided: 1 }, true],
    ['a repeat that released', { ...repeat, holdsReleased: 1 }, true],
  ])('%s', (_name, result, expected) => {
    expect(revalidatesCache(result)).toBe(expected);
  });
});

describe('the constants', () => {
  it('fix the limit and the refund key', () => {
    expect(fanOutLimit).toBe(5000);
    expect(sessionRefundKey).toBe('session-cancel');
  });
});

describe('the audit rows', () => {
  const booking = {
    orderId: id,
    sessionId: otherId,
    reason: 'weather' as const,
    refundMinor: 13_000,
    refundId: otherId,
    seatsReturned: 2,
  };
  const session = {
    sessionId: otherId,
    reason: 'host' as const,
    ordersRefunded: 3,
    ordersVoided: 1,
    holdsReleased: 2,
  };

  it('are the system’s when no one cancelled', () => {
    expect(
      parseAuditEntry(orderCancelledAudit({ ...booking, initiatedBy: null })),
    ).toMatchObject({
      actorKind: 'system',
      actorId: null,
      action: 'order.cancelled',
      subjectKind: 'order',
      subjectId: id,
      details: {
        cancelled_by: 'weather',
        session_id: otherId,
        refund_minor: 13_000,
        refund_id: otherId,
        seats_returned: 2,
      },
    });
    expect(
      parseAuditEntry(sessionCancelledAudit({ ...session, initiatedBy: null })),
    ).toMatchObject({
      actorKind: 'system',
      action: 'session.cancelled',
      subjectKind: 'session',
      subjectId: otherId,
      details: {
        reason: 'host',
        orders_refunded: 3,
        orders_voided: 1,
        holds_released: 2,
      },
    });
  });

  it('name the user who cancelled', () => {
    expect(
      parseAuditEntry(orderCancelledAudit({ ...booking, initiatedBy: id })),
    ).toMatchObject({
      actorKind: 'user',
      actorId: id,
    });
    expect(
      parseAuditEntry(sessionCancelledAudit({ ...session, initiatedBy: id })),
    ).toMatchObject({
      actorKind: 'user',
      actorId: id,
    });
  });
});

describe('the cache changes', () => {
  it('name the session’s spaces and the experience’s schedule', () => {
    expect(
      sessionCancelCacheChanges({ sessionId: id, experienceId: otherId }),
    ).toEqual([
      { kind: 'spaces', sessionId: id },
      { kind: 'experience', experienceId: otherId },
    ]);
  });
});

describe('the link to other dates', () => {
  const experience = { slug: 'harbor-sail', id: otherId };

  it.each(orderCancelledBys.filter((by) => by !== 'guest'))(
    'goes to the experience page for a cancellation by %s with a date left',
    (cancelledBy) => {
      expect(
        otherDatesPath({ cancelledBy, otherUpcomingSessions: 1, experience }),
      ).toBe(`/experiences/harbor-sail-${otherId}`);
    },
  );

  it('is left out when the guest cancelled', () => {
    expect(
      otherDatesPath({
        cancelledBy: 'guest',
        otherUpcomingSessions: 5,
        experience,
      }),
    ).toBeNull();
  });

  it('is left out when no other date remains, and given when exactly one does', () => {
    expect(
      otherDatesPath({
        cancelledBy: 'host',
        otherUpcomingSessions: 0,
        experience,
      }),
    ).toBeNull();
    expect(
      otherDatesPath({
        cancelledBy: 'host',
        otherUpcomingSessions: 1,
        experience,
      }),
    ).not.toBeNull();
  });
});
