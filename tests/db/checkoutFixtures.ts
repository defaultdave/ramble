import { count, eq } from 'drizzle-orm';
import { vi } from 'vitest';
import type { StartPaymentInput } from '@/lib/checkout';
import type { db as Db } from '@/server/db/client';
import {
  consents,
  guests,
  holdItems,
  holds,
  legalAcceptances,
  legalDocuments,
  orderItems,
  orders,
  paymentAttempts,
  settings,
} from '@/server/db/schema';
import type { Device } from '@/server/device';
import { testDevice } from '../deviceFixture';
import { createFreshDatabase, serveNeonHttp } from './harness';
import { insertHold, seedBookable } from './holdFixtures';

type Database = typeof Db;
export type Bookable = Awaited<ReturnType<typeof seedBookable>>;

/** A legal document version, written as a draft and published, as the product does. */
export async function publishLegal(
  db: Database,
  doc: string,
  version: number,
  title = 'Document',
) {
  const [draft] = await db
    .insert(legalDocuments)
    .values({
      doc,
      version,
      title,
      body: { type: 'doc', content: [] },
    })
    .returning();
  if (!draft) throw new Error('insert returned no document');
  const [published] = await db
    .update(legalDocuments)
    .set({ status: 'published' })
    .where(eq(legalDocuments.id, draft.id))
    .returning();
  if (!published) throw new Error('publish returned no document');
  return published;
}

/**
 * A hold written straight to the tables for the device, with the adult line the bookable
 * experience sells (5000 each, a space each). `createdAt` in the past makes a lapsed hold.
 */
export async function holdFor(
  db: Database,
  bookable: Bookable,
  device: Device,
  options: {
    adults?: number;
    children?: number;
    status?: 'active' | 'paying';
    createdAt?: Date;
    payingUntil?: Date;
  } = {},
) {
  const adults = options.adults ?? 2;
  const children = options.children ?? 0;
  const hold = await insertHold(db, bookable.session.id, {
    deviceKey: device.deviceKey,
    ipHash: device.ipHash,
    seats: adults,
    status: options.status ?? 'active',
    ...(options.createdAt ? { createdAt: options.createdAt } : {}),
    ...(options.payingUntil ? { payingUntil: options.payingUntil } : {}),
  });
  await db.insert(holdItems).values([
    {
      holdId: hold.id,
      priceOptionId: bookable.adult.id,
      quantity: adults,
      unitPriceMinor: bookable.adult.priceMinor,
      usesSpace: true,
    },
    ...(children > 0
      ? [
          {
            holdId: hold.id,
            priceOptionId: bookable.child.id,
            quantity: children,
            unitPriceMinor: bookable.child.priceMinor,
            usesSpace: false,
          },
        ]
      : []),
  ]);
  return hold;
}

/** A form that passes for an experience with no age limit and no waiver. */
export function formFor(
  holdId: string,
  termsDocumentId: string,
  change: Partial<StartPaymentInput> = {},
): StartPaymentInput {
  return {
    holdId,
    contact: { email: 'pat@example.com', phone: '212-555-0100' },
    leadGuestName: 'Pat Smith',
    attendees: {},
    termsDocumentId,
    newsletterOptIn: false,
    ...change,
  };
}

export async function ordersFor(db: Database, holdId: string) {
  return db.select().from(orders).where(eq(orders.holdId, holdId));
}

/**
 * The database, two devices, the published terms and a bookable experience that every checkout
 * suite starts from. The caller's file mocks `next/headers` and ends the suite with `endCheckoutSuite`.
 */
export async function startCheckoutSuite() {
  const fresh = await createFreshDatabase(
    process.env.DATABASE_URL_UNPOOLED ?? '',
  );
  const stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  const client = await import('@/server/db/client');
  const checkout = await import('@/server/db/checkout');
  const tokens = await import('@/server/tokens');
  const guestA = await testDevice('checkout-a');
  const guestB = await testDevice('checkout-b');
  const terms = await publishLegal(client.db, 'terms', 1, 'Marketplace terms');
  const bookable = await seedBookable(client.db);
  return {
    fresh,
    stopHttp,
    client,
    checkout,
    tokens,
    guestA,
    guestB,
    terms,
    bookable,
  };
}

export type CheckoutSuite = Awaited<ReturnType<typeof startCheckoutSuite>>;

export async function endCheckoutSuite(
  suite: Pick<CheckoutSuite, 'client' | 'stopHttp' | 'fresh'>,
) {
  await suite.client.db.$client.end();
  await suite.stopHttp();
  await suite.fresh.dispose();
  vi.unstubAllEnvs();
}

/** The settings every checkout test assumes: bookings open, a 10 minute hold, 5 minutes of grace, 8.875% tax. */
export async function resetCheckoutSettings(database: Database) {
  await database.update(settings).set({
    bookingsPaused: false,
    holdMinutes: 10,
    paymentGraceMinutes: 5,
    taxRatePpm: 88_750,
  });
}

export type Started = Awaited<
  ReturnType<CheckoutSuite['checkout']['startPaymentTx']>
>;

export function proceeded(started: Started) {
  if (started.done) {
    throw new Error(
      `expected a payment to start, got ${started.result.status}`,
    );
  }
  return started;
}

export function refused(started: Started) {
  if (!started.done) throw new Error('expected a refusal');
  return started.result;
}

/** Readers over the suite's database, bound late because the suite starts in `beforeAll`. */
export function checkoutReaders(
  suite: () => Pick<CheckoutSuite, 'client' | 'checkout' | 'terms' | 'guestA'>,
) {
  let payments = 0;
  return {
    /** A provider payment id no other test has used: the column is unique. */
    payId: (label: string) => {
      payments += 1;
      return `pay_${label}_${String(payments)}`;
    },
    start: (
      form: Parameters<typeof formFor>[2],
      holdId: string,
      device = suite().guestA,
    ) => {
      const { checkout, terms } = suite();
      return checkout.startPaymentTx(
        device,
        formFor(holdId, terms.id, form),
        'fake',
      );
    },
    tally: async () => {
      const { db } = suite().client;
      const rows = await Promise.all(
        [
          orders,
          orderItems,
          paymentAttempts,
          guests,
          consents,
          legalAcceptances,
        ].map(async (table) => {
          const [row] = await db.select({ n: count() }).from(table);
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
    },
    storedHold: async (id: string) => {
      const [row] = await suite()
        .client.db.select()
        .from(holds)
        .where(eq(holds.id, id));
      if (!row) throw new Error('no such hold');
      return row;
    },
    orderOf: async (holdId: string) => {
      const [row] = await ordersFor(suite().client.db, holdId);
      if (!row) throw new Error('no order for the hold');
      return row;
    },
    attemptsOf: (orderId: string) => {
      return suite()
        .client.db.select()
        .from(paymentAttempts)
        .where(eq(paymentAttempts.orderId, orderId))
        .orderBy(paymentAttempts.attemptNo);
    },
  };
}
