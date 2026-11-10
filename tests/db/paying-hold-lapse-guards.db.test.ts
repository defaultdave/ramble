import { randomUUID } from 'node:crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { ZodError } from 'zod';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { attemptProviderKey } from '@/lib/payments';
import { holds, orders, paymentAttempts } from '@/server/db/schema';
import { PaymentsError } from '@/server/ports/payments';
import {
  endCheckoutSuite,
  resetCheckoutSettings,
  startCheckoutSuite,
  type CheckoutSuite,
} from './checkoutFixtures';
import { raceAgainstOpenTransaction } from './harness';
import { insertHold, seedBookable } from './holdFixtures';
import { payingLapseFixtures } from './payingLapseFixtures';

// What the paying-hold sweep writes and passes on, against a real database and the fake provider.
// Behaviours under test, one per decision, branch or risk:
// - only the order's latest attempt is cancelled: an older attempt of the same order keeps its status and time
// - the cancel carries the key derived from the attempt's own key, and the same key again on the sweep after a provider error
// - a hold that needs no provider call (no order, or a void order with a cancelled attempt) is released and counted
// - two lapsed paying holds in one session are both released and counted
// - the sweep hands each hold's own id and its own session id to the lapse step
// - the attempt row is not locked, so its cancel is written only while the attempt is live: one that succeeded after it
//   was read is not overwritten, and the hold, order, and attempt stay as the payment event left them
// - a hold that is not there is not released, and asks the provider nothing; a ref that is not two uuids is refused by the parse
// - an error from the cancel that is not the port's is rethrown, and leaves the hold, order, and attempt as they were
// - the sweep waits for the hold row and for the order row, and judges what the other transaction committed
// - a cancel that fails, for any reason, rejects with nothing written, and the next sweep reads the payment again: succeeded is left alone, cancelled is settled with no second cancel
// - a pulse run, with the real sweep and the fake gateway, voids and releases a lapsed paying hold end to end

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
const sendHeartbeat = vi.hoisted(() => vi.fn());
const log = vi.hoisted(() => ({
  warn: vi.fn(),
  info: vi.fn(),
  error: vi.fn(),
}));
vi.mock('@/server/monitoring/logger', () => ({ logger: log }));
vi.mock('next/cache', () => cache);
vi.mock('@/server/monitoring/heartbeat', () => ({ sendHeartbeat }));
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);
vi.mock('@/server/db/ordersLapse', async (original) => {
  const real = await original<typeof import('@/server/db/ordersLapse')>();
  return { ...real, abandonPayingHold: vi.fn(real.abandonPayingHold) };
});

const pulseSecret = 'q'.repeat(40);
let suite: CheckoutSuite;
let client: CheckoutSuite['client'];
let holdData: typeof import('@/server/db/holds');
let lapseData: typeof import('@/server/db/ordersLapse');
let gateway: typeof import('@/server/ports/payments/gateway');
let pulse: typeof import('@/server/pulse');
let fixtures: ReturnType<typeof payingLapseFixtures>;

beforeAll(async () => {
  vi.stubEnv('PULSE_SECRET', pulseSecret);
  suite = await startCheckoutSuite();
  client = suite.client;
  holdData = await import('@/server/db/holds');
  lapseData = await import('@/server/db/ordersLapse');
  gateway = await import('@/server/ports/payments/gateway');
  pulse = await import('@/server/pulse');
  fixtures = payingLapseFixtures(() => suite);
});

afterAll(() => endCheckoutSuite(suite));

beforeEach(async () => {
  await resetCheckoutSettings(client.db);
  await client.db
    .update(holds)
    .set({ status: 'released', releasedReason: 'guest_left' })
    .where(inArray(holds.status, ['active', 'paying']));
  sendHeartbeat.mockReset().mockResolvedValue('sent');
  vi.mocked(lapseData.abandonPayingHold).mockClear();
});

const payments = () => fixtures.use(fixtures.makePayments());
const sweep = (port: ReturnType<typeof fixtures.makePayments>) =>
  holdData.releaseLapsedHolds(port);

describe('the attempt the sweep cancels', () => {
  it("is the order's latest only: an older attempt keeps its status and time", async () => {
    const port = payments();
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    const orderId = lapsed.started.order.id;
    const [older] = await client.db
      .update(paymentAttempts)
      .set({ status: 'succeeded' })
      .where(eq(paymentAttempts.id, lapsed.started.attempt.id))
      .returning();
    const newerKey = attemptProviderKey(orderId, 2);
    const payment = await port.createPayment({
      idempotencyKey: newerKey,
      amountMinor: lapsed.started.attempt.amountMinor,
      currency: 'USD',
      metadata: { orderId, recordId: orderId },
    });
    const [newer] = await client.db
      .insert(paymentAttempts)
      .values({
        orderId,
        attemptNo: 2,
        provider: 'fake',
        providerKey: newerKey,
        amountMinor: lapsed.started.attempt.amountMinor,
        providerPaymentId: payment.id,
      })
      .returning();

    expect(await sweep(port)).toBe(1);

    const attempts = await fixtures.read.attemptsOf(orderId);
    expect(attempts.map(({ status }) => status)).toEqual([
      'succeeded',
      'canceled',
    ]);
    expect(attempts[0]?.updatedAt).toEqual(older?.updatedAt);
    expect(attempts[1]?.id).toBe(newer?.id);
  });

  it('is cancelled under the key derived from its own, and under the same key on the sweep after a provider error', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    const key = `cancel:${lapsed.started.attempt.providerKey}`;
    cancel.mockRejectedValueOnce(new PaymentsError('provider_unavailable'));

    await expect(sweep(port)).rejects.toMatchObject({
      code: 'provider_unavailable',
    });
    expect(await sweep(port)).toBe(1);

    expect(cancel.mock.calls.map(([input]) => input.idempotencyKey)).toEqual([
      key,
      key,
    ]);
  });
});

describe('the count and the dispatch of the sweep', () => {
  it('counts a paying hold that has no order', async () => {
    const port = payments();
    const bookable = await seedBookable(client.db);
    const hold = await insertHold(client.db, bookable.session.id, {
      status: 'paying',
      createdAt: sql`now() - interval '30 minutes'`,
      payingUntil: sql`now() - interval '1 minute'`,
    });

    expect(await sweep(port)).toBe(1);

    const [row] = await client.db
      .select()
      .from(holds)
      .where(eq(holds.id, hold.id));
    expect(row).toMatchObject({
      status: 'released',
      releasedReason: 'payment_abandoned',
    });
  });

  it('counts a paying hold whose order is void and whose attempt is cancelled already, with no provider call', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    await client.db
      .update(paymentAttempts)
      .set({ status: 'canceled' })
      .where(eq(paymentAttempts.orderId, lapsed.started.order.id));
    await client.db
      .update(orders)
      .set({ status: 'void' })
      .where(eq(orders.id, lapsed.started.order.id));

    expect(await sweep(port)).toBe(1);

    expect(cancel).not.toHaveBeenCalled();
    expect((await fixtures.state(lapsed)).hold.status).toBe('released');
  });

  it('releases and counts every lapsed paying hold of one session', async () => {
    const port = payments();
    const bookable = await seedBookable(client.db);
    const first = await fixtures.lapsedPayingHold(bookable, port, {
      adults: 1,
    });
    const second = await fixtures.lapsedPayingHold(bookable, port, {
      adults: 1,
      device: suite.guestB,
    });

    expect(await sweep(port)).toBe(2);

    for (const lapsed of [first, second]) {
      expect((await fixtures.state(lapsed)).hold).toMatchObject({
        status: 'released',
        releasedReason: 'payment_abandoned',
      });
    }
  });

  it("hands each hold's own id and its own session's id to the lapse step", async () => {
    const port = payments();
    const bookable = await seedBookable(client.db);
    const lapsed = await fixtures.lapsedPayingHold(bookable, port);

    await sweep(port);

    expect(lapseData.abandonPayingHold).toHaveBeenCalledExactlyOnceWith(port, {
      holdId: lapsed.hold.id,
      sessionId: bookable.session.id,
    });
  });
});

describe('the attempt write', () => {
  const inTransaction = (
    body: (
      tx: Parameters<Parameters<typeof client.db.transaction>[0]>[0],
    ) => Promise<void>,
  ) => client.db.transaction(body);

  it('does not overwrite an attempt that succeeded after the sweep read it, and leaves the hold and the order alone', async () => {
    const port = payments();
    const bookable = await seedBookable(client.db);
    const lapsed = await fixtures.lapsedPayingHold(bookable, port, {
      createPayment: false,
    });

    const released = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await tx
          .update(paymentAttempts)
          .set({ status: 'succeeded' })
          .where(eq(paymentAttempts.orderId, lapsed.started.order.id));
      },
      () =>
        lapseData.abandonPayingHold(port, {
          holdId: lapsed.hold.id,
          sessionId: bookable.session.id,
        }),
    );

    expect(released).toBe(false);
    const after = await fixtures.state(lapsed);
    expect(after.attempt).toMatchObject({ status: 'succeeded' });
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
  });
});

describe('what the sweep refuses to act on', () => {
  it('releases nothing for a hold that is not there, and asks the provider nothing', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const bookable = await seedBookable(client.db);

    expect(
      await lapseData.abandonPayingHold(port, {
        holdId: randomUUID(),
        sessionId: bookable.session.id,
      }),
    ).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
  });

  it('refuses a ref that is not two uuids, before any provider call', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const bookable = await seedBookable(client.db);

    await expect(
      lapseData.abandonPayingHold(port, {
        holdId: 'x',
        sessionId: bookable.session.id,
      }),
    ).rejects.toBeInstanceOf(ZodError);
    expect(cancel).not.toHaveBeenCalled();
  });

  it("rethrows an error from the cancel that is not the port's, and leaves the hold, order, and attempt as they were", async () => {
    const port = payments();
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    vi.spyOn(port, 'cancelPayment').mockRejectedValue(new Error('boom'));

    await expect(sweep(port)).rejects.toThrow('boom');

    const after = await fixtures.state(lapsed);
    expect(after.hold.status).toBe('paying');
    expect(after.order.status).toBe('pending_payment');
    expect(after.attempt).toMatchObject({ status: 'created' });
  });
});

describe('the locks that make the unlocked attempt read safe', () => {
  const inTransaction = (
    body: (
      tx: Parameters<Parameters<typeof client.db.transaction>[0]>[0],
    ) => Promise<void>,
  ) => client.db.transaction(body);

  it('waits for the hold row, then judges the hold as the other transaction left it', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const bookable = await seedBookable(client.db);
    const lapsed = await fixtures.lapsedPayingHold(bookable, port);
    const locks = await import('@/server/db/locks');

    const released = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockHoldRow(tx, lapsed.hold.id);
        await tx
          .update(holds)
          .set({ payingUntil: sql`now() + interval '5 minutes'` })
          .where(eq(holds.id, lapsed.hold.id));
      },
      () =>
        lapseData.abandonPayingHold(port, {
          holdId: lapsed.hold.id,
          sessionId: bookable.session.id,
        }),
    );

    expect(released).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect((await fixtures.state(lapsed)).hold.status).toBe('paying');
  });

  it('waits for the order row, then judges the order as the other transaction left it', async () => {
    const port = payments();
    const cancel = vi.spyOn(port, 'cancelPayment');
    const bookable = await seedBookable(client.db);
    const lapsed = await fixtures.lapsedPayingHold(bookable, port);
    const locks = await import('@/server/db/locks');

    const released = await raceAgainstOpenTransaction(
      inTransaction,
      async (tx) => {
        await locks.lockOrderRow(tx, `book:${lapsed.hold.id}`);
        await tx
          .update(orders)
          .set({ status: 'confirmed', confirmedAt: new Date() })
          .where(eq(orders.id, lapsed.started.order.id));
      },
      () =>
        lapseData.abandonPayingHold(port, {
          holdId: lapsed.hold.id,
          sessionId: bookable.session.id,
        }),
    );

    expect(released).toBe(false);
    expect(cancel).not.toHaveBeenCalled();
    expect((await fixtures.state(lapsed)).order.status).toBe('confirmed');
  });
});

describe('a cancel that fails', () => {
  it('rejects with nothing written, whatever the reason, and the next sweep decides on what the provider now holds', async () => {
    const port = payments();
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    const paymentId = lapsed.payment?.id ?? '';
    const cancel = vi.spyOn(port, 'cancelPayment');
    cancel.mockRejectedValueOnce(new PaymentsError('invalid_state'));

    await expect(sweep(port)).rejects.toMatchObject({ code: 'invalid_state' });
    const stuck = await fixtures.state(lapsed);
    expect(stuck.hold.status).toBe('paying');
    expect(stuck.order.status).toBe('pending_payment');
    expect(stuck.attempt).toMatchObject({ status: 'created' });

    await port.confirm(paymentId, { outcome: 'succeeded' });
    cancel.mockClear();
    expect(await sweep(port)).toBe(0);
    expect(cancel).not.toHaveBeenCalled();
    expect((await fixtures.state(lapsed)).hold.status).toBe('paying');
  });

  it('is settled by the next sweep when the provider now holds the payment cancelled, without a second cancel', async () => {
    const port = payments();
    const lapsed = await fixtures.lapsedPayingHold(
      await seedBookable(client.db),
      port,
    );
    const cancel = vi.spyOn(port, 'cancelPayment');
    cancel.mockRejectedValueOnce(new PaymentsError('not_found'));
    await expect(sweep(port)).rejects.toMatchObject({ code: 'not_found' });
    await port.cancelPayment({
      idempotencyKey: 'cancel:elsewhere',
      paymentId: lapsed.payment?.id ?? '',
    });
    cancel.mockClear();

    expect(await sweep(port)).toBe(1);

    expect(cancel).not.toHaveBeenCalled();
    expect((await fixtures.state(lapsed)).hold.status).toBe('released');
  });
});

describe('a pulse run', () => {
  it('voids the order, cancels the payment, and releases a lapsed paying hold, with the real sweep and the fake gateway', async () => {
    const fake = gateway.getFakePayments();
    const bookable = await seedBookable(client.db);
    const lapsed = await fixtures.lapsedPayingHold(
      bookable,
      fixtures.makePayments(),
      { createPayment: false },
    );
    const payment = await fake.createPayment({
      idempotencyKey: lapsed.started.attempt.providerKey,
      amountMinor: lapsed.started.attempt.amountMinor,
      currency: 'USD',
      metadata: {
        orderId: lapsed.started.order.id,
        recordId: lapsed.started.attempt.id,
      },
    });
    await client.db
      .update(paymentAttempts)
      .set({ providerPaymentId: payment.id })
      .where(eq(paymentAttempts.id, lapsed.started.attempt.id));

    const response = await pulse.pulseResponse(
      new Request('http://localhost/api/pulse', {
        method: 'POST',
        headers: { authorization: `Bearer ${pulseSecret}` },
      }),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ holdsReleased: 1 });
    const after = await fixtures.state({ ...lapsed, payment: null });
    expect(after.hold).toMatchObject({
      status: 'released',
      releasedReason: 'payment_abandoned',
    });
    expect(after.order.status).toBe('void');
    expect(after.attempt).toMatchObject({ status: 'canceled' });
    expect(
      (await fake.retrieve({ kind: 'payment', id: payment.id }))?.status,
    ).toBe('canceled');
  });
});
