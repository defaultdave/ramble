import { describe, expect, it } from 'vitest';
import { orderLimits } from './orders';
import { now, orderId, recordId, attempt } from './providerEvents.fixtures';
import {
  ProcessProviderEventPayloadSchema,
  eventAlertKey,
  isDeferredEventType,
  matchEventAttempt,
  orderEventsLockKey,
  payloadFacts,
  processEventDedupeKey,
  processProviderEventKind,
  providerEventRow,
  type IncomingProviderEvent,
} from './providerEvents';

// Behaviours under test, one per decision, branch, or risk:
// - the job kind is a hyphenated slug, its payload is one lower-cased uuid, and keys are lower-cased
// - refund, transfer, and dispute types are deferred; payment types are not
// - the stored row: metadata ids lower-cased into their columns, the body keeps fee, method, and failure code,
//   and an amount past the order limit, a time outside the readable years, or an oversize body is refused
// - matching: provider id first, then the record id, a record id whose attempt names another payment is "other",
//   and nothing matching is "none"

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
