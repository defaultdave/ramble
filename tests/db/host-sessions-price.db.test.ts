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
import { holdItems, settings } from '@/server/db/schema';
import type { Device } from '@/server/device';
import { testDevice } from '../deviceFixture';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { clearHolds, seedBookable } from './holdFixtures';
import { holdDbFixtures } from './holdsDbFixtures';
import { ownerOf } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

// Behaviours under test, one per decision, branch or risk:
// - a price change applies only to new bookings (PRD-41): a hold made before it keeps the unit
//   price it was made at, and a hold made after it gets the new price

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let holdData: typeof import('@/server/db/holds');
let sessionData: typeof import('@/server/db/sessions');
let guestA: Device;
let guestB: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  sessionData = await import('@/server/db/sessions');
  guestA = await testDevice('guest-a');
  guestB = await testDevice('guest-b');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await clearHolds(client.db);
  await client.db
    .update(settings)
    .set({ bookingsPaused: false, holdMinutes: 10, taxRatePpm: 88_750 });
});

const { reserveHeld } = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

const unitPrices = async (holdId: string) =>
  (
    await client.db
      .select({ unitPriceMinor: holdItems.unitPriceMinor })
      .from(holdItems)
      .where(eq(holdItems.holdId, holdId))
  ).map((item) => item.unitPriceMinor);

describe('a price change by the host', () => {
  it('leaves a hold made before it at the old price and gives a hold made after it the new one', async () => {
    const bookable = await seedBookable(client.db);
    const owner = ownerOf(bookable.host.id);
    const before = await reserveHeld(bookable, 2);

    const edit = await sessionData.updateSessionPrice(
      owner,
      { sessionId: bookable.session.id, kind: 'adult', priceMinor: 6250 },
      new Date(),
    );
    const after = await reserveHeld(bookable, 1, guestB);

    expect(edit).toEqual({ ok: true, priceMinor: 6250 });
    expect(await unitPrices(before.holdId)).toEqual([5000]);
    expect(after.lines).toEqual([
      expect.objectContaining({
        kind: 'adult',
        quantity: 1,
        unitPriceMinor: 6250,
        lineTotalMinor: 6250,
      }),
    ]);
    expect(await unitPrices(after.holdId)).toEqual([6250]);
  });
});
