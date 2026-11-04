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
import { isOrderReference } from '@/lib/orders';
import {
  consents,
  guests,
  legalAcceptances,
  orderItems,
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
  formFor,
  holdFor,
  publishLegal,
  type Bookable,
  type CheckoutSuite,
} from './checkoutFixtures';
import { day, minute, seedBookable } from './holdFixtures';

// The first call on a hold, against a real database. Behaviours under test, one per decision, branch or risk:
// - a hold becomes a pending order with every snapshot (key, money, tax and commission rates, tier, free-cancel
//   time, attribution), its lines, the guest, the terms and waiver acceptances, attempt 1 keyed pay:<order>:1 at
//   the amount due, and a paying hold whose deadline is its expiry plus the grace
// - the newsletter consent is written only when ticked, once
// - a form with an age, terms, or waiver issue writes nothing, and the hold stays active

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let suite: CheckoutSuite;
let client: CheckoutSuite['client'];
let checkout: CheckoutSuite['checkout'];
let tokens: CheckoutSuite['tokens'];
let guestA: Device;
let terms: CheckoutSuite['terms'];
let bookable: Bookable;

beforeAll(async () => {
  suite = await startCheckoutSuite();
  ({ client, checkout, tokens, guestA, terms, bookable } = suite);
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
