import { eq } from 'drizzle-orm';
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
  legalAcceptances,
  legalDocuments,
  paymentAttempts,
  settings,
} from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  endCheckoutSuite,
  checkoutReaders,
  proceeded,
  resetCheckoutSettings,
  startCheckoutSuite,
  formFor,
  holdFor,
  publishLegal,
  type Bookable,
  type CheckoutSuite,
} from './checkoutFixtures';
import { seedBookable } from './holdFixtures';

// What the payment path records, against a real database. Behaviours under test:
// - a clash on the order reference tries again, up to 3 tries, and then fails with nothing written
// - the provider's payment id is stored once, only while the attempt is live, and only for the hold's device
// - acceptances are recorded for the holding device only, once each, and the database refuses an unpublished version
// - a reused order follows the latest form (name, phone, email, ages, acceptances) and never its money

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

let suite: CheckoutSuite;
let client: CheckoutSuite['client'];
let checkout: CheckoutSuite['checkout'];
let guestA: Device;
let guestB: Device;
let terms: CheckoutSuite['terms'];
let bookable: Bookable;

beforeAll(async () => {
  suite = await startCheckoutSuite();
  ({ client, checkout, guestA, guestB, terms, bookable } = suite);
});

afterAll(async () => {
  await endCheckoutSuite(suite);
});

beforeEach(async () => {
  random.next = null;
  await resetCheckoutSettings(client.db);
});

const { payId, start, tally, storedHold, orderOf } = checkoutReaders(() => ({
  client,
  checkout,
  terms,
  guestA,
}));

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
