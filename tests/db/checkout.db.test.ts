import { count, eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { isOrderReference } from '@/lib/orders';
import {
  consents,
  guests,
  holds,
  legalAcceptances,
  legalDocuments,
  orderItems,
  orders,
  paymentAttempts,
  sessions,
  settings,
} from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import {
  formFor,
  holdFor,
  ordersFor,
  publishLegal,
  type Bookable,
} from './checkoutFixtures';
import { day, insertSession, minute, seedBookable } from './holdFixtures';

// Behaviours under test, one per decision, branch or risk:
// - a hold becomes a pending order with every snapshot (key, money, tax and commission rates, tier, free-cancel
//   time, attribution), its lines, the guest, the terms and waiver acceptances, attempt 1 keyed pay:<order>:1 at
//   the amount due, and a paying hold whose deadline is its expiry plus the grace
// - the newsletter consent is written only when ticked, once
// - a form with an age, terms, or waiver issue writes nothing, and the hold stays active
// - a lapsed hold writes nothing: hold_expired with the spaces left and whether the party fits, or sold_out with
//   other dates; a cancelled session, a missing hold, another device's hold, and a gift hold are not told apart
// - two calls on one hold are one order and one attempt; once the provider's payment is stored the second call
//   hands it back as it is, even after the hold lapsed; a decline puts the order back to pending on the same attempt
// - a reused order follows the latest form (name, phone, email, ages, acceptances) and never its money
// - a confirmed order answers already_confirmed with the order token for its device only, whatever the form held
// - five failed tries are too_many_tries; a canceled attempt with fewer gets the next number; an amount the
//   provider would refuse writes nothing
// - a clash on the order reference tries again, up to 3 tries, and then fails with nothing written
// - acceptances are recorded for the holding device only, once each, and the database refuses an unpublished version
// - the provider's payment id is stored once, only while the attempt is live, and only for the hold's device

const random = vi.hoisted(() => ({
  next: null as null | ((max: number) => number),
}));
vi.mock('node:crypto', async (importActual) => {
  const actual = await importActual<typeof import('node:crypto')>();
  return {
    ...actual,
    randomInt: (max: number) => random.next?.(max) ?? actual.randomInt(max),
  };
});

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let checkout: typeof import('@/server/db/checkout');
let tokens: typeof import('@/server/tokens');
let guestA: Device;
let guestB: Device;
let terms: Awaited<ReturnType<typeof publishLegal>>;
let bookable: Bookable;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  checkout = await import('@/server/db/checkout');
  tokens = await import('@/server/tokens');
  guestA = await testDevice('checkout-a');
  guestB = await testDevice('checkout-b');
  terms = await publishLegal(client.db, 'terms', 1, 'Marketplace terms');
  bookable = await seedBookable(client.db);
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  random.next = null;
  await client.db.update(settings).set({
    bookingsPaused: false,
    holdMinutes: 10,
    paymentGraceMinutes: 5,
    taxRatePpm: 88_750,
  });
});

let payments = 0;
/** A provider payment id no other test has used: the column is unique. */
const payId = (label: string) => {
  payments += 1;
  return `pay_${label}_${String(payments)}`;
};

const start = (
  form: Parameters<typeof formFor>[2],
  holdId: string,
  device = guestA,
) => checkout.startPaymentTx(device, formFor(holdId, terms.id, form), 'fake');

type Started = Awaited<ReturnType<typeof checkout.startPaymentTx>>;
function proceeded(started: Started) {
  if (started.done) {
    throw new Error(
      `expected a payment to start, got ${started.result.status}`,
    );
  }
  return started;
}
function refused(started: Started) {
  if (!started.done) throw new Error('expected a refusal');
  return started.result;
}

async function tally() {
  const rows = await Promise.all(
    [
      orders,
      orderItems,
      paymentAttempts,
      guests,
      consents,
      legalAcceptances,
    ].map(async (table) => {
      const [row] = await client.db.select({ n: count() }).from(table);
      return row?.n ?? 0;
    }),
  );
  return {
    orders: rows[0],
    orderItems: rows[1],
    attempts: rows[2],
    guests: rows[3],
    consents: rows[4],
    acceptances: rows[5],
  };
}

async function storedHold(id: string) {
  const [row] = await client.db.select().from(holds).where(eq(holds.id, id));
  if (!row) throw new Error('no such hold');
  return row;
}

async function orderOf(holdId: string) {
  const [row] = await ordersFor(client.db, holdId);
  if (!row) throw new Error('no order for the hold');
  return row;
}

async function attemptsOf(orderId: string) {
  return client.db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.orderId, orderId))
    .orderBy(paymentAttempts.attemptNo);
}

describe('a hold becomes an order', () => {
  it('writes the order with every snapshot, its lines, the guest, the acceptances, attempt 1, and a paying hold', async () => {
    const waiver = await publishLegal(client.db, 'waiver-snapshot', 1);
    const rich = await seedBookable(client.db, {
      experience: {
        taxTreatment: 'taxable',
        waiverRequired: true,
        waiverDocumentId: waiver.id,
      },
    });
    const richHold = await holdFor(client.db, rich, guestA);

    const started = proceeded(
      await start(
        {
          waiverDocumentId: waiver.id,
          newsletterOptIn: true,
          attribution: { source: 'news', campaign: 'fall', issue: '12' },
        },
        richHold.id,
      ),
    );
    const order = await orderOf(richHold.id);
    const [attempt] = await attemptsOf(order.id);
    const [line] = await client.db
      .select()
      .from(orderItems)
      .where(eq(orderItems.orderId, order.id));

    expect(isOrderReference(order.reference)).toBe(true);
    expect(order).toMatchObject({
      kind: 'booking',
      status: 'pending_payment',
      idempotencyKey: `book:${richHold.id}`,
      sessionId: rich.session.id,
      experienceId: rich.experience.id,
      hostId: rich.host.id,
      contactEmail: 'pat@example.com',
      contactPhone: '212-555-0100',
      leadGuestName: 'Pat Smith',
      termsDocumentId: terms.id,
      waiverDocumentId: waiver.id,
      currency: 'USD',
      ticketSubtotalMinor: 10_000,
      taxTreatment: 'taxable',
      taxRatePpm: 88_750,
      taxMinor: 888,
      totalMinor: 10_888,
      giftAppliedMinor: 0,
      amountDueMinor: 10_888,
      commissionRateBps: 1500,
      commissionMinor: 1500,
      attributionSource: 'news',
      attributionCampaign: 'fall',
      attributionIssue: '12',
      manageTokenVersion: 1,
      manageTokenHash: null,
      synthetic: false,
    });
    expect(order.cancellationTierId).toBe(rich.experience.cancellationTierId);
    expect(order.freeCancelUntil).toEqual(
      new Date(rich.session.startsAt.getTime() - day),
    );
    expect(line).toMatchObject({
      priceOptionId: rich.adult.id,
      label: 'Adult',
      quantity: 2,
      unitPriceMinor: 5000,
      usesSpace: true,
      lineTotalMinor: 10_000,
    });
    expect(attempt).toMatchObject({
      attemptNo: 1,
      provider: 'fake',
      providerKey: `pay:${order.id}:1`,
      providerPaymentId: null,
      amountMinor: 10_888,
      status: 'created',
      failedTries: 0,
    });
    expect(started.order).toEqual({
      id: order.id,
      reference: order.reference,
      amountDueMinor: 10_888,
    });
    expect(started.attempt).toEqual({
      id: attempt?.id,
      providerKey: `pay:${order.id}:1`,
      amountMinor: 10_888,
      providerPaymentId: null,
      existed: false,
    });
  });

  it('records the terms and the waiver the guest accepted, once each', async () => {
    const waiver = await publishLegal(client.db, 'waiver-accept', 1);
    const rich = await seedBookable(client.db, {
      experience: { waiverRequired: true, waiverDocumentId: waiver.id },
    });
    const hold = await holdFor(client.db, rich, guestA);

    await start({ waiverDocumentId: waiver.id }, hold.id);
    await start({ waiverDocumentId: waiver.id }, hold.id);
    const order = await orderOf(hold.id);
    const accepted = await client.db
      .select({
        document: legalAcceptances.legalDocumentId,
        kind: legalAcceptances.subjectKind,
        subject: legalAcceptances.subjectId,
      })
      .from(legalAcceptances)
      .where(eq(legalAcceptances.subjectId, order.id));

    expect(accepted).toHaveLength(2);
    expect(accepted.map((row) => row.document).toSorted()).toEqual(
      [terms.id, waiver.id].toSorted(),
    );
    expect(accepted.every((row) => row.kind === 'order')).toBe(true);
  });

  it('moves the hold to paying, until its expiry plus the grace', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    await client.db.update(settings).set({ paymentGraceMinutes: 7 });

    await start({}, hold.id);
    const paying = await storedHold(hold.id);

    expect(paying.status).toBe('paying');
    expect(paying.payingUntil?.getTime()).toBe(
      hold.expiresAt.getTime() + 7 * minute,
    );
  });

  it('puts the grace after now when the hold is paid in its last moment', async () => {
    const hold = await holdFor(client.db, bookable, guestA, {
      status: 'paying',
      createdAt: new Date(Date.now() - 12 * minute),
      payingUntil: new Date(Date.now() + 3 * minute),
    });

    const started = await start({}, hold.id);

    expect(proceeded(started).order.amountDueMinor).toBe(10_888);
    const stored = await storedHold(hold.id);
    expect(stored.status).toBe('paying');
    expect(stored.payingUntil?.getTime()).toBe(hold.payingUntil?.getTime());
  });

  it('writes the newsletter consent only when ticked, and once', async () => {
    const before = await tally();
    const unticked = await holdFor(client.db, bookable, guestA);
    await start({ contact: { email: 'quiet@example.com' } }, unticked.id);
    expect((await tally()).consents).toBe(before.consents);

    const ticked = await holdFor(client.db, bookable, guestA);
    await start(
      { contact: { email: 'loud@example.com' }, newsletterOptIn: true },
      ticked.id,
    );
    await start(
      { contact: { email: 'loud@example.com' }, newsletterOptIn: true },
      ticked.id,
    );
    const [guest] = await client.db
      .select()
      .from(guests)
      .where(eq(guests.email, 'loud@example.com'));
    const rows = await client.db
      .select()
      .from(consents)
      .where(eq(consents.guestId, guest?.id ?? ''));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      kind: 'newsletter',
      status: 'granted',
      source: 'checkout',
    });
  });

  it('finds the guest by email in any case, so two orders by one person share a guest', async () => {
    const first = await holdFor(client.db, bookable, guestA);
    const second = await holdFor(client.db, bookable, guestA);

    await start({ contact: { email: 'Same@Example.com' } }, first.id);
    await start({ contact: { email: 'same@example.com' } }, second.id);

    expect((await orderOf(first.id)).guestId).toBe(
      (await orderOf(second.id)).guestId,
    );
  });

  it('gives the order token to the device that holds the hold', async () => {
    const hold = await holdFor(client.db, bookable, guestA);

    const started = proceeded(await start({}, hold.id));
    const order = await orderOf(hold.id);

    expect(started.orderToken).toBe(
      tokens.capabilityToken('order', order.id, 1),
    );
  });
});

describe('a form that fails a rule', () => {
  it.each([
    [
      'terms that are not the current version',
      { termsDocumentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
      { termsDocumentId: 'invalid' },
    ],
    [
      'a waiver where none is needed',
      { waiverDocumentId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
      { waiverDocumentId: 'invalid' },
    ],
    [
      'an unneeded guardian',
      { attendees: { guardian: { name: 'Pat', contact: 'x' } } },
      { 'attendees.guardian': 'invalid' },
    ],
  ])('refuses %s and writes nothing', async (_name, change, fieldErrors) => {
    const hold = await holdFor(client.db, bookable, guestA);
    const before = await tally();

    const result = refused(await start(change, hold.id));

    expect(result).toEqual({ status: 'invalid', fieldErrors });
    expect(await tally()).toEqual(before);
    expect((await storedHold(hold.id)).status).toBe('active');
  });

  it('refuses a 21+ party that was not confirmed, and a waiver left out, together', async () => {
    const waiver = await publishLegal(client.db, 'waiver-issues', 1);
    const strict = await seedBookable(client.db, {
      experience: {
        ageRule: 'twenty_one_plus',
        waiverRequired: true,
        waiverDocumentId: waiver.id,
      },
    });
    const hold = await holdFor(client.db, strict, guestA);
    const before = await tally();

    const result = refused(await start({}, hold.id));

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: {
        'attendees.ageConfirmed': 'required',
        waiverDocumentId: 'required',
      },
    });
    expect(await tally()).toEqual(before);
  });

  it('requires one age per child in the range and a guardian, and stores them', async () => {
    const kids = await seedBookable(client.db, {
      experience: { ageRule: 'age_range', minAge: 6, maxAge: 12 },
    });
    const hold = await holdFor(client.db, kids, guestA, {
      adults: 1,
      children: 2,
    });
    const before = await tally();
    const guardian = { name: 'Pat Smith', contact: 'pat@example.com' };

    expect(
      refused(
        await start(
          {
            attendees: { ageConfirmed: true, childrenAges: [7, 15], guardian },
          },
          hold.id,
        ),
      ),
    ).toEqual({
      status: 'invalid',
      fieldErrors: { 'attendees.childrenAges': 'out_of_range' },
    });
    expect(await tally()).toEqual(before);

    await start(
      { attendees: { ageConfirmed: true, childrenAges: [7, 9], guardian } },
      hold.id,
    );
    expect(await orderOf(hold.id)).toMatchObject({
      ageConfirmed: true,
      childrenAges: [7, 9],
      guardianName: 'Pat Smith',
      guardianContact: 'pat@example.com',
      ticketSubtotalMinor: 5000 + 2 * 2500,
    });
  });

  it('refuses an amount the provider would not take, writing nothing', async () => {
    const cheap = await seedBookable(client.db);
    const hold = await holdFor(client.db, cheap, guestA);
    await client.db.execute(
      sql`UPDATE hold_items SET unit_price_minor = 10 WHERE hold_id = ${hold.id}`,
    );
    const before = await tally();

    expect(refused(await start({}, hold.id))).toEqual({
      status: 'invalid',
      fieldErrors: { holdId: 'not_payable' },
    });
    expect(await tally()).toEqual(before);
  });

  it('refuses a form that does not parse, without reading anything', async () => {
    const before = await tally();

    const result = refused(
      await checkout.startPaymentTx(
        guestA,
        { ...formFor('not-an-id', terms.id) },
        'fake',
      ),
    );

    expect(result).toEqual({
      status: 'invalid',
      fieldErrors: { holdId: 'invalid' },
    });
    expect(await tally()).toEqual(before);
  });
});

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

describe('the order reference', () => {
  it('tries again after a clash with an existing reference', async () => {
    const holdOne = await holdFor(client.db, bookable, guestA);
    const holdTwo = await holdFor(client.db, bookable, guestB);
    random.next = () => 0;
    const first = proceeded(await start({}, holdOne.id));
    expect(first.order.reference).toBe('RMB-000000');

    let calls = 0;
    random.next = () => {
      calls += 1;
      return calls <= 6 ? 0 : 1;
    };
    const second = proceeded(await start({}, holdTwo.id, guestB));

    expect(second.order.reference).toBe('RMB-111111');
    expect(calls).toBe(12);
  });

  it('gives up after three clashes, writing nothing', async () => {
    const holdThree = await holdFor(client.db, bookable, guestA);
    const before = await tally();
    random.next = () => 0;

    await expect(start({}, holdThree.id)).rejects.toThrow(
      'No free order reference in 3 tries',
    );
    expect(await tally()).toEqual(before);
    expect((await storedHold(holdThree.id)).status).toBe('active');
  });
});

describe('storing the provider payment', () => {
  async function attempt(device = guestA) {
    const hold = await holdFor(client.db, bookable, device);
    return proceeded(await start({}, hold.id, device)).attempt.id;
  }

  async function storedId(attemptId: string) {
    const [row] = await client.db
      .select({ id: paymentAttempts.providerPaymentId })
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, attemptId));
    return row?.id;
  }

  it('stores the id once, and the same id again is stored already', async () => {
    const id = await attempt();
    const paymentId = payId('once');

    await expect(
      checkout.recordProviderPayment(guestA, id, paymentId),
    ).resolves.toBe(true);
    await expect(
      checkout.recordProviderPayment(guestA, id, paymentId),
    ).resolves.toBe(true);

    expect(await storedId(id)).toBe(paymentId);
  });

  it('never replaces a different id', async () => {
    const id = await attempt();
    const first = payId('first');
    await checkout.recordProviderPayment(guestA, id, first);

    await expect(
      checkout.recordProviderPayment(guestA, id, payId('second')),
    ).resolves.toBe(false);

    expect(await storedId(id)).toBe(first);
  });

  it.each(['succeeded', 'canceled'] as const)(
    'never writes to a %s attempt',
    async (status) => {
      const id = await attempt();
      await client.db
        .update(paymentAttempts)
        .set(
          status === 'canceled'
            ? { status, failedTries: 1, failureCode: 'x' }
            : { status },
        )
        .where(eq(paymentAttempts.id, id));

      await expect(
        checkout.recordProviderPayment(guestA, id, payId('late')),
      ).resolves.toBe(false);

      expect(await storedId(id)).toBeNull();
    },
  );

  it('refuses another device’s attempt and an unknown one, writing nothing', async () => {
    const id = await attempt();

    await expect(
      checkout.recordProviderPayment(guestB, id, payId('stranger')),
    ).resolves.toBe(false);
    await expect(
      checkout.recordProviderPayment(
        guestA,
        '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        payId('unknown'),
      ),
    ).resolves.toBe(false);

    expect(await storedId(id)).toBeNull();
  });

  it.each([
    ['an attempt id that is not an id', 'nope', 'pay_x'],
    ['a blank payment id', '3f2504e0-4f89-41d3-9a0c-0305e82c3301', ' '],
    [
      'a payment id of 256 characters',
      '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
      'p'.repeat(256),
    ],
  ])('rejects %s', async (_name, attemptId, paymentId) => {
    await expect(
      checkout.recordProviderPayment(guestA, attemptId, paymentId),
    ).rejects.toThrow();
  });

  it('writes an updated_at no earlier than the attempt was created', async () => {
    const id = await attempt();
    await checkout.recordProviderPayment(guestA, id, payId('time'));
    const [row] = await client.db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.id, id));

    expect(row?.updatedAt.getTime()).toBeGreaterThanOrEqual(
      row?.createdAt.getTime() ?? Infinity,
    );
  });
});

describe('recording acceptances', () => {
  const record = async (device: Device, input: unknown) => {
    const legal = await import('@/server/db/legal');
    return client.db.transaction((tx) =>
      legal.recordOrderAcceptances(tx, device, input),
    );
  };

  async function acceptedBy(orderId: string) {
    const rows = await client.db
      .select()
      .from(legalAcceptances)
      .where(eq(legalAcceptances.subjectId, orderId));
    return rows.length;
  }

  it('counts only the versions newly accepted, and a repeat records nothing', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);
    const order = await orderOf(hold.id);
    const waiver = await publishLegal(client.db, 'waiver-repeat', 1);

    await expect(
      record(guestA, {
        orderId: order.id,
        legalDocumentIds: [terms.id, waiver.id],
      }),
    ).resolves.toEqual({ status: 'recorded', recorded: 1 });
    await expect(
      record(guestA, {
        orderId: order.id,
        legalDocumentIds: [terms.id, waiver.id],
      }),
    ).resolves.toEqual({ status: 'recorded', recorded: 0 });
    expect(await acceptedBy(order.id)).toBe(2);
  });

  it.each([
    [
      'another device',
      () => guestB,
      (orderId: string) => ({ orderId, legalDocumentIds: [terms.id] }),
    ],
    [
      'an order that does not exist',
      () => guestA,
      () => ({
        orderId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301',
        legalDocumentIds: [terms.id],
      }),
    ],
    [
      'no versions',
      () => guestA,
      (orderId: string) => ({ orderId, legalDocumentIds: [] }),
    ],
    [
      'a field it does not know',
      () => guestA,
      (orderId: string) => ({
        orderId,
        legalDocumentIds: [terms.id],
        subjectKind: 'host',
      }),
    ],
  ])('refuses %s, writing nothing', async (_name, device, input) => {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);
    const order = await orderOf(hold.id);
    const before = await acceptedBy(order.id);

    await expect(record(device(), input(order.id))).resolves.toEqual({
      status: 'refused',
    });
    expect(await acceptedBy(order.id)).toBe(before);
  });

  it('is refused by the database for a version that is not published', async () => {
    const hold = await holdFor(client.db, bookable, guestA);
    await start({}, hold.id);
    const order = await orderOf(hold.id);
    const [draft] = await client.db
      .insert(legalDocuments)
      .values({
        doc: 'waiver-draft-only',
        version: 1,
        title: 'Draft',
        body: { type: 'doc', content: [] },
      })
      .returning();

    await expect(
      record(guestA, { orderId: order.id, legalDocumentIds: [draft?.id] }),
    ).rejects.toThrow();
  });
});

// Last in the file: it publishes a second terms version, which makes the first stale for every test after it.
describe('a reused order follows the latest form and never changes its money', () => {
  it('updates the contact, lead guest, ages, guardian, acceptances, and guest, and keeps the totals and the rates', async () => {
    const waiver = await publishLegal(client.db, 'waiver-reuse', 1);
    const kids = await seedBookable(client.db, {
      experience: {
        ageRule: 'minimum_age',
        minAge: 5,
        waiverRequired: true,
        waiverDocumentId: waiver.id,
      },
    });
    const hold = await holdFor(client.db, kids, guestA, {
      adults: 1,
      children: 1,
    });
    const guardian = { name: 'Pat Smith', contact: 'pat@example.com' };
    await start(
      {
        leadGuestName: 'Pat Smth',
        attendees: { ageConfirmed: true, childrenAges: [6], guardian },
        waiverDocumentId: waiver.id,
      },
      hold.id,
    );
    const first = await orderOf(hold.id);
    await client.db.update(settings).set({ taxRatePpm: 0 });
    const terms2 = await publishLegal(
      client.db,
      'terms',
      2,
      'Marketplace terms',
    );

    const second = proceeded(
      await checkout.startPaymentTx(
        guestA,
        formFor(hold.id, terms2.id, {
          contact: { email: 'patrick@example.com', phone: '212-555-0111' },
          leadGuestName: 'Pat Smith',
          attendees: {
            ageConfirmed: true,
            childrenAges: [8],
            guardian: { name: 'Patrick Smith', contact: '212-555-0111' },
          },
          waiverDocumentId: waiver.id,
          newsletterOptIn: true,
        }),
        'fake',
      ),
    );
    const updated = await orderOf(hold.id);

    expect(second.order.id).toBe(first.id);
    expect(updated).toMatchObject({
      contactEmail: 'patrick@example.com',
      contactPhone: '212-555-0111',
      leadGuestName: 'Pat Smith',
      childrenAges: [8],
      guardianName: 'Patrick Smith',
      guardianContact: '212-555-0111',
      termsDocumentId: terms2.id,
    });
    expect(updated.guestId).not.toBe(first.guestId);
    expect(updated).toMatchObject({
      reference: first.reference,
      taxRatePpm: first.taxRatePpm,
      taxMinor: first.taxMinor,
      totalMinor: first.totalMinor,
      amountDueMinor: first.amountDueMinor,
      commissionMinor: first.commissionMinor,
      freeCancelUntil: first.freeCancelUntil,
    });
    const accepted = await client.db
      .select({ document: legalAcceptances.legalDocumentId })
      .from(legalAcceptances)
      .where(eq(legalAcceptances.subjectId, first.id));
    expect(accepted.map((row) => row.document).toSorted()).toEqual(
      [terms.id, terms2.id, waiver.id].toSorted(),
    );
  });
});
