import { eq } from 'drizzle-orm';
import type { StartPaymentInput } from '@/lib/checkout';
import type { db as Db } from '@/server/db/client';
import { holdItems, legalDocuments, orders } from '@/server/db/schema';
import type { Device } from '@/server/device';
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
