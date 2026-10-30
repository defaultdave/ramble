import { describe, expect, it } from 'vitest';
import type { StartPaymentResult } from '../checkout';
import {
  alternativeRow,
  canSend,
  checkoutReducer,
  connectionFailedNotice,
  destination,
  expiredCopy,
  initialStep,
  paymentFromSecret,
  partyReserveInput,
  ReholdInputSchema,
  reholdRequest,
  reholdOutcome,
  soldOutCopy,
  type CheckoutStep,
  type ReholdResult,
} from './checkoutFlow';
import type { CheckoutView } from './checkoutPage';

// Behaviours under test:
// - paymentFromSecret: the id before `_secret_`, a malformed secret names no payment
// - checkoutReducer: each startPayment answer lands on its step; a failed request keeps the details;
//   the timer ends only a guest who is not paying; one request at a time
// - destination, reholdInput, copy for S6 and S7, the alternative rows

const view = {
  holdId: 'h1',
  sessionId: 's1',
  experience: {
    id: '0b8f6c4e-2d1a-4f33-9a77-5d1e3c9b7a10',
    slug: 'kayak',
    title: 'Kayak',
    hostName: 'Club',
  },
  startsAt: '2026-10-24T21:30:00.000Z',
  timeZone: 'America/New_York',
  guests: 2,
  party: [{ priceOptionId: 'p1', quantity: 2 }],
} as CheckoutView;

const uuid = '0b8f6c4e-2d1a-4f33-9a77-5d1e3c9b7a10';
const secret = 'fake_pay_abc123_secret_0123456789abcdef';

const payment: CheckoutStep = {
  step: 'payment',
  payment: { id: 'fake_pay_abc123', clientSecret: secret },
  amountDueMinor: 13_000,
  reference: 'RMB-ABC234',
  orderToken: 'tok',
  lost: false,
};

describe('paymentFromSecret', () => {
  it('reads the payment id before the marker', () => {
    expect(paymentFromSecret(secret)).toEqual({
      id: 'fake_pay_abc123',
      clientSecret: secret,
    });
  });

  it.each(['', 'nothing', '_secret_abc', 'pay_1_secret_'])(
    'names no payment for %j',
    (value) => {
      expect(paymentFromSecret(value)).toBeNull();
    },
  );
});

describe('checkoutReducer', () => {
  it('starts on the details, with no errors and nothing sent', () => {
    expect(initialStep).toEqual({
      step: 'details',
      errors: {},
      sending: false,
      notice: null,
    });
    expect(canSend(initialStep)).toBe(true);
  });

  it('allows one request at a time', () => {
    const sending = checkoutReducer(initialStep, { type: 'sending' });
    expect(sending).toMatchObject({ step: 'details', sending: true });
    expect(canSend(sending)).toBe(false);
    expect(canSend(payment)).toBe(false);
  });

  it('opens the payment form with the secret and the order token', () => {
    expect(
      checkoutReducer(initialStep, {
        type: 'answered',
        result: {
          status: 'requires_payment',
          orderId: 'o1',
          reference: 'RMB-ABC234',
          payment: { provider: 'fake', clientSecret: secret },
          amountDueMinor: 13_000,
          orderToken: 'tok',
        },
      }),
    ).toEqual(payment);
  });

  it('keeps the details and says so when the secret is not one', () => {
    expect(
      checkoutReducer(initialStep, {
        type: 'answered',
        result: {
          status: 'requires_payment',
          orderId: 'o1',
          reference: 'RMB-ABC234',
          payment: { provider: 'fake', clientSecret: 'broken' },
          amountDueMinor: 13_000,
        },
      }),
    ).toMatchObject({ step: 'details', notice: connectionFailedNotice });
  });

  it('shows the server field errors', () => {
    expect(
      checkoutReducer(
        { ...initialStep, sending: true },
        {
          type: 'answered',
          result: {
            status: 'invalid',
            fieldErrors: { 'contact.email': 'invalid' },
          },
        },
      ),
    ).toEqual({
      step: 'details',
      errors: { 'contact.email': 'invalid' },
      sending: false,
      notice: null,
    });
  });

  it.each([
    [
      { status: 'hold_expired', canRehold: true, spacesLeft: 6 } as const,
      { step: 'expired', canRehold: true, spacesLeft: 6 },
    ],
    [
      { status: 'sold_out', alternatives: [] } satisfies StartPaymentResult,
      { step: 'sold_out', alternatives: [] },
    ],
    [{ status: 'too_many_tries' } as const, { step: 'too_many_tries' }],
  ] as [StartPaymentResult, object][])(
    'moves to the step for %j',
    (result, expected) => {
      expect(
        checkoutReducer(initialStep, { type: 'answered', result }),
      ).toMatchObject(expected);
    },
  );

  it('keeps the details when the request itself fails', () => {
    expect(
      checkoutReducer(
        { ...initialStep, sending: true },
        { type: 'request_failed' },
      ),
    ).toEqual({
      step: 'details',
      errors: {},
      sending: false,
      notice: connectionFailedNotice,
    });
  });

  it('ends the hold on the details when the timer ends', () => {
    expect(checkoutReducer(initialStep, { type: 'timer_ended' })).toMatchObject(
      {
        step: 'expired',
        canRehold: null,
      },
    );
  });

  it('does not pull the form from a guest who is paying', () => {
    expect(checkoutReducer(payment, { type: 'timer_ended' })).toBe(payment);
  });

  it('marks the payment lost when the answer is lost, and only then', () => {
    expect(checkoutReducer(payment, { type: 'connection_lost' })).toMatchObject(
      {
        step: 'payment',
        lost: true,
      },
    );
    expect(checkoutReducer(initialStep, { type: 'connection_lost' })).toBe(
      initialStep,
    );
  });

  describe('holding again', () => {
    const expired = checkoutReducer(initialStep, { type: 'timer_ended' });

    it('locks the button while it waits', () => {
      expect(checkoutReducer(expired, { type: 'reholding' })).toMatchObject({
        reholding: true,
      });
    });

    it('goes to the other dates when the spaces are gone', () => {
      expect(
        checkoutReducer(expired, {
          type: 'rehold_answered',
          result: { status: 'sold_out', alternatives: [] },
        }),
      ).toEqual({ step: 'sold_out', alternatives: [] });
    });

    // One row per kind of answer the re-hold can refuse with. Before anything is released a retry
    // can work; after, the old hold is gone and the way forward is the experience page.
    it.each([
      [
        'try_later',
        { status: 'try_later' },
        true,
        /Try again in a little while/,
      ],
      ['unreachable', { status: 'unreachable' }, true, /try again/],
      [
        'blocked by the device limit',
        { status: 'blocked', reason: 'device_limit' },
        false,
        /most spaces one person can.*experience page/,
      ],
      [
        'blocked by the lapse block',
        { status: 'blocked', reason: 'too_many_holds' },
        false,
        /several times in a row.*experience page/,
      ],
      [
        'unavailable, bookings paused',
        { status: 'unavailable', reason: 'bookings_paused' },
        false,
        /paused.*experience page/,
      ],
      [
        'unavailable, session closed',
        { status: 'unavailable', reason: 'past' },
        false,
        /no longer open.*experience page/,
      ],
      [
        'invalid',
        { status: 'invalid', fieldErrors: { sessionId: 'invalid' } },
        false,
        /couldn't hold those spaces again.*experience page/,
      ],
    ] as [string, ReholdResult, boolean, RegExp][])(
      'says what is true when the answer is %s',
      (_name, result, canRetry, pattern) => {
        const next = checkoutReducer(
          checkoutReducer(expired, { type: 'reholding' }),
          { type: 'rehold_answered', result },
        );
        expect(next).toMatchObject({ step: 'expired', reholding: false });
        const step = next as Extract<CheckoutStep, { step: 'expired' }>;
        expect(step.notice).toMatch(pattern);
        expect(step.released).toBe(!canRetry);
        // A refusal after the release never offers a button that cannot work.
        expect(expiredCopy(view, step, 10).canRehold).toBe(canRetry);
        if (!canRetry) expect(step.notice).not.toMatch(/Try again/);
      },
    );
  });
});

describe('reholdOutcome', () => {
  it('words each answer once, with its retry rule', () => {
    expect(reholdOutcome({ status: 'try_later' }).canRehold).toBe(true);
    expect(reholdOutcome({ status: 'unreachable' }).canRehold).toBe(true);
    expect(
      reholdOutcome({ status: 'invalid', fieldErrors: {} }).canRehold,
    ).toBe(false);
  });
});

describe('destination and re-hold input', () => {
  it('goes to the confirmation with the order token', () => {
    expect(
      destination({
        status: 'already_confirmed',
        reference: 'RMB-ABC234',
        orderToken: 'a b',
      }),
    ).toBe('/orders/RMB-ABC234?t=a%20b');
  });

  it('goes to a new hold`s checkout', () => {
    expect(
      destination({
        status: 'held',
        holdId: 'h2',
        expiresAt: '2026-10-23T14:10:00.000Z',
        totalMinor: 0,
        lines: [],
      }),
    ).toBe('/checkout/h2?rehold=1');
  });

  it('goes nowhere for an answer that stays on the page', () => {
    expect(destination({ status: 'too_many_tries' })).toBeNull();
  });

  it('asks only for the lapsed hold to be held again', () => {
    expect(reholdRequest(view)).toEqual({ holdId: 'h1' });
  });

  it('refuses a re-hold request with anything but a hold id', () => {
    expect(ReholdInputSchema.safeParse({ holdId: uuid }).success).toBe(true);
    expect(
      ReholdInputSchema.safeParse({ holdId: 'x'.repeat(5000) }).success,
    ).toBe(false);
    expect(ReholdInputSchema.safeParse({}).success).toBe(false);
  });

  it('repeats the party from the page read for the new hold', () => {
    expect(partyReserveInput(view)).toEqual({
      sessionId: 's1',
      items: [{ priceOptionId: 'p1', quantity: 2 }],
      purpose: 'booking',
    });
  });
});

describe('copy', () => {
  const expired = (canRehold: boolean | null, spacesLeft: number | null) =>
    ({
      step: 'expired',
      canRehold,
      spacesLeft,
      reholding: false,
      released: false,
      notice: null,
    }) as Extract<CheckoutStep, { step: 'expired' }>;

  it('offers the spaces back when they are still there', () => {
    expect(expiredCopy(view, expired(true, 6), 10).body).toBe(
      'We released your spaces after 10 minutes. 5:30 PM still has 6 spaces, so you can hold them again and carry on.',
    );
  });

  it('says one space in the singular', () => {
    expect(expiredCopy(view, expired(true, 1), 10).body).toContain('1 space,');
  });

  it('does not promise spaces when the timer ran out first', () => {
    const copy = expiredCopy(view, expired(null, null), 10);
    expect(copy.canRehold).toBe(true);
    expect(copy.body).toContain('if they are still free');
  });

  it('says only that the hold ended after a refused re-hold', () => {
    const copy = expiredCopy(view, { ...expired(true, 6), released: true }, 10);
    expect(copy.body).toBe('We released your spaces after 10 minutes.');
    expect(copy.canRehold).toBe(false);
  });

  it('offers nothing when the party no longer fits', () => {
    const copy = expiredCopy(view, expired(false, 1), 10);
    expect(copy.canRehold).toBe(false);
    expect(copy.body).toContain('not room for your whole party');
  });

  it('words the sold-out state and the other dates heading', () => {
    expect(soldOutCopy(view)).toEqual({
      title: 'These spaces are gone',
      body: "Your hold ended and the last spaces for Sat, Oct 24 at 5:30 PM sold. You haven't been charged. Choose another date and enter your details again.",
      heading: 'Other dates for 2 guests',
    });
    expect(soldOutCopy({ ...view, guests: 1 }).heading).toBe(
      'Other dates for 1 guest',
    );
  });

  it('links an alternative to its day on the experience page', () => {
    expect(
      alternativeRow(view, {
        sessionId: 's2',
        startsAt: '2026-10-25T21:30:00.000Z',
        timeZone: 'America/New_York',
        spacesLeft: 2,
      }),
    ).toEqual({
      key: 's2',
      href: '/experiences/kayak-0b8f6c4e-2d1a-4f33-9a77-5d1e3c9b7a10?date=2026-10-25',
      label: 'Sun, Oct 25 · 5:30 PM',
      note: '2 left',
      tone: 'few-left',
    });
  });

  it('marks plenty of room as open', () => {
    expect(
      alternativeRow(view, {
        sessionId: 's3',
        startsAt: '2026-10-31T21:15:00.000Z',
        timeZone: 'America/New_York',
        spacesLeft: 10,
      }),
    ).toMatchObject({ note: '10 spaces', tone: 'open' });
  });
});
