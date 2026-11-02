import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { Pool } from 'pg';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { tagsForChanges } from '@/lib/cacheTags';
import { accountBalances } from '@/lib/ledger';
import {
  processEventDedupeKey,
  processProviderEventKind,
  providerEventRow,
  type IncomingProviderEvent,
} from '@/lib/providerEvents';
import { fakeCardFeeMinor } from '@/lib/fakeCardFee';
import { setEnv } from '../email/testEnv';
import { testDevice } from '../deviceFixture';
import { dueClock } from '../support/dueClock';
import { createFreshDatabase, type FreshDatabase } from './harness';
import {
  insertOtherOpenHold,
  seedBooking,
  type BookingSeed,
  type BookingWorld,
} from './confirmOrderFixtures';
import { minute, seedBookable } from './holdFixtures';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
const raise = vi.hoisted(() => vi.fn());
const refund = vi.hoisted(() => vi.fn());
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('@/server/db/refundPath', () => ({ takeRefundPath: refund }));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

// Behaviours under test, one per decision, branch, or risk:
// - a confirmed booking writes exactly one of each: the seat count, the hold converted, the order confirmed with a manage
//   hash that matches capabilityToken, the booking and fee ledger rows (taxable too), one scheduled transfer released
//   24 hours after the session ends, the two email jobs, and the session's spaces tag invalidated
// - a replayed success answers already_confirmed and writes nothing more; a fee the provider did not report posts no fee row
// - the worked example (two guests at $65, fee $4.07) leaves the balances the ledger tests expect
// - a lapsed hold, still active or already released, confirms when the session has room (room and exactly enough)
//   and takes the refund path, writing nothing, when it is one seat short
// - a cancelled session, and a payment that is not what was due (amount, currency), take the refund path with their
//   reason; a mismatch raises its alert once per order; the refund seam's answer is `unavailable`
// - a CHECK refusal of the seat count rolls back the confirm writes only (the transaction's earlier writes survive)
//   and takes the refund path
// - the branches no unit has built throw naming their unit and write nothing
// - two success events for one order processed at once confirm once
// - a confirm that waits for the session lock judges what the holder left: a hold committed meanwhile leaves no room
//   (fails if the session lock is removed); real reserves racing confirms never oversell the last seat
// - end to end: a signed payment.succeeded posted to the webhook route and drained confirms the order and sends the
//   guest email to the dev mailbox; an event left retrying under the old seam confirms on its next retry

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let confirmModule: typeof import('@/server/db/confirmOrder');
let eventsModule: typeof import('@/server/db/providerEvents');
let jobModule: typeof import('@/server/jobs/providerEvents');
let drain: typeof import('@/server/jobs/drain');
let enqueueModule: typeof import('@/server/jobs/enqueue');
let clockModule: typeof import('@/server/ports/clock');
let timeModule: typeof import('@/server/db/time');
let tokens: typeof import('@/server/tokens');
let holdData: typeof import('@/server/db/holds');
let gateway: typeof import('@/server/ports/payments/gateway');
let route: typeof import('@/app/api/webhooks/payments/route');
let schema: typeof import('@/server/db/schema');
let side: Pool;
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  const handlerUrl = new URL(fresh.url);
  handlerUrl.searchParams.set('application_name', fresh.schema);
  setEnv(testEnv, {
    DATABASE_URL: handlerUrl.toString(),
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  confirmModule = await import('@/server/db/confirmOrder');
  eventsModule = await import('@/server/db/providerEvents');
  jobModule = await import('@/server/jobs/providerEvents');
  drain = await import('@/server/jobs/drain');
  enqueueModule = await import('@/server/jobs/enqueue');
  clockModule = await import('@/server/ports/clock');
  timeModule = await import('@/server/db/time');
  tokens = await import('@/server/tokens');
  holdData = await import('@/server/db/holds');
  gateway = await import('@/server/ports/payments/gateway');
  route = await import('@/app/api/webhooks/payments/route');
  schema = await import('@/server/db/schema');
  parents = await createOrderParents(client.db, 'confirm');
  await client.db
    .update(schema.hosts)
    .set({ notificationEmail: 'bookings@harborlight.example' })
    .where(eq(schema.hosts.id, parents.hostId));
  side = new Pool({ connectionString: fresh.url, max: 4 });
});

afterAll(async () => {
  await side.end();
  await client.db.$client.end();
  await fresh.dispose();
});

beforeEach(async () => {
  raise.mockClear();
  refund.mockReset();
  refund.mockResolvedValue({ status: 'unavailable' });
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM messages`);
});

const seed = (over: BookingSeed = {}) => seedBooking(client.db, parents, over);

type ConfirmInput = Parameters<
  typeof import('@/server/db/confirmOrder').confirmOrder
>[1];

/** The confirm step on its own, in a transaction, with the time read as the event job reads it. */
function confirm(world: BookingWorld, over: Partial<ConfirmInput> = {}) {
  return client.db.transaction(async (tx) =>
    confirmModule.confirmOrder(tx, {
      orderId: world.orderId,
      attemptId: world.attemptId,
      providerEventId: randomUUID(),
      providerPaymentId: world.paymentId,
      amountMinor: world.amountDueMinor,
      currency: 'USD',
      feeMinor: 407,
      now: await timeModule.readDatabaseTime(tx),
      ...over,
    }),
  );
}

async function ledgerOf(world: BookingWorld) {
  return client.db
    .select()
    .from(schema.ledgerEntries)
    .where(eq(schema.ledgerEntries.orderId, world.orderId))
    .orderBy(schema.ledgerEntries.id);
}

async function jobsOf(world: BookingWorld) {
  const { rows } = await client.db.execute<{
    kind: string;
    payload: unknown;
    dedupe_key: string;
  }>(
    sql`SELECT kind, payload, dedupe_key FROM jobs WHERE payload->>'orderId' = ${world.orderId} ORDER BY kind`,
  );
  return rows;
}

async function stateOf(world: BookingWorld) {
  const [order] = await client.db
    .select()
    .from(schema.orders)
    .where(eq(schema.orders.id, world.orderId));
  const [hold] = await client.db
    .select()
    .from(schema.holds)
    .where(eq(schema.holds.id, world.holdId));
  const [session] = await client.db
    .select()
    .from(schema.sessions)
    .where(eq(schema.sessions.id, world.sessionId));
  const transfers = await client.db
    .select()
    .from(schema.transfers)
    .where(eq(schema.transfers.orderId, world.orderId));
  if (!order || !hold || !session) throw new Error('missing rows');
  return {
    order,
    hold,
    session,
    transfers,
    ledger: await ledgerOf(world),
    jobs: await jobsOf(world),
  };
}

async function expectNothingWritten(
  world: BookingWorld,
  before: Awaited<ReturnType<typeof stateOf>>,
) {
  const after = await stateOf(world);
  expect(after.order.status).toBe(before.order.status);
  expect(after.order.manageTokenHash).toBeNull();
  expect(after.hold.status).toBe(before.hold.status);
  expect(after.session.seatsSold).toBe(before.session.seatsSold);
  expect(after.ledger).toHaveLength(0);
  expect(after.transfers).toHaveLength(0);
  expect(after.jobs).toHaveLength(0);
}

describe('a confirmed booking', () => {
  it.each([
    [
      'two guests at $65, not taxable',
      false,
      [
        'charge_host_share:11050',
        'charge_commission:1950',
        'processing_fee:407',
      ],
    ],
    [
      'two guests at $85 with tax',
      true,
      [
        'charge_host_share:14450',
        'charge_commission:2550',
        'charge_tax:1509',
        'processing_fee:407',
      ],
    ],
  ])('writes one of each for %s', async (_name, taxable, rows) => {
    const world = await seed({ taxable, seatsSold: 3 });
    const before = await stateOf(world);

    const result = await confirm(world);

    const after = await stateOf(world);
    expect(result).toEqual({
      status: 'confirmed',
      reference: after.order.reference,
    });
    expect(after.session.seatsSold).toBe(before.session.seatsSold + 2);
    expect(after.hold).toMatchObject({
      status: 'converted',
      releasedReason: null,
    });
    expect(after.order.status).toBe('confirmed');
    expect(after.order.confirmedAt).not.toBeNull();
    expect(after.order.manageTokenHash).toBe(
      tokens.hashToken(tokens.capabilityToken('manage', world.orderId, 1)),
    );
    expect(
      after.ledger.map((row) => `${row.entryType}:${String(row.amountMinor)}`),
    ).toEqual(rows);
    expect(
      after.ledger.every(
        (row) =>
          row.providerObjectId === world.paymentId ||
          row.providerObjectId === null,
      ),
    ).toBe(true);
    expect(after.ledger.every((row) => row.simulated)).toBe(true);
    expect(after.transfers).toHaveLength(1);
    expect(after.transfers[0]).toMatchObject({
      status: 'scheduled',
      amountMinor: null,
      providerKey: `transfer:${world.orderId}`,
      hostId: parents.hostId,
    });
    expect(after.transfers[0]?.releaseAfter).toEqual(
      new Date(after.session.endsAt.getTime() + 24 * 60 * minute),
    );
    expect(after.jobs).toEqual([
      {
        kind: 'guest-confirmation',
        payload: { orderId: world.orderId },
        dedupe_key: `guest-confirmation:${world.orderId}`,
      },
      {
        kind: 'host-booking-notice',
        payload: { orderId: world.orderId },
        dedupe_key: `host-booking-notice:${world.orderId}`,
      },
    ]);
    const { revalidateTag } = await import('next/cache');
    for (const tag of tagsForChanges([
      { kind: 'spaces', sessionId: world.sessionId },
    ])) {
      expect(revalidateTag).toHaveBeenCalledWith(tag, 'max');
    }
    expect(refund).not.toHaveBeenCalled();
  });

  it('leaves the balances the ledger tests expect for the worked example', async () => {
    const world = await seed();
    await confirm(world);

    const balances = accountBalances(
      (await ledgerOf(world)).map((row) => ({
        debitAccount: row.debitAccount,
        creditAccount: row.creditAccount,
        amountMinor: row.amountMinor,
      })),
    );
    expect(balances).toMatchObject({
      platform_cash: 13000 - 407,
      host_payable: 11050,
      ramble_commission: 1950,
      processing_fees: 407,
    });
  });

  it('writes nothing more for a replayed success and answers already_confirmed', async () => {
    const world = await seed();
    const first = await confirm(world);
    const once = await stateOf(world);

    const again = await confirm(world);

    expect(again).toEqual({
      status: 'already_confirmed',
      reference: first.status === 'confirmed' ? first.reference : '',
    });
    const twice = await stateOf(world);
    expect(twice.session.seatsSold).toBe(once.session.seatsSold);
    expect(twice.ledger).toHaveLength(once.ledger.length);
    expect(twice.transfers).toHaveLength(1);
    expect(twice.jobs).toHaveLength(2);
    expect(twice.order.confirmedAt).toEqual(once.order.confirmedAt);
  });

  it('posts no fee row, and does not fail, when the provider reported no fee', async () => {
    const world = await seed();

    const result = await confirm(world, { feeMinor: null });

    expect(result.status).toBe('confirmed');
    expect((await ledgerOf(world)).map((row) => row.entryType)).toEqual([
      'charge_host_share',
      'charge_commission',
    ]);
  });
});

describe('a hold that lapsed', () => {
  it.each([
    ['with plenty of room', 'lapsed', 0, 6],
    ['with room, though the upkeep released it', 'released', 0, 6],
    ['with exactly enough room', 'lapsed', 1, 7],
  ] as const)(
    'confirms a hold that lapsed %s',
    async (_name, hold, others, allocation) => {
      const world = await seed({ hold, allocation, seatsSold: 4 });
      if (others > 0)
        await insertOtherOpenHold(client.db, world.sessionId, others);

      expect((await confirm(world)).status).toBe('confirmed');

      const after = await stateOf(world);
      expect(after.hold).toMatchObject({
        status: 'converted',
        releasedReason: null,
      });
      expect(after.session.seatsSold).toBe(6);
    },
  );

  it.each([
    ['lapsed', 'lapsed'],
    ['released', 'released'],
  ] as const)(
    'one seat short takes the refund path (%s)',
    async (_name, hold) => {
      const world = await seed({ hold, allocation: 6, seatsSold: 4 });
      await insertOtherOpenHold(client.db, world.sessionId, 1);
      const before = await stateOf(world);

      expect(await confirm(world)).toEqual({ status: 'unavailable' });

      expect(refund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({
          orderId: world.orderId,
          providerPaymentId: world.paymentId,
          reason: 'sold_out_after_lapse',
        }),
      );
      await expectNothingWritten(world, before);
      expect(raise).not.toHaveBeenCalled();
    },
  );
});

describe('a payment that cannot be confirmed', () => {
  it('takes the refund path for a cancelled session, whatever the hold', async () => {
    const world = await seed({ sessionStatus: 'cancelled' });
    const before = await stateOf(world);

    expect(await confirm(world)).toEqual({ status: 'unavailable' });

    expect(refund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'session_cancelled' }),
    );
    await expectNothingWritten(world, before);
  });

  it.each([
    ['amount short', { amountMinor: 12999 }, 'amount_mismatch'],
    ['amount not reported', { amountMinor: null }, 'amount_mismatch'],
    ['currency differs', { currency: 'EUR' }, 'currency_mismatch'],
  ])(
    'alerts once for an order and takes the refund path: %s',
    async (_name, over, reason) => {
      const world = await seed();
      const before = await stateOf(world);

      expect(await confirm(world, over)).toEqual({ status: 'unavailable' });

      expect(raise).toHaveBeenCalledTimes(1);
      expect(raise).toHaveBeenCalledWith(
        'payment-amount-mismatch',
        'error',
        `order:${world.orderId}`,
        expect.objectContaining({ orderId: world.orderId, reason }),
      );
      expect(refund).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ reason }),
      );
      await expectNothingWritten(world, before);
    },
  );

  it('rolls back only the confirm writes when the database refuses the seat count, and takes the refund path', async () => {
    // The capacity was lowered to 3 with 2 sold: the open hold counts 2 more, and the CHECK refuses the sum.
    const world = await seed({ allocation: 3, seatsSold: 2 });
    const before = await stateOf(world);

    const result = await client.db.transaction(async (tx) => {
      await tx
        .update(schema.orders)
        .set({ contactPhone: '212-555-0100' })
        .where(eq(schema.orders.id, world.orderId));
      return confirmModule.confirmOrder(tx, {
        orderId: world.orderId,
        attemptId: world.attemptId,
        providerEventId: randomUUID(),
        providerPaymentId: world.paymentId,
        amountMinor: world.amountDueMinor,
        currency: 'USD',
        feeMinor: 407,
        now: await timeModule.readDatabaseTime(tx),
      });
    });

    expect(result).toEqual({ status: 'unavailable' });
    expect(refund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'sold_out_after_lapse' }),
    );
    const after = await stateOf(world);
    expect(after.order.contactPhone).toBe('212-555-0100');
    expect(after.order.status).toBe('pending_payment');
    expect(after.order.manageTokenHash).toBeNull();
    expect(after.hold.status).toBe(before.hold.status);
    expect(after.session.seatsSold).toBe(2);
    expect(after.ledger).toHaveLength(0);
    expect(after.transfers).toHaveLength(0);
    expect(after.jobs).toHaveLength(0);
  });
});

describe('the confirmations no unit has built', () => {
  it.each([
    ['gift_purchase', 'U-062a'],
    ['zero_due', 'U-064a'],
  ] as const)(
    'a %s order throws naming %s and writes nothing',
    async (orderKind, unit) => {
      const world = await seed({ orderKind });

      await expect(confirm(world)).rejects.toThrow(unit);

      const [order] = await client.db
        .select()
        .from(schema.orders)
        .where(eq(schema.orders.id, world.orderId));
      expect(order?.status).toBe('pending_payment');
      expect(await ledgerOf(world)).toHaveLength(0);
      expect(refund).not.toHaveBeenCalled();
    },
  );
});

function incoming(world: BookingWorld): IncomingProviderEvent {
  return {
    id: `evt_${randomUUID()}`,
    provider: 'fake',
    type: 'payment.succeeded',
    objectId: world.paymentId,
    metadata: { orderId: world.orderId, recordId: world.attemptId },
    amountMinor: world.amountDueMinor,
    currency: 'USD',
    feeMinor: 407,
    failureCode: null,
    method: 'google_pay',
    occurredAt: new Date(),
  };
}

async function store(event: IncomingProviderEvent) {
  const row = providerEventRow(event);
  if (!row) throw new Error('event not storable');
  await eventsModule.recordProviderEvent(row);
  const [stored] = await client.db
    .select({ id: schema.providerEvents.id })
    .from(schema.providerEvents)
    .where(eq(schema.providerEvents.providerEventId, event.id));
  if (!stored) throw new Error('event not stored');
  return stored.id;
}

/** The event job's handler with the real confirm step, in one transaction. */
function handle(eventId: string) {
  return client.db.transaction((tx) =>
    jobModule.handleProviderEvent({
      tx,
      payload: { eventId },
      prepared: null,
      jobId: randomUUID(),
      clock: clockModule.systemClock,
    }),
  );
}

async function waitUntilBlocked(count: number) {
  const deadline = Date.now() + 5000;
  for (;;) {
    const { rows } = await side.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM pg_stat_activity WHERE wait_event_type = 'Lock' AND application_name = $1`,
      [fresh.schema],
    );
    if ((rows[0]?.n ?? 0) >= count) return;
    if (Date.now() > deadline) throw new Error('the handler never waited');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

describe('concurrency', () => {
  it('confirms once when two success events for one order are processed at once', async () => {
    const world = await seed();
    const ids = await Promise.all([
      store(incoming(world)),
      store(incoming(world)),
    ]);

    await Promise.all(ids.map((id) => handle(id)));

    const after = await stateOf(world);
    expect(after.order.status).toBe('confirmed');
    expect(after.session.seatsSold).toBe(2);
    expect(after.ledger).toHaveLength(3);
    expect(after.transfers).toHaveLength(1);
    expect(after.jobs).toHaveLength(2);
    const processed = await Promise.all(
      ids.map(async (id) => {
        const [event] = await client.db
          .select({ processedAt: schema.providerEvents.processedAt })
          .from(schema.providerEvents)
          .where(eq(schema.providerEvents.id, id));
        return event?.processedAt;
      }),
    );
    expect(processed.every((at) => at !== null)).toBe(true);
  });

  it('judges what the session lock holder left: a hold committed meanwhile leaves no room', async () => {
    const world = await seed({ hold: 'lapsed', allocation: 2, seatsSold: 0 });
    const id = await store(incoming(world));
    const holder = await side.connect();
    await holder.query('BEGIN');
    await holder.query(`SELECT id FROM sessions WHERE id = $1 FOR UPDATE`, [
      world.sessionId,
    ]);

    const handled = handle(id);
    await waitUntilBlocked(1);
    await holder.query(
      `INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
       VALUES ($1, 'booking', 'active', 1, $2, $3, now() + interval '10 minutes', now(), now())`,
      [world.sessionId, 'e'.repeat(64), 'f'.repeat(64)],
    );
    await holder.query('COMMIT');
    holder.release();
    await handled;

    const after = await stateOf(world);
    expect(after.order.status).toBe('pending_payment');
    expect(after.session.seatsSold).toBe(0);
    expect(refund).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ reason: 'sold_out_after_lapse' }),
    );
  });

  it('never oversells the last seat when a confirm races a reserve, in 6 rounds', async () => {
    for (let round = 0; round < 6; round += 1) {
      const bookable = await seedBookable(client.db, { allocation: 1 });
      const world = await seed({
        hold: 'lapsed',
        holdSeats: 1,
        on: {
          experienceId: bookable.experience.id,
          hostId: bookable.host.id,
          sessionId: bookable.session.id,
        },
      });
      const id = await store(incoming(world));
      const device = await testDevice(`confirm-race-${String(round)}`);

      const [, reserved] = await Promise.all([
        handle(id),
        holdData.reserveSpaces(device, {
          sessionId: bookable.session.id,
          items: [{ priceOptionId: bookable.adult.id, quantity: 1 }],
          purpose: 'booking',
        }),
      ]);

      const after = await stateOf(world);
      const confirmed = after.order.status === 'confirmed';
      const held = await client.db.transaction(async (tx) =>
        holdData.readOpenHeldSeats(
          tx,
          bookable.session.id,
          await timeModule.readDatabaseTime(tx),
        ),
      );
      expect(after.session.seatsSold + held).toBeLessThanOrEqual(1);
      expect(confirmed).toBe(reserved.status === 'sold_out');
      expect(reserved.status === 'held').toBe(!confirmed);
    }
  });
});

describe('through the webhook route and the job drain', () => {
  async function drainAll() {
    for (let pass = 0; pass < 3; pass += 1) {
      await drain.drainJobs(dueClock);
    }
  }

  it('confirms the order and sends the guest email for a signed payment.succeeded', async () => {
    const world = await seed();
    const fake = gateway.getFakePayments();
    const payment = await fake.createPayment({
      idempotencyKey: `pay:${world.orderId}:1`,
      amountMinor: world.amountDueMinor,
      currency: 'USD',
      metadata: { orderId: world.orderId, recordId: world.attemptId },
    });
    await client.db
      .update(schema.paymentAttempts)
      .set({ providerPaymentId: payment.id })
      .where(eq(schema.paymentAttempts.id, world.attemptId));
    const { event } = await fake.confirm(payment.id, {
      outcome: 'succeeded',
    });
    const delivery = fake.signWebhook(event);

    const response = await route.POST(
      new Request('http://localhost/api/webhooks/payments', {
        method: 'POST',
        headers: { 'x-ramble-signature': delivery.signature },
        body: delivery.rawBody,
      }),
    );
    expect(response.status).toBe(200);
    await drainAll();

    const after = await stateOf(world);
    expect(after.order.status).toBe('confirmed');
    expect(after.session.seatsSold).toBe(2);
    expect(
      after.ledger.find((row) => row.entryType === 'processing_fee')
        ?.amountMinor,
    ).toBe(fakeCardFeeMinor(world.amountDueMinor));
    const mail = await client.db.select().from(schema.messages);
    expect(
      mail.filter(
        (m) =>
          m.template === 'guest-confirmation' &&
          m.recipient === 'pat@example.com',
      ),
    ).toHaveLength(1);
    expect(
      mail.filter((m) => m.recipient === 'bookings@harborlight.example'),
    ).toHaveLength(1);
    expect(raise).not.toHaveBeenCalled();
  });

  it('confirms on its next retry an event the earlier seam left retrying', async () => {
    const world = await seed();
    await client.db
      .update(schema.paymentAttempts)
      .set({ status: 'succeeded' })
      .where(eq(schema.paymentAttempts.id, world.attemptId));
    const id = await store(incoming(world));
    await client.db
      .update(schema.providerEvents)
      .set({
        attempts: 1,
        lastError: 'Order confirmation is not available yet',
      })
      .where(eq(schema.providerEvents.id, id));
    await client.db.execute(sql`DELETE FROM jobs`);
    await client.db.transaction((tx) =>
      enqueueModule.enqueue(tx, {
        kind: processProviderEventKind,
        payload: { eventId: id },
        dedupeKey: processEventDedupeKey(id, 1),
        runAfter: new Date(Date.now() - 60_000),
      }),
    );
    await drainAll();

    const after = await stateOf(world);
    expect(after.order.status).toBe('confirmed');
    const [event] = await client.db
      .select()
      .from(schema.providerEvents)
      .where(eq(schema.providerEvents.id, id));
    expect(event?.processedAt).not.toBeNull();
  });
});
