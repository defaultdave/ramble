import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './jobs';
import { orderLimits, type OrderStatus } from './orders';
import { paymentLimits, type AttemptStatus } from './payments';
import {
  ProcessProviderEventPayloadSchema,
  EventMetadataSchema,
  afterConfirm,
  alertAfterEventAttempts,
  alertFor,
  eventIds,
  eventRetry,
  intakeResponse,
  isPaymentEventType,
  isProviderMismatch,
  isRefusedSignature,
  needsMetadataLookup,
  parsePreparedMetadata,
  retryErrors,
  type ProviderEventResult,
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
  type AttemptMatch,
  type EventAttempt,
  type EventFacts,
  type EventHold,
  type PaymentEventType,
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
// - an unmatched event or a success waiting for the confirm step retries with backoff and a counted try; only the first
//   alerts on the 5th try; both give up with one alert on the last; alerts, intake statuses, ids, and lookups are decided here
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
    method: null,
    ...over,
  };
}

function facts(
  type: PaymentEventType,
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

const holdId = '00000000-0000-4000-8000-0000000000d4';

function hold(
  status: EventHold['status'],
  expiresAt: Date,
  payingUntil: Date | null = null,
): EventHold {
  return { id: holdId, status, expiresAt, payingUntil };
}

function order(
  status: OrderStatus,
  heldBy: EventHold | null = hold('paying', later),
): EventOrder {
  return { id: orderId, status, hold: heldBy };
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
      ).toEqual({ kind: 'cancel_attempt', attemptId, attemptFrom: status });
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

describe('eventRetry', () => {
  const id = '00000000-0000-4000-8000-0000000000c3';
  const at = (tries: number) =>
    new Date(now.getTime() + backoffSeconds(tries, id) * 1000);

  it.each([0, 1, 2, 3])(
    'queues the next try after a backoff, with no alert, after %i earlier tries',
    (before) => {
      expect(eventRetry('unmatched', before, id, now)).toEqual({
        tries: before + 1,
        runAfter: at(before + 1),
        alert: null,
        lastError: retryErrors.unmatched,
      });
    },
  );

  it('alerts on the fifth try of an unmatched event and keeps retrying', () => {
    expect(
      eventRetry('unmatched', alertAfterEventAttempts - 1, id, now),
    ).toMatchObject({
      tries: alertAfterEventAttempts,
      runAfter: at(alertAfterEventAttempts),
      alert: 'unmatched',
    });
    expect(
      eventRetry('unmatched', alertAfterEventAttempts, id, now).alert,
    ).toBeNull();
  });

  it('does not alert on the fifth try of a success waiting for the confirm step', () => {
    expect(
      eventRetry('confirm_unavailable', alertAfterEventAttempts - 1, id, now),
    ).toMatchObject({
      alert: null,
      lastError: retryErrors.confirm_unavailable,
    });
  });

  it.each(['unmatched', 'confirm_unavailable'] as const)(
    'gives up with one alert on the last try the table allows (%s)',
    (reason) => {
      expect(
        eventRetry(reason, paymentLimits.maxEventAttempts - 1, id, now),
      ).toMatchObject({
        tries: paymentLimits.maxEventAttempts,
        runAfter: null,
        alert: 'gave_up',
      });
    },
  );

  it('never counts past the last try', () => {
    expect(
      eventRetry('unmatched', paymentLimits.maxEventAttempts, id, now).tries,
    ).toBe(paymentLimits.maxEventAttempts);
  });
});

describe('afterConfirm', () => {
  it.each([
    ['confirmed', 'finish'],
    ['unavailable', 'retry'],
  ] as const)('%s means %s', (status, outcome) => {
    expect(afterConfirm(status)).toBe(outcome);
  });
});

describe('alertFor', () => {
  const id = '00000000-0000-4000-8000-0000000000e5';
  const results: [string, ProviderEventResult, object | null][] = [
    ['a processed event', { status: 'processed' }, null],
    ['an event seen again', { status: 'already_processed' }, null],
    [
      'a deferred type',
      { status: 'left', reason: 'deferred_type', orderId },
      null,
    ],
    [
      'a duplicate payment',
      { status: 'left', reason: 'duplicate_payment', orderId },
      {
        kind: 'payment-duplicate',
        key: `event:${id}`,
        context: { eventId: id, orderId },
      },
    ],
    [
      'a retry with no alert',
      { status: 'retry', reason: 'unmatched', tries: 2, alert: null },
      null,
    ],
    [
      'the fifth unmatched try',
      { status: 'retry', reason: 'unmatched', tries: 5, alert: 'unmatched' },
      {
        kind: 'payment-event-unmatched',
        key: `event:${id}`,
        context: { eventId: id, tries: 5 },
      },
    ],
    [
      'giving up on an unmatched event',
      { status: 'retry', reason: 'unmatched', tries: 25, alert: 'gave_up' },
      {
        kind: 'payment-event-unmatched',
        key: `event:${id}:gave-up`,
        context: { eventId: id, tries: 25 },
      },
    ],
    [
      'giving up on a success that could not be confirmed',
      {
        status: 'retry',
        reason: 'confirm_unavailable',
        tries: 25,
        alert: 'gave_up',
      },
      {
        kind: 'payment-confirm-unavailable',
        key: `event:${id}:gave-up`,
        context: { eventId: id, tries: 25 },
      },
    ],
  ];

  it.each(results)('for %s', (_name, result, expected) => {
    expect(alertFor(result, id)).toEqual(expected);
  });
});

describe('intake helpers', () => {
  it.each([
    ['invalid_signature', true],
    ['invalid_input', true],
    ['provider_unavailable', false],
    ['not_found', false],
  ])('a %s refuses the signature: %s', (code, refused) => {
    expect(isRefusedSignature(code)).toBe(refused);
  });

  it.each([
    [{ kind: 'too_large' }, { status: 413 }],
    [
      { kind: 'refused', failures: { allowed: true, remaining: 3 } },
      { status: 400 },
    ],
    [
      { kind: 'refused', failures: { allowed: false, retryAfterSeconds: 42 } },
      { status: 429, retryAfterSeconds: 42 },
    ],
    [
      { kind: 'over_budget', budget: { allowed: false, retryAfterSeconds: 7 } },
      { status: 429, retryAfterSeconds: 7 },
    ],
    [
      { kind: 'over_budget', budget: { allowed: true, remaining: 1 } },
      { status: 200 },
    ],
    [{ kind: 'unstorable' }, { status: 400 }],
    [{ kind: 'accepted' }, { status: 200 }],
  ] as const)('answers %j with %j', (outcome, response) => {
    expect(intakeResponse(outcome)).toEqual(response);
  });

  it('knows a payment event from one that belongs to a later unit', () => {
    expect(isPaymentEventType('payment.failed')).toBe(true);
    expect(isPaymentEventType('refund.failed')).toBe(false);
  });
});

describe('metadata and lookups', () => {
  it('lower-cases the ids the provider reports and refuses a malformed one', () => {
    expect(
      EventMetadataSchema.parse({
        orderId: orderId.toUpperCase(),
        recordId: recordId.toUpperCase(),
      }),
    ).toEqual({ orderId, recordId });
    expect(
      EventMetadataSchema.safeParse({ orderId: 'nope', recordId }).success,
    ).toBe(false);
  });

  it('reads the prepared lookup: none as null, ids as ids, anything else refused', () => {
    expect(parsePreparedMetadata(undefined)).toBeNull();
    expect(parsePreparedMetadata(null)).toBeNull();
    expect(parsePreparedMetadata({ orderId, recordId })).toEqual({
      orderId,
      recordId,
    });
    expect(() => parsePreparedMetadata({ orderId: 'x' })).toThrow();
  });

  it('refuses an event of another provider than the port', () => {
    expect(isProviderMismatch('fake', 'fake')).toBe(false);
    expect(isProviderMismatch('fake', 'stripe')).toBe(true);
  });

  it.each([
    [
      'an unprocessed payment event with no order',
      'payment.succeeded',
      null,
      null,
      true,
    ],
    [
      'an event that names its order',
      'payment.succeeded',
      orderId,
      null,
      false,
    ],
    ['an event already processed', 'payment.succeeded', null, now, false],
    ['a refund with no order', 'refund.succeeded', null, null, false],
  ] as const)('looks up %s: %s', (_name, type, order, processedAt, lookup) => {
    expect(
      needsMetadataLookup({ type, rambleOrderId: order, processedAt }),
    ).toBe(lookup);
  });

  it('handles an event under its own ids, or adopts the looked-up ones only when it has none', () => {
    const found = { orderId, recordId };
    expect(
      eventIds({ rambleOrderId: null, rambleRecordId: null }, found),
    ).toEqual({ ...found, adopted: true });
    expect(
      eventIds({ rambleOrderId: 'own-o', rambleRecordId: 'own-r' }, found),
    ).toEqual({ orderId: 'own-o', recordId: 'own-r', adopted: false });
    expect(
      eventIds({ rambleOrderId: null, rambleRecordId: null }, null),
    ).toEqual({ orderId: null, recordId: null, adopted: false });
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
