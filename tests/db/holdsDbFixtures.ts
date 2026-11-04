import { count, eq } from 'drizzle-orm';
import type { db as Db } from '@/server/db/client';
import type * as HoldData from '@/server/db/holds';
import { holds } from '@/server/db/schema';
import type { Device } from '@/server/device';
import type { seedBookable } from './holdFixtures';

type Database = typeof Db;

export type Bookable = Awaited<ReturnType<typeof seedBookable>>;

export const forAdults = (bookable: Bookable, quantity: number) => ({
  sessionId: bookable.session.id,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

/** Reads and reserves against the database and hold module a test file opened in its beforeAll. */
export function holdDbFixtures(
  getDb: () => Database,
  getHoldData: () => typeof HoldData,
  getDefaultDevice: () => Device,
) {
  async function holdCount(sessionId: string) {
    const [row] = await getDb()
      .select({ total: count() })
      .from(holds)
      .where(eq(holds.sessionId, sessionId));
    return row?.total ?? 0;
  }

  async function totalHolds() {
    const [row] = await getDb().select({ total: count() }).from(holds);
    return row?.total ?? 0;
  }

  async function storedHold(id: string) {
    const [row] = await getDb().select().from(holds).where(eq(holds.id, id));
    if (!row) throw new Error('no such hold');
    return row;
  }

  async function reserveHeld(
    bookable: Bookable,
    quantity: number,
    device = getDefaultDevice(),
  ) {
    const result = await getHoldData().reserveSpaces(
      device,
      forAdults(bookable, quantity),
    );
    if (result.status !== 'held') throw new Error(`not held: ${result.status}`);
    return result;
  }

  return { holdCount, totalHolds, storedHold, reserveHeld };
}
