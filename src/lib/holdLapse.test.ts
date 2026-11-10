import { describe, expect, it } from 'vitest';
import {
  LapseRefSchema,
  afterAttemptWrite,
  cancelErrorAction,
  liveAttemptStatuses,
  payingLapse,
  providerSettled,
} from './holdLapse';
import { at, later, otherUuid, uuid } from './holds.fixtures';
import { orderStatuses, type OrderStatus } from './orders';
import { attemptStatuses, type AttemptStatus } from './payments';

// Behaviours under test, one per decision, branch or risk:
// - only a `paying` hold past `paying_until` is lapsed: an open one (with a deadline equal to now counting as lapsed), an
//   active, converted, or released one is left alone, and a paying hold with no deadline is lapsed like `isOpenHold` says
// - a hold with no order is released with nothing to void or cancel
// - an order that is confirmed, cancelled, or refunded is left alone; a pending or failed order is voided, a void one is not voided again
// - an attempt that succeeded is left alone; none, or a cancelled one, needs no provider call
// - a live attempt is cancelled at the provider first, found by the stored id or by Ramble's ids when none was stored,
//   and is released only once that same attempt is the one the provider settled
// - the provider has settled when the payment is cancelled, or is missing for a lookup by Ramble's ids only
// - an error from the cancel is answered by reading the payment only for `invalid_state` and `not_found`; any other code, or an error with none, is rethrown
// - the attempt is written only while live: the live statuses are exactly the non-terminal ones, and the release goes on only when one row was written
// - the hold ref is two lower-cased uuids and nothing else

const order = (status: OrderStatus) => ({ id: otherUuid, status });
const attemptOf = (
  status: AttemptStatus,
  providerPaymentId: string | null = 'pay_1',
) => ({
  id: uuid,
  providerKey: `pay:${otherUuid}:1`,
  status,
  providerPaymentId,
});
const paying = (payingUntil: Date | null = later(-1)) => ({
  status: 'paying' as const,
  expiresAt: later(-60_000),
  payingUntil,
});

const lapse = (
  state: Partial<Parameters<typeof payingLapse>[0]> = {},
  settled: string | null = null,
  now = at,
) =>
  payingLapse(
    {
      hold: paying(),
      order: order('pending_payment'),
      attempt: attemptOf('created'),
      ...state,
    },
    now,
    settled,
  );

describe('payingLapse: which holds', () => {
  it.each([
    ['open', { hold: paying(later(1)) }],
    [
      'active',
      {
        hold: {
          status: 'active' as const,
          expiresAt: later(-1),
          payingUntil: null,
        },
      },
    ],
    ['converted', { hold: { ...paying(), status: 'converted' as const } }],
    ['released', { hold: { ...paying(), status: 'released' as const } }],
  ])('leaves a %s hold alone', (_name, state) => {
    expect(lapse(state)).toEqual({ kind: 'skip' });
  });

  it('counts a deadline equal to now as lapsed, and a paying hold with no deadline as lapsed', () => {
    expect(lapse({ hold: paying(at) }).kind).toBe('cancel_first');
    expect(lapse({ hold: paying(null) }).kind).toBe('cancel_first');
  });
});

describe('payingLapse: the order', () => {
  it('releases a hold that has no order, with nothing to void or cancel', () => {
    expect(lapse({ order: null, attempt: null })).toEqual({
      kind: 'release',
      voidOrderId: null,
      cancelAttempt: null,
    });
  });

  it.each(orderStatuses.filter((status) => status !== 'void'))(
    'a %s order is voided or left alone as its status allows',
    (status) => {
      const answer = lapse({ order: order(status), attempt: null });
      const voidable = ['pending_payment', 'payment_failed'].includes(status);
      expect(answer).toEqual(
        voidable
          ? { kind: 'release', voidOrderId: otherUuid, cancelAttempt: null }
          : { kind: 'skip' },
      );
    },
  );

  it('releases the hold of an order that is void already without voiding it again', () => {
    expect(lapse({ order: order('void'), attempt: null })).toEqual({
      kind: 'release',
      voidOrderId: null,
      cancelAttempt: null,
    });
  });
});

describe('payingLapse: the attempt', () => {
  it('leaves a hold whose attempt succeeded to confirmOrder', () => {
    expect(lapse({ attempt: attemptOf('succeeded') })).toEqual({
      kind: 'skip',
    });
  });

  it('needs no provider call for a cancelled attempt', () => {
    expect(lapse({ attempt: attemptOf('canceled') })).toEqual({
      kind: 'release',
      voidOrderId: otherUuid,
      cancelAttempt: null,
    });
  });

  it.each(attemptStatuses.filter((s) => s !== 'succeeded' && s !== 'canceled'))(
    'cancels a %s attempt at the provider by its stored payment, under a key of its own',
    (status) => {
      expect(lapse({ attempt: attemptOf(status) })).toEqual({
        kind: 'cancel_first',
        attemptId: uuid,
        idempotencyKey: `cancel:pay:${otherUuid}:1`,
        target: { kind: 'payment', paymentId: 'pay_1' },
      });
    },
  );

  it("looks for the payment by Ramble's ids when the attempt never stored one", () => {
    expect(lapse({ attempt: attemptOf('created', null) })).toMatchObject({
      kind: 'cancel_first',
      target: { kind: 'metadata', orderId: otherUuid, recordId: uuid },
    });
  });

  it('releases once the provider settled this attempt, cancelling the attempt and voiding the order', () => {
    expect(lapse({ attempt: attemptOf('requires_action') }, uuid)).toEqual({
      kind: 'release',
      voidOrderId: otherUuid,
      cancelAttempt: { id: uuid, from: 'requires_action' },
    });
  });

  it('cancels again when the provider settled another attempt', () => {
    expect(lapse({}, otherUuid).kind).toBe('cancel_first');
  });

  it('is judged again after the cancel: a hold that opened meanwhile is left alone', () => {
    expect(lapse({ hold: paying(later(1)) }, uuid)).toEqual({ kind: 'skip' });
  });
});

describe('providerSettled', () => {
  it.each([
    ['payment', 'canceled', true],
    ['payment', null, false],
    ['payment', 'processing', false],
    ['payment', 'succeeded', false],
    ['payment', 'created', false],
    ['metadata', 'canceled', true],
    ['metadata', null, true],
    ['metadata', 'succeeded', false],
    ['metadata', 'processing', false],
  ] as const)(
    'a lookup by %s that finds %s is settled: %s',
    (kind, status, settled) => {
      const target =
        kind === 'payment'
          ? ({ kind, paymentId: 'pay_1' } as const)
          : ({ kind, orderId: otherUuid, recordId: uuid } as const);
      expect(providerSettled(target, status)).toBe(settled);
    },
  );
});

describe('cancelErrorAction', () => {
  it.each([
    ['invalid_state', 'read'],
    ['not_found', 'read'],
    ['provider_unavailable', 'rethrow'],
    ['idempotency_conflict', 'rethrow'],
    ['invalid_input', 'rethrow'],
    [null, 'rethrow'],
  ] as const)('%s: %s', (code, action) => {
    expect(cancelErrorAction(code)).toBe(action);
  });
});

describe('the attempt write', () => {
  it('guards on exactly the live statuses', () => {
    expect(liveAttemptStatuses).toEqual([
      'created',
      'requires_action',
      'processing',
      'failed_try',
    ]);
  });

  it.each([
    [1, 'release'],
    [0, 'skip'],
    [2, 'skip'],
  ] as const)('%i rows written: %s', (rows, verdict) => {
    expect(afterAttemptWrite(rows)).toBe(verdict);
  });
});

describe('LapseRefSchema', () => {
  it('lower-cases both ids', () => {
    expect(
      LapseRefSchema.parse({
        holdId: uuid.toUpperCase(),
        sessionId: otherUuid.toUpperCase(),
      }),
    ).toEqual({ holdId: uuid, sessionId: otherUuid });
  });

  it.each([
    [{ holdId: 'nope', sessionId: otherUuid }],
    [{ holdId: uuid, sessionId: '' }],
    [{ holdId: uuid }],
  ])('refuses %j', (ref) => {
    expect(LapseRefSchema.safeParse(ref).success).toBe(false);
  });
});
