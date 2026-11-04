import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './jobs';
import { paymentLimits, type AttemptStatus } from './payments';
import {
  afterConfirm,
  alertAfterEventAttempts,
  alertFor,
  eventRetry,
  retryErrors,
  type ProviderEventResult,
  providerEventAction,
  requireAttemptTransition,
  requireOrderTransition,
} from './providerEvents';
import { msFrom } from './testClock';
import {
  now,
  orderId,
  recordId as attemptId,
  attempt,
  facts,
  order,
  same,
} from './providerEvents.fixtures';

//   an event with no order or no attempt is unmatched
// - a terminal attempt never changes
// - an unmatched event or a success waiting for the confirm step retries with backoff and a counted try; only the first

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
  const at = (tries: number) => msFrom(backoffSeconds(tries, id) * 1000, now);

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
    ['already_confirmed', 'finish'],
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
