import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './jobs';
import { orderLimits, type OrderStatus } from './orders';
import {
  paymentLimits,
  type AttemptStatus,
  type ProviderEventType,
} from './payments';
import {
  ProcessProviderEventPayloadSchema,
  alertAfterEventAttempts,
  eventAlertKey,
  extendedPayingUntil,
  isDeferredEventType,
  matchEventAttempt,
  orderEventsLockKey,
  payloadFacts,
  processEventDedupeKey,
  processProviderEventKind,
  providerEventAction,
  providerEventRow,
  requireAttemptTransition,
  requireOrderTransition,
  unmatchedOutcome,
  type AttemptMatch,
  type EventAttempt,
  type EventFacts,
  type EventHold,
  type EventOrder,
  type IncomingProviderEvent,
} from './providerEvents';

// Behaviours under test, one per decision, branch, or risk:
// - the job kind is a hyphenated slug, its payload is one lower-cased uuid, and keys are lower-cased
// - refund, transfer, and dispute types are deferred; payment types are not
// - the stored row: metadata ids lower-cased into their columns, the body keeps fee, method, and failure code,
//   and an amount past the order limit, a time outside the readable years, or an oversize body is refused
// - matching: provider id first, then the record id, a record id whose attempt names another payment is "other",
//   and nothing matching is "none"
// - each row of design doc 4.2.3 "What each event does", from a seeded state:
//   succeeded on the live attempt (confirm from each confirmable order state, duplicate from the others),
//   on an attempt already succeeded (no-op once the order is settled, confirm again when confirming did not finish),
//   on a canceled attempt or another payment (duplicate); failed on the live attempt (a try, the fifth try cancels
//   and voids, the hold reopens only while it is paying and unexpired), failed on anything else (the attempt's row only);
//   requires_action (live attempt, pending order, extension only for a paying hold), canceled (any non-terminal attempt);
//   an event with no order or no attempt is unmatched
// - a terminal attempt never changes
// - unmatched events retry with backoff, alert on the 5th try, and give up with an alert on the last
// - paying_until moves to now plus grace and never earlier than it was

const now = new Date('2026-10-29T12:00:00.000Z');
const later = new Date('2026-10-29T12:05:00.000Z');
const earlier = new Date('2026-10-29T11:55:00.000Z');
const orderId = '00000000-0000-4000-8000-0000000000a1';
const recordId = '00000000-0000-4000-8000-0000000000b2';
const attemptId = recordId;

function attempt(over: Partial<EventAttempt> = {}): EventAttempt {
  return {
    id: attemptId,
    status: 'created',
    failedTries: 0,
    providerPaymentId: 'pay_1',
    ...over,
  };
}

function facts(
  type: ProviderEventType,
  over: Partial<EventFacts> = {},
): EventFacts {
  return {
    type,
    objectId: 'pay_1',
    rambleRecordId: recordId,
    method: 'card',
    failureCode: 'card_declined',
    ...over,
  };
}

function order(
  status: OrderStatus,
  hold: EventHold | null = { status: 'paying', expiresAt: later },
): EventOrder {
  return { status, hold };
}

const same = (a: EventAttempt): AttemptMatch => ({
  kind: 'payment',
  attempt: a,
});

describe('job and key shapes', () => {
  it('names the job as a hyphenated slug', () => {
    expect(processProviderEventKind).toMatch(/^[a-z]+(-[a-z]+)*$/);
  });

  it('lower-cases the event id in the payload and refuses anything else', () => {
    const id = '00000000-0000-4000-8000-00000000ABCD';
    expect(ProcessProviderEventPayloadSchema.parse({ eventId: id })).toEqual({
      eventId: id.toLowerCase(),
    });
    expect(
      ProcessProviderEventPayloadSchema.safeParse({ eventId: 'nope' }).success,
    ).toBe(false);
    expect(
      ProcessProviderEventPayloadSchema.safeParse({ eventId: id, extra: 1 })
        .success,
    ).toBe(false);
  });

  it('lower-cases the lock, job, and alert keys', () => {
    expect(orderEventsLockKey('ABC-1')).toBe('order-events:abc-1');
    expect(processEventDedupeKey('ABC-1', 3)).toBe(
      'process-provider-event:abc-1:3',
    );
    expect(eventAlertKey('ABC-1')).toBe('event:abc-1');
  });

  it.each([
    ['payment.succeeded', false],
    ['payment.failed', false],
    ['payment.requires_action', false],
    ['payment.canceled', false],
    ['refund.succeeded', true],
    ['refund.failed', true],
    ['transfer.paid', true],
    ['transfer.failed', true],
    ['transfer.reversed', true],
    ['dispute.opened', true],
    ['dispute.won', true],
    ['dispute.lost', true],
  ] as const)('%s deferred is %s', (type, deferred) => {
    expect(isDeferredEventType(type)).toBe(deferred);
  });
});

describe('providerEventRow', () => {
  const event: IncomingProviderEvent = {
    id: 'evt_1',
    provider: 'fake',
    type: 'payment.succeeded',
    objectId: 'pay_1',
    metadata: {
      orderId: orderId.toUpperCase(),
      recordId: recordId.toUpperCase(),
    },
    amountMinor: 13_000,
    currency: 'USD',
    feeMinor: 410,
    failureCode: null,
    method: 'apple_pay',
    occurredAt: now,
  };

  it('keeps the metadata ids lower-cased in their columns and the rest in the body', () => {
    const row = providerEventRow(event);
    expect(row).toMatchObject({
      provider: 'fake',
      providerEventId: 'evt_1',
      type: 'payment.succeeded',
      objectId: 'pay_1',
      rambleOrderId: orderId,
      rambleRecordId: recordId,
      amountMinor: 13_000,
      currency: 'USD',
      occurredAt: now,
    });
    expect(row?.payload).toMatchObject({
      id: 'evt_1',
      feeMinor: 410,
      method: 'apple_pay',
      occurredAt: now.toISOString(),
    });
  });

  it('stores an event with no metadata and no amount', () => {
    expect(
      providerEventRow({
        ...event,
        metadata: null,
        amountMinor: null,
        currency: null,
        feeMinor: null,
        method: null,
      }),
    ).toMatchObject({
      rambleOrderId: null,
      rambleRecordId: null,
      amountMinor: null,
    });
  });

  it('refuses what the table would refuse', () => {
    expect(
      providerEventRow({ ...event, amountMinor: orderLimits.maxMinor + 1 }),
    ).toBeNull();
    expect(
      providerEventRow({
        ...event,
        occurredAt: new Date('0999-12-31T00:00:00Z'),
      }),
    ).toBeNull();
    expect(
      providerEventRow({ ...event, failureCode: 'x'.repeat(20_000) }),
    ).toBeNull();
  });

  it('reads back the facts it stored', () => {
    const row = providerEventRow(event);
    expect(payloadFacts(row?.payload ?? {})).toEqual({
      method: 'apple_pay',
      failureCode: null,
      feeMinor: 410,
    });
    expect(() => payloadFacts({})).toThrow();
  });
});

describe('matchEventAttempt', () => {
  const first = attempt({ id: 'a-1', providerPaymentId: 'pay_1' });
  const second = attempt({ id: 'a-2', providerPaymentId: null });
  const named = attempt({ id: 'a-3', providerPaymentId: 'pay_3' });

  it.each([
    ['the stored provider id', 'pay_1', null, 'payment', 'a-1'],
    ['the stored id before the record id', 'pay_1', 'a-2', 'payment', 'a-1'],
    [
      'the record id when no provider id is stored',
      'pay_9',
      'a-2',
      'payment',
      'a-2',
    ],
    [
      'a record id whose attempt names another payment',
      'pay_9',
      'a-3',
      'other',
      'a-3',
    ],
  ] as const)('%s', (_name, objectId, record, kind, id) => {
    const match = matchEventAttempt({ objectId, rambleRecordId: record }, [
      first,
      second,
      named,
    ]);
    expect(match).toMatchObject({ kind, attempt: { id } });
  });

  it.each([
    ['an unknown payment and an unknown record', 'pay_9', 'a-9'],
    ['an unknown payment and no record', 'pay_9', null],
  ])('finds none for %s', (_name, objectId, record) => {
    expect(
      matchEventAttempt({ objectId, rambleRecordId: record }, [first, named]),
    ).toEqual({ kind: 'none' });
  });
});

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
        attemptId,
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
        attemptId,
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
      attemptStatus: 'failed_try',
      failedTries: 1,
      failureCode: 'card_declined',
      orderStatus: 'payment_failed',
      reopenHold: true,
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
      orderStatus: 'payment_failed',
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
      orderStatus: 'void',
      reopenHold: true,
    });
  });

  it.each([
    ['an expired hold', { status: 'paying', expiresAt: earlier }],
    ['a hold expiring right now', { status: 'paying', expiresAt: now }],
    ['an active hold', { status: 'active', expiresAt: later }],
    ['a converted hold', { status: 'converted', expiresAt: later }],
    ['no hold', null],
  ] as const)('leaves the hold alone for %s', (_name, hold) => {
    expect(
      providerEventAction(
        facts('payment.failed'),
        live(),
        order('pending_payment', hold),
        now,
      ),
    ).toMatchObject({ orderStatus: 'payment_failed', reopenHold: false });
  });

  it('judges the hold by processing time, not by when the provider says it happened', () => {
    const hold: EventHold = { status: 'paying', expiresAt: later };
    expect(
      providerEventAction(
        facts('payment.failed'),
        live(),
        order('pending_payment', hold),
        new Date(later.getTime() + 1),
      ),
    ).toMatchObject({ reopenHold: false });
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
        attemptStatus: 'failed_try',
        failedTries: 2,
        failureCode: 'card_declined',
        orderStatus: null,
        reopenHold: false,
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
      ).toEqual({ kind: 'requires_action', attemptId, extendPaying: true });
    },
  );

  it.each([
    ['an active hold', { status: 'active', expiresAt: later }],
    ['no hold', null],
  ] as const)('does not extend %s', (_name, hold) => {
    expect(
      providerEventAction(
        facts('payment.requires_action'),
        same(attempt()),
        order('pending_payment', hold),
        now,
      ),
    ).toEqual({ kind: 'requires_action', attemptId, extendPaying: false });
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

describe('providerEventAction: payment.canceled', () => {
  it.each([
    'created',
    'requires_action',
    'processing',
    'failed_try',
  ] as const satisfies readonly AttemptStatus[])(
    'cancels a %s attempt whatever the order is',
    (status) => {
      expect(
        providerEventAction(
          facts('payment.canceled'),
          same(
            attempt({ status, failedTries: status === 'failed_try' ? 1 : 0 }),
          ),
          order('confirmed'),
          now,
        ),
      ).toEqual({ kind: 'cancel_attempt', attemptId });
    },
  );

  it.each(['succeeded', 'canceled'] as const)(
    'never changes a %s attempt',
    (status) => {
      expect(
        providerEventAction(
          facts('payment.canceled'),
          same(attempt({ status })),
          order('pending_payment'),
          now,
        ),
      ).toEqual({ kind: 'noop' });
    },
  );
});

describe('providerEventAction: events with nothing to act on', () => {
  it.each([
    'payment.succeeded',
    'payment.failed',
    'payment.requires_action',
    'payment.canceled',
  ] as const)('%s with no attempt matched is unmatched', (type) => {
    expect(
      providerEventAction(
        facts(type),
        { kind: 'none' },
        order('pending_payment'),
        now,
      ),
    ).toEqual({ kind: 'unmatched' });
  });

  it('is unmatched when the order does not exist', () => {
    expect(
      providerEventAction(
        facts('payment.succeeded'),
        same(attempt()),
        null,
        now,
      ),
    ).toEqual({ kind: 'unmatched' });
  });

  it.each([
    'refund.succeeded',
    'refund.failed',
    'transfer.paid',
    'transfer.failed',
    'transfer.reversed',
    'dispute.opened',
    'dispute.won',
    'dispute.lost',
  ] as const)('%s waits for the unit that owns it', (type) => {
    expect(
      providerEventAction(
        facts(type),
        same(attempt()),
        order('confirmed'),
        now,
      ),
    ).toEqual({ kind: 'wait' });
    expect(
      providerEventAction(facts(type), { kind: 'none' }, null, now),
    ).toEqual({ kind: 'wait' });
  });
});

describe('transition guards', () => {
  it('lets a move the tables allow through and refuses the rest', () => {
    expect(() => {
      requireAttemptTransition('created', 'succeeded');
    }).not.toThrow();
    expect(() => {
      requireAttemptTransition('succeeded', 'failed_try');
    }).toThrow('succeeded to failed_try');
    expect(() => {
      requireOrderTransition('pending_payment', 'void');
    }).not.toThrow();
    expect(() => {
      requireOrderTransition('cancelled', 'confirmed');
    }).toThrow('cancelled to confirmed');
  });
});

describe('unmatchedOutcome', () => {
  const id = '00000000-0000-4000-8000-0000000000c3';

  it.each([1, 2, 3, 4])(
    'retries after a backoff on try %i without an alert',
    (tries) => {
      expect(unmatchedOutcome(tries, id)).toEqual({
        retryAfterSeconds: backoffSeconds(tries, id),
        alert: null,
      });
    },
  );

  it('retries and alerts on the fifth try', () => {
    expect(unmatchedOutcome(alertAfterEventAttempts, id)).toEqual({
      retryAfterSeconds: backoffSeconds(alertAfterEventAttempts, id),
      alert: 'unmatched',
    });
  });

  it('retries without another alert after the fifth', () => {
    expect(unmatchedOutcome(6, id).alert).toBeNull();
    expect(
      unmatchedOutcome(paymentLimits.maxEventAttempts - 1, id),
    ).toMatchObject({
      alert: null,
    });
  });

  it('gives up with an alert on the last try the table allows', () => {
    expect(unmatchedOutcome(paymentLimits.maxEventAttempts, id)).toEqual({
      retryAfterSeconds: null,
      alert: 'gave_up',
    });
  });
});

describe('extendedPayingUntil', () => {
  it.each([
    ['no deadline yet', null, new Date('2026-10-29T12:05:00.000Z')],
    [
      'a deadline before now plus grace',
      earlier,
      new Date('2026-10-29T12:05:00.000Z'),
    ],
    [
      'a deadline after now plus grace',
      new Date('2026-10-29T12:20:00.000Z'),
      new Date('2026-10-29T12:20:00.000Z'),
    ],
  ])('with %s', (_name, current, expected) => {
    expect(extendedPayingUntil(current, now, 5)).toEqual(expected);
  });

  it('adds nothing for a grace of zero', () => {
    expect(extendedPayingUntil(null, now, 0)).toEqual(now);
  });
});
