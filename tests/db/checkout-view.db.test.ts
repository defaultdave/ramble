import { eq } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Device } from '@/server/device';
import { holdFor, publishLegal } from './checkoutFixtures';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { seedBookable } from './holdFixtures';
import { testDevice } from '../deviceFixture';

// The checkout page's read of a hold, against a real database. Behaviours under test:
// - the holding device reads its hold: the summary, the party, the deadline, the database clock, and
//   the published terms, priced from what the hold snapshotted
// - another device, a missing hold, a malformed id, and a hold already released all read as nothing
// - a lapsed hold is still read, so the page can say so
// - a page with no published terms is an error, not a page that skips the acceptance

vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let reader: typeof import('@/server/db/checkoutView');
let schema: typeof import('@/server/db/schema');
let guestA: Device;
let guestB: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  schema = await import('@/server/db/schema');
  reader = await import('@/server/db/checkoutView');
  guestA = await testDevice('checkout-view-a');
  guestB = await testDevice('checkout-view-b');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

describe('readCheckoutView', () => {
  it('refuses to build a page while no terms are published', async () => {
    const hold = await holdFor(
      client.db,
      await seedBookable(client.db),
      guestA,
    );
    await expect(reader.readCheckoutView(guestA, hold.id)).rejects.toThrow(
      /terms/,
    );
  });

  it('reads the hold for its device and nobody else', async () => {
    const terms = await publishLegal(client.db, 'terms', 1);
    const bookable = await seedBookable(client.db);
    const hold = await holdFor(client.db, bookable, guestA, { adults: 2 });

    const read = await reader.readCheckoutView(guestA, hold.id);
    expect(read?.view).toMatchObject({
      holdId: hold.id,
      sessionId: bookable.session.id,
      guests: 2,
      children: 0,
      termsDocument: { id: terms.id, href: '/legal/terms' },
      waiverDocument: null,
      party: [{ priceOptionId: bookable.adult.id, quantity: 2 }],
    });
    expect(read?.view.lines[0]?.amountMinor).toBe(
      2 * bookable.adult.priceMinor,
    );
    expect(read?.view.totalMinor).toBe(
      2 * bookable.adult.priceMinor + (read?.view.taxMinor ?? 0),
    );
    expect(new Date(read?.view.serverNow ?? '').getTime()).toBeGreaterThan(0);

    expect(await reader.readCheckoutView(guestB, hold.id)).toBeNull();
  });

  it.each([
    ['a missing hold', '00000000-0000-4000-8000-0000000000aa'],
    ['a malformed id', 'sample'],
  ])('reads %s as nothing', async (_name, id) => {
    expect(await reader.readCheckoutView(guestA, id)).toBeNull();
  });

  it('reads a released hold as nothing', async () => {
    const hold = await holdFor(
      client.db,
      await seedBookable(client.db),
      guestA,
    );
    await client.db
      .update(schema.holds)
      .set({ status: 'released', releasedReason: 'guest_left' })
      .where(eq(schema.holds.id, hold.id));
    expect(await reader.readCheckoutView(guestA, hold.id)).toBeNull();
  });

  it('still reads a lapsed hold, with its deadline in the past', async () => {
    const hold = await holdFor(
      client.db,
      await seedBookable(client.db),
      guestA,
      {
        createdAt: new Date(Date.now() - 3_600_000),
      },
    );
    const read = await reader.readCheckoutView(guestA, hold.id);
    expect(read).not.toBeNull();
    expect(new Date(read?.view.expiresAt ?? '').getTime()).toBeLessThan(
      new Date(read?.view.serverNow ?? '').getTime(),
    );
  });
});
