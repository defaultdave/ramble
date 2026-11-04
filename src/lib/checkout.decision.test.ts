import { describe, expect, it } from 'vitest';
import {
  lapsedOutcome,
  providerStep,
  startPaymentDecision,
  storeProviderPayment,
  lookupVerdict,
  storesPayment,
  tooManyTries,
  unknownHold,
  type DecisionState,
} from './checkout';
import { maxFailedTries, paymentLimits } from './payments';
import { at, minutesFrom } from './testClock';
import { holdId, sessionId } from './checkout.fixtures';

// - a new reference is RMB- and six Crockford characters; a bad random source is refused
// - the decision, in order: unknown hold (missing, another device's, a gift hold, moved session, cancelled
//   order); confirmed; invalid form; five failed tries; a payment in flight (even on a lapsed hold, and a
//   succeeded one); a session that cannot be booked; a lapsed hold; an amount the provider refuses; resume,
//   next attempt, create; the attempt cap
// - a lapsed hold is sold out with no spaces left, and otherwise expired with re-hold only when the party fits
// - the provider is asked by what is known of the attempt; a payment id is stored once, while live

const baseHold = {
  deviceKey: 'a'.repeat(64),
  sessionId,
  purpose: 'booking' as const,
  status: 'active' as const,
  seats: 2,
  expiresAt: minutesFrom(5),
  payingUntil: null,
};

const baseState = (change: Partial<DecisionState> = {}): DecisionState => ({
  deviceKey: 'a'.repeat(64),
  readSessionId: sessionId,
  hold: baseHold,
  subject: {
    experienceStatus: 'live',
    sessionStatus: 'scheduled',
    startsAt: minutesFrom(60 * 24),
  },
  order: null,
  latestAttempt: null,
  issues: {},
  amountDueMinor: 22_864,
  chargeLimits: { minMinor: 50, maxMinor: 99_999_999 },
  at,
  ...change,
});

const attempt = (change: object = {}) => ({
  id: 'c9bf9e57-1685-4c89-bafb-ff5af830be8a',
  attemptNo: 1,
  status: 'created' as const,
  failedTries: 0,
  providerPaymentId: null,
  ...change,
});

describe('the decision', () => {
  it.each([
    ['a missing hold', { hold: null }],
    ['another device', { deviceKey: 'b'.repeat(64) }],
    [
      'a gift redemption hold',
      { hold: { ...baseHold, purpose: 'gift_redemption' as const } },
    ],
    [
      'a hold that moved to another session',
      { hold: { ...baseHold, sessionId: holdId } },
    ],
    ['a missing session', { subject: null }],
    ['a cancelled order', { order: { status: 'cancelled' as const } }],
    [
      'a refunded order',
      { order: { status: 'refunded_after_lapse' as const } },
    ],
  ])('answers %s as an expired hold with no re-hold', (_name, change) => {
    expect(startPaymentDecision(baseState(change))).toEqual({
      kind: 'refuse',
      result: unknownHold,
    });
  });

  it('answers another device exactly as a missing hold, whatever else is true', () => {
    const missing = startPaymentDecision(baseState({ hold: null }));
    const stranger = startPaymentDecision(
      baseState({
        deviceKey: 'b'.repeat(64),
        order: { status: 'confirmed' },
        issues: { leadGuestName: 'invalid' },
      }),
    );

    expect(stranger).toEqual(missing);
  });

  it('answers a confirmed order as confirmed, whatever the form held and the hold became', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'confirmed' },
          hold: { ...baseHold, status: 'converted' },
          issues: { leadGuestName: 'invalid' },
          latestAttempt: attempt({ status: 'succeeded', failedTries: 5 }),
        }),
      ),
    ).toEqual({ kind: 'already_confirmed' });
  });

  it('refuses a form with issues and keeps its field errors', () => {
    expect(
      startPaymentDecision(
        baseState({ issues: { termsDocumentId: 'invalid' } }),
      ),
    ).toEqual({
      kind: 'refuse',
      result: {
        status: 'invalid',
        fieldErrors: { termsDocumentId: 'invalid' },
      },
    });
  });

  it('answers too many tries at the failed-try limit and passes one below it', () => {
    const decide = (failedTries: number) =>
      startPaymentDecision(
        baseState({
          order: { status: 'payment_failed' },
          latestAttempt: attempt({ status: 'failed_try', failedTries }),
        }),
      );

    expect(decide(maxFailedTries)).toEqual({
      kind: 'refuse',
      result: tooManyTries,
    });
    expect(decide(maxFailedTries - 1).kind).toBe('resume');
  });

  it('answers too many tries for a cancelled attempt that used them up', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'void' },
          latestAttempt: attempt({ status: 'canceled', failedTries: 5 }),
        }),
      ),
    ).toEqual({ kind: 'refuse', result: tooManyTries });
  });

  it.each([
    ['a created attempt', 'created'],
    ['a failed try', 'failed_try'],
    ['a processing attempt', 'processing'],
    ['an attempt that succeeded and awaits confirmation', 'succeeded'],
  ] as const)(
    'returns %s that has a provider payment as it is',
    (_name, status) => {
      expect(
        startPaymentDecision(
          baseState({
            order: { status: 'pending_payment' },
            latestAttempt: attempt({ status, providerPaymentId: 'pay_1' }),
          }),
        ),
      ).toEqual({
        kind: 'in_flight',
        attemptId: attempt().id,
        providerPaymentId: 'pay_1',
      });
    },
  );

  it('returns a payment in flight even after the hold lapsed', () => {
    expect(
      startPaymentDecision(
        baseState({
          hold: { ...baseHold, status: 'paying', payingUntil: minutesFrom(-1) },
          order: { status: 'pending_payment' },
          latestAttempt: attempt({ providerPaymentId: 'pay_1' }),
        }),
      ).kind,
    ).toBe('in_flight');
  });

  it('refuses an attempt that succeeded with no provider payment recorded', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'pending_payment' },
          latestAttempt: attempt({ status: 'succeeded' }),
        }),
      ),
    ).toEqual({ kind: 'refuse', result: unknownHold });
  });

  it.each([
    ['a cancelled session', { sessionStatus: 'cancelled' as const }],
    ['a session that has started', { startsAt: minutesFrom(-1) }],
    [
      'an experience that is no longer live',
      { experienceStatus: 'paused' as const },
    ],
  ])('answers %s as expired with no re-hold', (_name, subject) => {
    expect(
      startPaymentDecision(
        baseState({
          subject: {
            experienceStatus: 'live',
            sessionStatus: 'scheduled',
            startsAt: minutesFrom(60),
            ...subject,
          },
        }),
      ),
    ).toEqual({ kind: 'refuse', result: unknownHold });
  });

  it.each([
    [
      'an active hold past its expiry',
      { status: 'active' as const, expiresAt: minutesFrom(-1) },
    ],
    [
      'an active hold expiring now',
      { status: 'active' as const, expiresAt: at },
    ],
    [
      'a paying hold past its deadline',
      {
        status: 'paying' as const,
        expiresAt: minutesFrom(-9),
        payingUntil: minutesFrom(-1),
      },
    ],
    ['a released hold', { status: 'released' as const }],
    [
      'a converted hold with no confirmed order',
      { status: 'converted' as const },
    ],
  ])('judges %s lapsed', (_name, hold) => {
    expect(
      startPaymentDecision(baseState({ hold: { ...baseHold, ...hold } })),
    ).toEqual({ kind: 'lapsed' });
  });

  it('keeps an active hold open until its expiry and a paying one until its deadline', () => {
    expect(startPaymentDecision(baseState()).kind).toBe('create');
    expect(
      startPaymentDecision(
        baseState({
          hold: {
            ...baseHold,
            status: 'paying',
            expiresAt: minutesFrom(-3),
            payingUntil: minutesFrom(2),
          },
        }),
      ).kind,
    ).toBe('create');
  });

  it.each([
    ['below the provider minimum', 49],
    ['nothing at all', 0],
    ['above the provider maximum', 100_000_000],
  ])('refuses an amount of %s without writing', (_name, amountDueMinor) => {
    expect(startPaymentDecision(baseState({ amountDueMinor }))).toEqual({
      kind: 'refuse',
      result: { status: 'invalid', fieldErrors: { holdId: 'not_payable' } },
    });
  });

  it('accepts an amount at the provider limits', () => {
    expect(startPaymentDecision(baseState({ amountDueMinor: 50 })).kind).toBe(
      'create',
    );
    expect(
      startPaymentDecision(baseState({ amountDueMinor: 99_999_999 })).kind,
    ).toBe('create');
  });

  it('creates the order for a hold with none', () => {
    expect(startPaymentDecision(baseState())).toEqual({
      kind: 'create',
      attemptNo: 1,
    });
  });

  it('resumes a live attempt that has no provider payment yet', () => {
    expect(
      startPaymentDecision(
        baseState({
          order: { status: 'pending_payment' },
          latestAttempt: attempt(),
        }),
      ),
    ).toEqual({ kind: 'resume', attemptId: attempt().id });
  });

  it.each(['pending_payment', 'payment_failed', 'void'] as const)(
    'gives a %s order with only a cancelled attempt the next attempt number',
    (status) => {
      expect(
        startPaymentDecision(
          baseState({
            order: { status },
            latestAttempt: attempt({
              status: 'canceled',
              attemptNo: 2,
              failedTries: 1,
              providerPaymentId: 'pay_1',
            }),
          }),
        ),
      ).toEqual({ kind: 'next_attempt', attemptNo: 3 });
    },
  );

  it('gives an order with no attempt yet the first', () => {
    expect(
      startPaymentDecision(baseState({ order: { status: 'pending_payment' } })),
    ).toEqual({ kind: 'next_attempt', attemptNo: 1 });
  });

  it('stops at the attempt cap', () => {
    const last = paymentLimits.maxAttemptNo;
    const decide = (attemptNo: number) =>
      startPaymentDecision(
        baseState({
          order: { status: 'void' },
          latestAttempt: attempt({ status: 'canceled', attemptNo }),
        }),
      );

    expect(decide(last)).toEqual({ kind: 'refuse', result: tooManyTries });
    expect(decide(last - 1)).toEqual({ kind: 'next_attempt', attemptNo: last });
  });
});

describe('what a lapsed hold answers', () => {
  it.each([
    ['nothing left', 2, 0, { kind: 'sold_out' }],
    [
      'less than nothing left after a lowered capacity',
      2,
      -3,
      { kind: 'sold_out' },
    ],
    [
      'fewer spaces than the party',
      3,
      2,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: false, spacesLeft: 2 },
      },
    ],
    [
      'exactly the party',
      2,
      2,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: true, spacesLeft: 2 },
      },
    ],
    [
      'more than the party',
      1,
      5,
      {
        kind: 'result',
        result: { status: 'hold_expired', canRehold: true, spacesLeft: 5 },
      },
    ],
  ])('%s', (_name, seats, left, expected) => {
    expect(lapsedOutcome(seats, left)).toEqual(expected);
  });
});

describe('the provider step', () => {
  it.each([
    [
      'reads a payment the attempt already has',
      { providerPaymentId: 'pay_1', existed: true },
      { step: 'retrieve', paymentId: 'pay_1' },
    ],
    [
      'looks an earlier call’s attempt up by Ramble’s ids before creating',
      { providerPaymentId: null, existed: true },
      { step: 'find_or_create' },
    ],
    [
      'creates for an attempt made in this call',
      { providerPaymentId: null, existed: false },
      { step: 'create' },
    ],
  ])('%s', (_name, known, expected) => {
    expect(providerStep(known)).toEqual(expected);
  });

  it.each([
    [
      'stores the first id on a live attempt',
      'created',
      null,
      'pay_1',
      'write',
    ],
    [
      'stores on an attempt that failed a try',
      'failed_try',
      null,
      'pay_1',
      'write',
    ],
    [
      'treats the same id again as stored',
      'created',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    [
      'treats the same id on a finished attempt as stored',
      'succeeded',
      'pay_1',
      'pay_1',
      'repeat',
    ],
    ['never replaces a different id', 'created', 'pay_1', 'pay_2', 'refuse'],
    [
      'never writes to a succeeded attempt',
      'succeeded',
      null,
      'pay_1',
      'refuse',
    ],
    ['never writes to a canceled attempt', 'canceled', null, 'pay_1', 'refuse'],
  ] as const)('%s', (_name, status, stored, paymentId, expected) => {
    expect(
      storeProviderPayment({ status, providerPaymentId: stored }, paymentId),
    ).toEqual(
      {
        write: { write: true, stored: true },
        repeat: { write: false, stored: true },
        refuse: { write: false, stored: false },
      }[expected],
    );
  });

  it.each([
    [
      'a payment found by id is used',
      { step: 'retrieve', paymentId: 'p' },
      true,
      'use',
    ],
    [
      'a payment found by Ramble’s ids is used',
      { step: 'find_or_create' },
      true,
      'use',
    ],
    [
      'a stored payment the provider lost is refused',
      { step: 'retrieve', paymentId: 'p' },
      false,
      'refuse',
    ],
    [
      'an earlier attempt with no provider payment creates one',
      { step: 'find_or_create' },
      false,
      'create',
    ],
    ['a new attempt creates one', { step: 'create' }, false, 'create'],
  ] as const)('%s', (_name, step, found, expected) => {
    expect(lookupVerdict(step, found)).toBe(expected);
  });

  it('writes the payment id only for a payment the attempt did not hold', () => {
    expect(storesPayment({ step: 'retrieve', paymentId: 'p' })).toBe(false);
    expect(storesPayment({ step: 'find_or_create' })).toBe(true);
    expect(storesPayment({ step: 'create' })).toBe(true);
  });
});
