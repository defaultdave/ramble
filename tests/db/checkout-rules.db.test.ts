import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import {
  holds,
  orders,
  paymentAttempts,
  sessions,
  settings,
} from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  endCheckoutSuite,
  checkoutReaders,
  proceeded,
  refused,
  resetCheckoutSettings,
  startCheckoutSuite,
  holdFor,
  ordersFor,
  type Bookable,
  type CheckoutSuite,
} from './checkoutFixtures';
import { day, insertSession, minute, seedBookable } from './holdFixtures';

// Which holds and orders the payment path accepts, against a real database. Behaviours under test:
// - a lapsed hold writes nothing: hold_expired with the spaces left and whether the party fits, or sold_out with
//   other dates; a cancelled session, a missing hold, another device's hold, and a gift hold are not told apart
// - two calls on one hold are one order and one attempt; once the provider's payment is stored the second call
//   hands it back as it is, even after the hold lapsed; a decline puts the order back to pending on the same attempt
// - a confirmed order answers already_confirmed with the order token for its device only, whatever the form held
// - five failed tries are too_many_tries; a canceled attempt with fewer gets the next number; an amount the
//   provider would refuse writes nothing

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let suite: CheckoutSuite;
let client: CheckoutSuite['client'];
let checkout: CheckoutSuite['checkout'];
let tokens: CheckoutSuite['tokens'];
let guestA: Device;
let guestB: Device;
let terms: CheckoutSuite['terms'];
let bookable: Bookable;

beforeAll(async () => {
  suite = await startCheckoutSuite();
  ({ client, checkout, tokens, guestA, guestB, terms, bookable } = suite);
});

afterAll(async () => {
  await endCheckoutSuite(suite);
});

beforeEach(async () => {
  await resetCheckoutSettings(client.db);
});

const { start, tally, storedHold, orderOf, attemptsOf } = checkoutReaders(
  () => ({ client, checkout, terms, guestA }),
);

describe('a hold that is not open', () => {
  const lapsed = async (
    device = guestA,
    over: Parameters<typeof holdFor>[3] = {},
  ) =>
    holdFor(client.db, await seedBookable(client.db), device, {
      createdAt: new Date(Date.now() - 20 * minute),
      ...over,
    });

  it('answers hold_expired with the spaces left and that the party can hold again, writing nothing', async () => {
    const open = await seedBookable(client.db, { allocation: 5 });
    const hold = await holdFor(client.db, open, guestA, {
      createdAt: new Date(Date.now() - 20 * minute),
    });
    const before = await tally();

    expect(refused(await start({}, hold.id))).toEqual({
      status: 'hold_expired',
      canRehold: true,
      spacesLeft: 5,
    });
    expect(await tally()).toEqual(before);
    expect((await storedHold(hold.id)).status).toBe('active');
  });

  it('counts other open holds and seats sold, and says when the party no longer fits', async () => {
    const small = await seedBookable(client.db, { allocation: 5 });
    await client.db
      .update(sessions)
      .set({ seatsSold: 1 })
      .where(eq(sessions.id, small.session.id));
    await holdFor(client.db, small, guestB, { adults: 3 });
    const hold = await holdFor(client.db, small, guestA, {
      adults: 2,
      createdAt: new Date(Date.now() - 20 * minute),
    });

    expect(refused(await start({}, hold.id))).toEqual({
      status: 'hold_expired',
      canRehold: false,
      spacesLeft: 1,
    });
  });

  it('judges a paying hold past its deadline lapsed', async () => {
    const hold = await lapsed(guestA, {
      status: 'paying',
      payingUntil: new Date(Date.now() - minute),
    });

    expect(refused(await start({}, hold.id)).status).toBe('hold_expired');
  });

  it('answers sold_out with other dates when no space is left', async () => {
    const full = await seedBookable(client.db, { allocation: 2 });
    const hold = await holdFor(client.db, full, guestA, {
      adults: 2,
      createdAt: new Date(Date.now() - 20 * minute),
    });
    await client.db
      .update(sessions)
      .set({ seatsSold: 2 })
      .where(eq(sessions.id, full.session.id));
    const other = await insertSession(client.db, full.experience.id, {
      startsAt: new Date(Date.now() + 9 * day),
      endsAt: new Date(Date.now() + 9 * day + 2 * 60 * minute),
      allocation: 4,
    });
    const before = await tally();

    const result = refused(await start({}, hold.id));

    expect(result).toEqual({
      status: 'sold_out',
      alternatives: [
        {
          sessionId: other.id,
          startsAt: other.startsAt.toISOString(),
          timeZone: 'America/New_York',
          spacesLeft: 4,
        },
      ],
    });
    expect(await tally()).toEqual(before);
  });

  it.each([
    ['a cancelled session', 'cancelled'],
    ['a completed session', 'completed'],
  ] as const)(
    'answers %s as expired with no re-hold',
    async (_name, status) => {
      const gone = await seedBookable(client.db);
      const hold = await holdFor(client.db, gone, guestA);
      await client.db
        .update(sessions)
        .set(
          status === 'cancelled'
            ? { status: 'cancelled', cancelReason: 'host' }
            : { status },
        )
        .where(eq(sessions.id, gone.session.id));
      const before = await tally();

      expect(refused(await start({}, hold.id))).toEqual({
        status: 'hold_expired',
        canRehold: false,
        spacesLeft: 0,
      });
      expect(await tally()).toEqual(before);
    },
  );
});

describe('a hold that is not the caller’s', () => {
  it('is answered exactly as a hold that does not exist, with nothing written', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const before = await tally();

    const missing = await start({}, '3f2504e0-4f89-41d3-9a0c-0305e82c3301');
    const stranger = await start({}, hold.id, guestB);
    const strangerWithBadForm = await start(
      { leadGuestName: 'Pat Smith' },
      hold.id,
      guestB,
    );

    expect(missing).toEqual({
      done: true,
      result: { status: 'hold_expired', canRehold: false, spacesLeft: 0 },
    });
    expect(stranger).toEqual(missing);
    expect(strangerWithBadForm).toEqual(missing);
    expect(await tally()).toEqual(before);
    expect((await storedHold(hold.id)).status).toBe('active');
  });

  it('is answered alike when the order is confirmed, and never hands out the reference or the token', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);
    const order = await orderOf(hold.id);
    await client.db
      .update(orders)
      .set({ status: 'confirmed', confirmedAt: sql`clock_timestamp()` })
      .where(eq(orders.id, order.id));
    await client.db
      .update(holds)
      .set({ status: 'converted' })
      .where(eq(holds.id, hold.id));

    const stranger = await start({}, hold.id, guestB);

    expect(stranger).toEqual({
      done: true,
      result: { status: 'hold_expired', canRehold: false, spacesLeft: 0 },
    });
  });

  it('is answered as expired for a gift redemption hold', async () => {
    const gift = await holdFor(client.db, bookable, guestA);
    await client.db.execute(
      sql`UPDATE holds SET purpose = 'gift_redemption', gift_id = gen_random_uuid() WHERE id = ${gift.id}`,
    );

    expect(refused(await start({}, gift.id)).status).toBe('hold_expired');
  });
});

describe('two calls on one hold', () => {
  it('make one order and one attempt, and the second finds the first', async () => {
    const hold = await holdFor(client.db, bookable, guestA);

    const first = proceeded(await start({}, hold.id));
    const second = proceeded(await start({}, hold.id));
    const order = await orderOf(hold.id);

    expect(second.order.id).toBe(first.order.id);
    expect(second.attempt.id).toBe(first.attempt.id);
    expect(first.attempt.existed).toBe(false);
    expect(second.attempt.existed).toBe(true);
    expect(await attemptsOf(order.id)).toHaveLength(1);
    expect(await ordersFor(client.db, hold.id)).toHaveLength(1);
  });

  it('hand back the stored provider payment as it is, even after the hold lapsed', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const first = proceeded(await start({}, hold.id));
    await checkout.recordProviderPayment(
      guestA,
      first.attempt.id,
      'pay_stored',
    );
    await client.db
      .update(holds)
      .set({
        status: 'paying',
        createdAt: new Date(Date.now() - 30 * minute),
        expiresAt: new Date(Date.now() - 20 * minute),
        payingUntil: new Date(Date.now() - minute),
      })
      .where(eq(holds.id, hold.id));

    const again = proceeded(await start({}, hold.id));

    expect(again.attempt).toMatchObject({
      id: first.attempt.id,
      providerPaymentId: 'pay_stored',
      existed: true,
    });
    expect(again.orderToken).toBe(first.orderToken);
  });

  it('after a decline, put the order back to pending on the same attempt and the hold back to paying', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const first = proceeded(await start({}, hold.id));
    await checkout.recordProviderPayment(
      guestA,
      first.attempt.id,
      'pay_declined',
    );
    const order = await orderOf(hold.id);
    await client.db
      .update(paymentAttempts)
      .set({
        status: 'failed_try',
        failedTries: 1,
        failureCode: 'card_declined',
      })
      .where(eq(paymentAttempts.id, first.attempt.id));
    await client.db
      .update(orders)
      .set({ status: 'payment_failed' })
      .where(eq(orders.id, order.id));
    await client.db
      .update(holds)
      .set({ status: 'active', payingUntil: null })
      .where(eq(holds.id, hold.id));

    const third = proceeded(await start({}, hold.id));

    expect(third.attempt).toMatchObject({
      id: first.attempt.id,
      providerPaymentId: 'pay_declined',
    });
    expect((await orderOf(hold.id)).status).toBe('pending_payment');
    expect((await storedHold(hold.id)).status).toBe('paying');
    expect(await attemptsOf(order.id)).toHaveLength(1);
  });

  it('resume an attempt whose provider payment was never stored, as an attempt that existed', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);

    const second = proceeded(await start({}, hold.id));

    expect(second.attempt).toMatchObject({
      providerPaymentId: null,
      existed: true,
    });
  });

  it('give an order whose attempt was canceled the next attempt number, keeping its amount', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const first = proceeded(await start({}, hold.id));
    const order = await orderOf(hold.id);
    await client.db
      .update(paymentAttempts)
      .set({ status: 'canceled', failedTries: 2, failureCode: 'card_declined' })
      .where(eq(paymentAttempts.id, first.attempt.id));
    await client.db.update(settings).set({ taxRatePpm: 0 });

    const next = proceeded(await start({}, hold.id));

    expect(next.attempt).toMatchObject({
      providerKey: `pay:${order.id}:2`,
      amountMinor: 10_888,
      existed: false,
    });
    expect(next.attempt.id).not.toBe(first.attempt.id);
    expect(await attemptsOf(order.id)).toHaveLength(2);
  });
});

describe('a confirmed order', () => {
  async function confirmed() {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);
    const order = await orderOf(hold.id);
    await client.db
      .update(orders)
      .set({ status: 'confirmed', confirmedAt: sql`clock_timestamp()` })
      .where(eq(orders.id, order.id));
    await client.db
      .update(holds)
      .set({ status: 'converted' })
      .where(eq(holds.id, hold.id));
    return { hold, order };
  }

  it('answers already_confirmed with the reference and the order token for the holding device', async () => {
    const { hold, order } = await confirmed();
    const before = await tally();

    const result = refused(await start({}, hold.id));

    expect(result).toEqual({
      status: 'already_confirmed',
      reference: order.reference,
      orderToken: tokens.capabilityToken('order', order.id, 1),
    });
    expect(await tally()).toEqual(before);
  });

  it('answers already_confirmed whatever the resubmitted form held', async () => {
    const { hold, order } = await confirmed();

    const result = refused(
      await start(
        {
          leadGuestName: 'Someone Else',
          termsDocumentId: terms.id.replace(/.$/, '0'),
        },
        hold.id,
      ),
    );

    expect(result.status).toBe('already_confirmed');
    expect((await orderOf(hold.id)).leadGuestName).toBe(order.leadGuestName);
  });
});

describe('failed tries', () => {
  it('answer too_many_tries at five on the attempt, writing nothing', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const first = proceeded(await start({}, hold.id));
    const order = await orderOf(hold.id);
    await client.db
      .update(paymentAttempts)
      .set({ status: 'canceled', failedTries: 5, failureCode: 'card_declined' })
      .where(eq(paymentAttempts.id, first.attempt.id));
    await client.db
      .update(orders)
      .set({ status: 'void' })
      .where(eq(orders.id, order.id));
    const before = await tally();

    expect(refused(await start({}, hold.id))).toEqual({
      status: 'too_many_tries',
    });
    expect(await tally()).toEqual(before);
  });

  it('answer too_many_tries for a live attempt at five, before returning its payment', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    const first = proceeded(await start({}, hold.id));
    await checkout.recordProviderPayment(guestA, first.attempt.id, 'pay_five');
    await client.db
      .update(paymentAttempts)
      .set({
        status: 'failed_try',
        failedTries: 5,
        failureCode: 'card_declined',
      })
      .where(eq(paymentAttempts.id, first.attempt.id));

    expect(refused(await start({}, hold.id)).status).toBe('too_many_tries');
  });
});
