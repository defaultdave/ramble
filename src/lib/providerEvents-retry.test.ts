import { describe, expect, it } from 'vitest';
import { backoffSeconds } from './jobs';
import { paymentLimits } from './payments';
import { now, earlier, orderId, recordId } from './providerEvents.fixtures';
import {
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
  extendedPayingUntil,
} from './providerEvents';

// Behaviours under test, one per decision, branch, or risk:
// - an unmatched event or a success waiting for the confirm step retries with backoff and a counted try; only the first
//   alerts on the 5th try; both give up with one alert on the last; alerts, intake statuses, ids, and lookups are decided here
// - paying_until moves to now plus grace and never earlier than it was

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
