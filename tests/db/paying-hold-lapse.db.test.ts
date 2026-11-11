import { eq, inArray, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { holds, orders, paymentAttempts } from '@/server/db/schema';
import type { Device } from '@/server/device';
import { PaymentsError } from '@/server/ports/payments';
import {
  checkoutReaders,
  endCheckoutSuite,
  resetCheckoutSettings,
  startCheckoutSuite,
  type CheckoutSuite,
} from './checkoutFixtures';
import { raceAgainstOpenTransaction } from './harness';
import { payingLapseFixtures } from './payingLapseFixtures';
import { hash, insertHold, seedBookable } from './holdFixtures';

// The holds sweep for a `paying` hold past `paying_until`, against a real database and the fake provider.
// Behaviours under test, one per decision, branch or risk:
// - the sweep cancels the live attempt at the provider, marks the attempt cancelled, voids the order, and releases the hold as
//   payment_abandoned, and counts it; an attempt that never stored its payment is found by Ramble's ids and cancelled, and
//   one the provider has nothing for is released with no provider call that cancels anything
// - a hold still inside paying_until, a payment that succeeded at the provider, an attempt that succeeded, and a payment the
//   provider no longer has are all left as they were, and nothing is voided
// - a provider that is unavailable makes the sweep throw, and that hold, its order, and its attempt are left as they were
// - a cancel made earlier (by the sweep's own key, or by anything else) does not stop the release; a second sweep does nothing
//   and makes no second cancel; the sweep reads the payment first and never cancels one that is already cancelled or succeeded
// - the sweep's spaces tag is revalidated for a session whose paying hold it released, and not when it released nothing
// - a submit after the sweep is refused as hold_expired (the guest may hold again) or sold_out, writes nothing, and never
//   hands back the cancelled payment; before the sweep the same submit is handed the live payment (why the cancel matters)
// - the sweep judges again under the locks: a hold converted, or extended after the provider was asked, is left alone, and
//   a submit that waits for the sweep's locks answers hold_expired
// - the sweep racing a submit on one hold, over several rounds, ends in one release, one cancel, and no second attempt

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let suite: CheckoutSuite;
let client: CheckoutSuite['client'];
let holdData: typeof import('@/server/db/holds');
let lapseData: typeof import('@/server/db/ordersLapse');
let guestB: Device;
let read: ReturnType<typeof checkoutReaders>;

beforeAll(async () => {
  suite = await startCheckoutSuite();
  ({ client, guestB } = suite);
  holdData = await import('@/server/db/holds');
  lapseData = await import('@/server/db/ordersLapse');
  read = checkoutReaders(() => suite);
});

afterAll(() => endCheckoutSuite(suite));

beforeEach(async () => {
  await resetCheckoutSettings(client.db);
  // A hold an earlier test left lapsed and paying would be swept by this test's sweep.
  await client.db
    .update(holds)
    .set({ status: 'released', releasedReason: 'guest_left' })
    .where(inArray(holds.status, ['active', 'paying']));
  cache.revalidateTag.mockClear();
});

const { makePayments, lapsedPayingHold, state, use, submit } =
  payingLapseFixtures(() => suite);
type Payments = ReturnType<typeof makePayments>;

const sweep = (payments: Payments) => holdData.releaseLapsedHolds(payments);

describe('the sweep of a lapsed paying hold', () => {
  it('cancels the attempt at the provider, voids the order, and releases the hold as payment_abandoned', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );

    expect(await sweep(payments)).toBe(1);

    const after = await state(lapsed);
    expect(after.provider).toBe('canceled');
    expect(after.attempt).toMatchObject({ status: 'canceled' });
    expect(after.attempts).toHaveLength(1);
    expect(after.order.status).toBe('void');
    expect(after.hold).toMatchObject({
      status: 'released',
      releasedReason: 'payment_abandoned',
    });
    expect(after.hold.updatedAt.getTime()).toBeGreaterThan(
      after.hold.payingUntil?.getTime() ?? Infinity,
    );
  });

  it("finds a payment the attempt never stored by Ramble's ids, and cancels it", async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
      {
        storePayment: false,
      },
    );

    expect(await sweep(payments)).toBe(1);

    const after = await state(lapsed);
    expect(after.provider).toBe('canceled');
    expect(after.order.status).toBe('void');
    expect(after.attempt).toMatchObject({ status: 'canceled' });
    expect(after.hold.status).toBe('released');
  });

  it('releases a hold whose attempt has no payment at the provider, with nothing to cancel', async () => {
    const payments = use(makePayments());
    const cancel = vi.spyOn(payments, 'cancelPayment');
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
      {
        createPayment: false,
      },
    );

    expect(await sweep(payments)).toBe(1);

    expect(cancel).not.toHaveBeenCalled();
    const after = await state(lapsed);
    expect(after.order.status).toBe('void');
    expect(after.attempt).toMatchObject({ status: 'canceled' });
    expect(after.hold.releasedReason).toBe('payment_abandoned');
  });

  it('counts the paying and the expired holds of one session together', async () => {
    const payments = use(makePayments());
    const bookable = await seedBookable(client.db);
    await lapsedPayingHold(bookable, payments, { adults: 1 });
    await insertHold(client.db, bookable.session.id, {
      deviceKey: hash('c'),
      ipHash: hash('d'),
      createdAt: sql`now() - interval '30 minutes'`,
    });

    expect(await sweep(payments)).toBe(2);
  });

  it('does nothing the second time, and asks the provider once', async () => {
    const payments = use(makePayments());
    const cancel = vi.spyOn(payments, 'cancelPayment');
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await sweep(payments);
    const once = await state(lapsed);

    expect(await sweep(payments)).toBe(0);

    expect(await state(lapsed)).toEqual(once);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('revalidates the spaces tag of the session it released a paying hold in, and not when it released nothing', async () => {
    const payments = use(makePayments());
    const bookable = await seedBookable(client.db);
    await lapsedPayingHold(bookable, payments);

    await sweep(payments);
    expect(cache.revalidateTag).toHaveBeenCalledWith(
      `session:${bookable.session.id}`,
      'max',
    );

    cache.revalidateTag.mockClear();
    await sweep(payments);
    expect(cache.revalidateTag).not.toHaveBeenCalled();
  });
});

describe('what the sweep leaves alone', () => {
  it('a hold still inside paying_until, with its live payment', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await client.db
      .update(holds)
      .set({ payingUntil: sql`now() + interval '5 minutes'` })
      .where(eq(holds.id, lapsed.hold.id));

    expect(await sweep(payments)).toBe(0);

    const after = await state(lapsed);
    expect(after.provider).toBe('created');
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
    expect(after.attempt).toMatchObject({ status: 'created' });
  });

  it('a payment that succeeded at the provider: confirmOrder is on its way, so nothing is voided or released', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await payments.confirm(lapsed.payment?.id ?? '', { outcome: 'succeeded' });
    const cancel = vi.spyOn(payments, 'cancelPayment');

    expect(await sweep(payments)).toBe(0);

    expect(cancel).not.toHaveBeenCalled();

    const after = await state(lapsed);
    expect(after.provider).toBe('succeeded');
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
    expect(after.attempt).toMatchObject({ status: 'created' });
  });

  it('an attempt that succeeded here already', async () => {
    const payments = use(makePayments());
    const cancel = vi.spyOn(payments, 'cancelPayment');
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await client.db
      .update(paymentAttempts)
      .set({ status: 'succeeded' })
      .where(eq(paymentAttempts.orderId, lapsed.started.order.id));

    expect(await sweep(payments)).toBe(0);

    expect(cancel).not.toHaveBeenCalled();
    expect((await state(lapsed)).hold.status).toBe('paying');
    expect((await state(lapsed)).order.status).toBe('pending_payment');
  });

  it('a stored payment the provider no longer has', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
      {
        createPayment: false,
      },
    );
    await client.db
      .update(paymentAttempts)
      .set({ providerPaymentId: 'pay_gone_from_provider' })
      .where(eq(paymentAttempts.orderId, lapsed.started.order.id));

    expect(await sweep(payments)).toBe(0);

    const after = await state(lapsed);
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
    expect(after.attempt).toMatchObject({ status: 'created' });
  });

  it('a paying hold of a confirmed order', async () => {
    const payments = use(makePayments());
    const cancel = vi.spyOn(payments, 'cancelPayment');
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await client.db
      .update(orders)
      .set({ status: 'confirmed', confirmedAt: new Date() })
      .where(eq(orders.id, lapsed.started.order.id));

    expect(await sweep(payments)).toBe(0);

    expect(cancel).not.toHaveBeenCalled();
    expect((await state(lapsed)).hold.status).toBe('paying');
  });

  it('the hold, order, and attempt, when the provider is unavailable: the sweep throws and they stay as they were', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    vi.spyOn(payments, 'cancelPayment').mockRejectedValue(
      new PaymentsError('provider_unavailable'),
    );

    await expect(sweep(payments)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });

    const after = await state(lapsed);
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
    expect(after.attempt).toMatchObject({ status: 'created' });
  });
});

describe('a cancel that was made before the sweep got to it', () => {
  it("under the sweep's own key (a crash after the provider answered): the payment is read as cancelled, no second cancel is made, and the hold is released", async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await payments.cancelPayment({
      idempotencyKey: `cancel:${lapsed.started.attempt.providerKey}`,
      paymentId: lapsed.payment?.id ?? '',
    });
    const cancel = vi.spyOn(payments, 'cancelPayment');

    expect(await sweep(payments)).toBe(1);

    expect(cancel).not.toHaveBeenCalled();

    const after = await state(lapsed);
    expect(after.order.status).toBe('void');
    expect(after.hold.releasedReason).toBe('payment_abandoned');
  });

  it('by anything else: the payment is read as cancelled, no second cancel is made, and the hold is released', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    await payments.cancelPayment({
      idempotencyKey: 'cancel:elsewhere',
      paymentId: lapsed.payment?.id ?? '',
    });
    const cancel = vi.spyOn(payments, 'cancelPayment');

    expect(await sweep(payments)).toBe(1);

    expect(cancel).not.toHaveBeenCalled();

    const after = await state(lapsed);
    expect(after.order.status).toBe('void');
    expect(after.attempt).toMatchObject({ status: 'canceled' });
    expect(after.hold.status).toBe('released');
  });
});

describe('a submit after the sweep', () => {
  it('is handed the live payment before the sweep, and is refused as hold_expired after it, writing nothing', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );

    const before = await submit(lapsed);
    expect(before).toMatchObject({
      done: false,
      attempt: { id: lapsed.started.attempt.id, existed: true },
    });

    await sweep(payments);
    const tally = await read.tally();
    const stored = await state(lapsed);

    expect(await submit(lapsed)).toEqual({
      done: true,
      result: { status: 'hold_expired', canRehold: true, spacesLeft: 10 },
    });
    expect(await read.tally()).toEqual(tally);
    expect(await state(lapsed)).toEqual(stored);
    expect(stored.provider).toBe('canceled');
    expect(stored.order.status).toBe('void');
  });

  it('is sold_out when another guest took the spaces after the sweep, and still writes nothing', async () => {
    const payments = use(makePayments());
    const bookable = await seedBookable(client.db, { allocation: 2 });
    const lapsed = await lapsedPayingHold(bookable, payments);
    await sweep(payments);
    await insertHold(client.db, bookable.session.id, {
      deviceKey: guestB.deviceKey,
      ipHash: guestB.ipHash,
      seats: 2,
    });
    const tally = await read.tally();

    expect(await submit(lapsed)).toEqual({
      done: true,
      result: { status: 'sold_out', alternatives: [] },
    });
    expect(await read.tally()).toEqual(tally);
  });
});

describe('the sweep judges again under the locks', () => {
  const inTransaction = (
    body: (
      tx: Parameters<Parameters<typeof client.db.transaction>[0]>[0],
    ) => Promise<void>,
  ) => client.db.transaction(body);

  it('waits for the session lock before it looks at the hold, then releases it', async () => {
    const payments = use(makePayments());
    const bookable = await seedBookable(client.db);
    const lapsed = await lapsedPayingHold(bookable, payments);
    const locks = await import('@/server/db/locks');

    const released = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockSessionRow(tx, bookable.session.id);
      },
      () =>
        lapseData.abandonPayingHold(payments, {
          holdId: lapsed.hold.id,
          sessionId: bookable.session.id,
        }),
    );

    expect(released).toBe(true);
    expect((await state(lapsed)).hold.status).toBe('released');
  });

  it('leaves a hold alone that was converted while it waited for the session lock, and asks the provider nothing', async () => {
    const payments = use(makePayments());
    const cancel = vi.spyOn(payments, 'cancelPayment');
    const bookable = await seedBookable(client.db);
    const lapsed = await lapsedPayingHold(bookable, payments);
    const locks = await import('@/server/db/locks');

    const released = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockSessionRow(tx, bookable.session.id);
        await tx
          .update(holds)
          .set({ status: 'converted' })
          .where(eq(holds.id, lapsed.hold.id));
        await tx
          .update(orders)
          .set({ status: 'confirmed', confirmedAt: new Date() })
          .where(eq(orders.id, lapsed.started.order.id));
      },
      () =>
        lapseData.abandonPayingHold(payments, {
          holdId: lapsed.hold.id,
          sessionId: bookable.session.id,
        }),
    );

    expect(released).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect((await state(lapsed)).hold.status).toBe('converted');
    expect((await state(lapsed)).order.status).toBe('confirmed');
  });

  it('leaves a hold alone that was extended while the provider was being asked (the provider cancel stands)', async () => {
    const payments = use(makePayments());
    const lapsed = await lapsedPayingHold(
      await seedBookable(client.db),
      payments,
    );
    const cancel = payments.cancelPayment.bind(payments);
    vi.spyOn(payments, 'cancelPayment').mockImplementation(async (input) => {
      const cancelled = await cancel(input);
      await client.db
        .update(holds)
        .set({ payingUntil: sql`now() + interval '5 minutes'` })
        .where(eq(holds.id, lapsed.hold.id));
      return cancelled;
    });

    expect(await sweep(payments)).toBe(0);

    const after = await state(lapsed);
    expect(after.provider).toBe('canceled');
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
  });

  it('makes a submit wait for the sweep, and the submit then answers hold_expired with no second attempt', async () => {
    const payments = use(makePayments());
    const bookable = await seedBookable(client.db);
    const lapsed = await lapsedPayingHold(bookable, payments);
    const locks = await import('@/server/db/locks');

    const answer = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockSessionRow(tx, bookable.session.id);
        await locks.lockHoldRow(tx, lapsed.hold.id);
        await locks.lockOrderRow(tx, `book:${lapsed.hold.id}`);
        await tx
          .update(paymentAttempts)
          .set({ status: 'canceled' })
          .where(eq(paymentAttempts.orderId, lapsed.started.order.id));
        await tx
          .update(orders)
          .set({ status: 'void' })
          .where(eq(orders.id, lapsed.started.order.id));
        await tx
          .update(holds)
          .set({ status: 'released', releasedReason: 'payment_abandoned' })
          .where(eq(holds.id, lapsed.hold.id));
      },
      () => submit(lapsed),
    );

    expect(answer).toEqual({
      done: true,
      result: { status: 'hold_expired', canRehold: true, spacesLeft: 10 },
    });
    expect(await read.attemptsOf(lapsed.started.order.id)).toHaveLength(1);
  });

  it.each([1, 2, 3, 4, 5])(
    'round %i: the sweep and a submit on one lapsed hold at once end in one release, one cancel, and no second attempt',
    async () => {
      const payments = use(makePayments());
      const cancel = vi.spyOn(payments, 'cancelPayment');
      const lapsed = await lapsedPayingHold(
        await seedBookable(client.db),
        payments,
      );

      const [swept, answer] = await Promise.all([
        sweep(payments),
        submit(lapsed),
      ]);

      expect(swept).toBe(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      const settled = await state(lapsed);
      expect(settled.hold).toMatchObject({
        status: 'released',
        releasedReason: 'payment_abandoned',
      });
      expect(settled.order.status).toBe('void');
      expect(settled.attempts).toHaveLength(1);
      expect(settled.provider).toBe('canceled');
      expect(
        answer.done ? answer.result.status : `in_flight:${answer.attempt.id}`,
      ).toBe(
        answer.done ? 'hold_expired' : `in_flight:${lapsed.started.attempt.id}`,
      );
    },
  );
});
