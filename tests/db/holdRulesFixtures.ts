import { sql } from 'drizzle-orm';
import { afterAll, beforeAll, beforeEach, vi } from 'vitest';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import { clearHolds, insertHold, seedBookable } from './holdFixtures';
import { holdDbFixtures } from './holdsDbFixtures';

// Shared setup for the hold-rules-*.db.test.ts files. Each file mocks next/cache and next/headers itself,
// calls setupHoldRulesDatabase(cache) at its top level for its own schema, then uses client, holdData, and
// the devices under the names it had before the split.

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;

export let client: typeof import('@/server/db/client');
export let holdData: typeof import('@/server/db/holds');
export let guestA: Device;
export let guestB: Device;
export let guestOnA: Device;

export function setupHoldRulesDatabase(cache: {
  updateTag: { mockClear(): unknown };
  revalidateTag: { mockClear(): unknown };
}) {
  beforeAll(async () => {
    fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
    stopHttp = await serveNeonHttp(fresh.url);
    vi.stubEnv('DATABASE_URL', fresh.url);
    client = await import('@/server/db/client');
    holdData = await import('@/server/db/holds');
    guestA = await testDevice('rules-a');
    guestB = await testDevice('rules-b');
    guestOnA = await testDevice('rules-on-a', '198.51.100.7');
    guestA = await testDevice('rules-a', '198.51.100.7');
  });

  afterAll(async () => {
    await client.db.$client.end();
    await stopHttp();
    await fresh.dispose();
    vi.unstubAllEnvs();
  });

  beforeEach(async () => {
    await clearHolds(client.db);
    cache.updateTag.mockClear();
    cache.revalidateTag.mockClear();
    await client.db.execute(
      sql`UPDATE settings SET bookings_paused = false, hold_minutes = 10`,
    );
  });
}

export type Bookable = Awaited<ReturnType<typeof seedBookable>>;

const forAdults = (
  sessionId: string,
  bookable: Bookable,
  quantity: number,
) => ({
  sessionId,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

export async function reserve(
  device: Device,
  bookable: Bookable,
  quantity: number,
  sessionId = bookable.session.id,
) {
  return holdData.reserveSpaces(
    device,
    forAdults(sessionId, bookable, quantity),
  );
}

export async function reserveHeld(
  device: Device,
  bookable: Bookable,
  quantity: number,
  sessionId = bookable.session.id,
) {
  const result = await reserve(device, bookable, quantity, sessionId);
  if (result.status !== 'held') throw new Error(`not held: ${result.status}`);
  return result;
}

export const { totalHolds, storedHold: stored } = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

/** A hold of `device` whose deadline passed `minutesAgo` minutes ago, never converted. */
export function lapsedHold(
  sessionId: string,
  device: Device,
  minutesAgo: number,
  overrides: Parameters<typeof insertHold>[2] = {},
) {
  return insertHold(client.db, sessionId, {
    deviceKey: device.deviceKey,
    ipHash: device.ipHash,
    createdAt: sql`now() - make_interval(mins => ${minutesAgo + 10})`,
    ...overrides,
  });
}
