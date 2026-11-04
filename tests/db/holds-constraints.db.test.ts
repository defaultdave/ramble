import { sql } from 'drizzle-orm';
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
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { testDevice } from '../deviceFixture';
import {
  clearHolds,
  day,
  insertHold,
  minute,
  seedBookable,
} from './holdFixtures';
import { holdDbFixtures, type Bookable } from './holdsDbFixtures';

// Behaviours under test, one per decision, branch or risk:
// - every CHECK on holds and hold_items refuses its bad row, and each boundary the CHECK allows is accepted

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);
vi.mock(
  'next/headers',
  async () => (await import('../deviceFixture')).nextHeadersMock,
);

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let holdData: typeof import('@/server/db/holds');
let guestA: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  guestA = await testDevice('guest-a');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  // The limits count a device's holds in every session, so a test starts with none.
  await clearHolds(client.db);
  cache.updateTag.mockClear();
  cache.revalidateTag.mockClear();
  await client.db
    .update(settings)
    .set({ bookingsPaused: false, holdMinutes: 10, taxRatePpm: 88_750 });
});

const {} = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

describe('constraints on holds', () => {
  let bookable: Bookable;
  beforeAll(async () => {
    bookable = await seedBookable(client.db);
  });

  // One instant per test, so every time derived inside a test shares the same base.
  let at = Date.now();
  beforeEach(() => {
    at = Date.now();
  });
  const now = () => new Date(at);
  const ago = (ms: number) => new Date(at - ms);

  it.each([
    [
      'a booking with a gift',
      'holds_gift_matches_purpose',
      { giftId: '3f2504e0-4f89-41d3-9a0c-0305e82c3301' },
    ],
    [
      'a gift redemption with no gift',
      'holds_gift_matches_purpose',
      { purpose: 'gift_redemption' as const },
    ],
    ['0 seats', 'holds_seats_in_range', { seats: 0 }],
    ['7 seats', 'holds_seats_in_range', { seats: 7 }],
    [
      'a device key of 63 characters',
      'holds_device_key_sha256',
      { deviceKey: 'a'.repeat(63) },
    ],
    [
      'a device key in capitals',
      'holds_device_key_sha256',
      { deviceKey: 'A'.repeat(64) },
    ],
    [
      'a device key that is not hex',
      'holds_device_key_sha256',
      { deviceKey: 'g'.repeat(64) },
    ],
    [
      'an address hash of 65 characters',
      'holds_ip_hash_sha256',
      { ipHash: 'b'.repeat(65) },
    ],
    [
      'an address hash in capitals',
      'holds_ip_hash_sha256',
      { ipHash: 'B'.repeat(64) },
    ],
    [
      'a released reason on an active hold',
      'holds_released_reason_matches_status',
      { releasedReason: 'expired' as const },
    ],
    [
      'a released hold with no reason',
      'holds_released_reason_matches_status',
      { status: 'released' as const },
    ],
    [
      'a paying hold with no deadline',
      'holds_paying_has_deadline',
      { status: 'paying' as const },
    ],
    [
      'a paying deadline before the hold expires',
      'holds_paying_until_not_before_expiry',
      { payingUntil: ago(60 * minute) },
    ],
    [
      'a hold that expires when it is made',
      'holds_expiry_window',
      {
        createdAt: now(),
        updatedAt: now(),
        expiresAt: sql`'2026-01-01 00:00:00+00'::timestamptz`,
      },
    ],
    [
      'a hold that lasts 61 minutes',
      'holds_expiry_window',
      {
        createdAt: ago(61 * minute),
        updatedAt: ago(61 * minute),
        expiresAt: ago(0),
      },
    ],
    [
      'an update time before the creation time',
      'holds_updated_not_before_created',
      { updatedAt: ago(day) },
    ],
    [
      'an expiry in year 10000',
      'holds_expires_at_in_range',
      {
        expiresAt: sql`'10000-01-01 00:00:00+00'::timestamptz`,
        createdAt: sql`'9999-12-31 23:50:00+00'::timestamptz`,
        updatedAt: sql`'9999-12-31 23:50:00+00'::timestamptz`,
      },
    ],
    [
      'an infinite expiry',
      'holds_expires_at_in_range',
      { expiresAt: sql`'infinity'::timestamptz` },
    ],
    [
      'an infinite creation time',
      'holds_created_at_in_range',
      { createdAt: sql`'infinity'::timestamptz` },
    ],
    [
      'an infinite update time',
      'holds_updated_at_in_range',
      { updatedAt: sql`'infinity'::timestamptz` },
    ],
    [
      'an infinite paying deadline',
      'holds_paying_until_in_range',
      { status: 'paying' as const, payingUntil: sql`'infinity'::timestamptz` },
    ],
  ])('refuses %s', async (_name, constraint, override) => {
    await expect(
      insertHold(client.db, bookable.session.id, override),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuses a superseded reason with no newer hold, and a newer hold with another reason', async () => {
    const newer = await insertHold(client.db, bookable.session.id);

    await expect(
      insertHold(client.db, bookable.session.id, {
        status: 'released',
        releasedReason: 'superseded',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_superseded_by_matches_reason' },
    });
    await expect(
      insertHold(client.db, bookable.session.id, {
        status: 'released',
        releasedReason: 'expired',
        supersededBy: newer.id,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_superseded_by_matches_reason' },
    });
    await expect(
      insertHold(client.db, bookable.session.id, { supersededBy: newer.id }),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_superseded_by_matches_reason' },
    });
  });

  it('refuses a hold superseded by itself, and by a hold that does not exist', async () => {
    const id = '5f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f';

    await expect(
      insertHold(client.db, bookable.session.id, {
        id,
        status: 'released',
        releasedReason: 'superseded',
        supersededBy: id,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_not_superseded_by_itself' },
    });
    await expect(
      insertHold(client.db, bookable.session.id, {
        status: 'released',
        releasedReason: 'superseded',
        supersededBy: '6f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_superseded_by_fk' },
    });
  });

  it('refuses a hold on a session that does not exist', async () => {
    await expect(
      insertHold(client.db, '7f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f'),
    ).rejects.toMatchObject({
      cause: { constraint: 'holds_session_id_sessions_id_fk' },
    });
  });

  it('accepts each boundary the CHECKs allow', async () => {
    const created = ago(5 * minute);
    const sixtyMinutes = new Date(created.getTime() + 60 * minute);
    const newer = await insertHold(client.db, bookable.session.id);

    await insertHold(client.db, bookable.session.id, { seats: 1 });
    await insertHold(client.db, bookable.session.id, { seats: 6 });
    await insertHold(client.db, bookable.session.id, {
      createdAt: created,
      updatedAt: created,
      expiresAt: sixtyMinutes,
    });
    await insertHold(client.db, bookable.session.id, {
      status: 'paying',
      payingUntil: new Date(at + 10 * minute),
      expiresAt: new Date(at + 10 * minute),
    });
    await insertHold(client.db, bookable.session.id, {
      status: 'released',
      releasedReason: 'superseded',
      supersededBy: newer.id,
    });
    await insertHold(client.db, bookable.session.id, {
      purpose: 'gift_redemption',
      giftId: '8f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f',
    });
  });
});

describe('constraints on hold_items', () => {
  let bookable: Bookable;
  let hold: Awaited<ReturnType<typeof insertHold>>;
  beforeAll(async () => {
    bookable = await seedBookable(client.db);
  });
  beforeEach(async () => {
    hold = await insertHold(client.db, bookable.session.id);
  });

  const item = (overrides = {}) => ({
    holdId: hold.id,
    priceOptionId: bookable.child.id,
    quantity: 1,
    unitPriceMinor: 2500,
    usesSpace: false,
    ...overrides,
  });

  it.each([
    ['quantity 0', 'hold_items_quantity_in_range', { quantity: 0 }],
    ['quantity 7', 'hold_items_quantity_in_range', { quantity: 7 }],
    [
      'a negative unit price',
      'hold_items_unit_price_in_range',
      { unitPriceMinor: -1 },
    ],
    [
      'a unit price over 10000000',
      'hold_items_unit_price_in_range',
      { unitPriceMinor: 10_000_001 },
    ],
    [
      'a price option that does not exist',
      'hold_items_price_option_id_price_options_id_fk',
      { priceOptionId: '9f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f' },
    ],
    [
      'a hold that does not exist',
      'hold_items_hold_id_holds_id_fk',
      { holdId: 'af1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f' },
    ],
  ])('refuses %s', async (_name, constraint, override) => {
    await expect(
      client.db.insert(holdItems).values(item(override)),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('accepts the limits, and refuses the same price option twice on one hold', async () => {
    await client.db
      .insert(holdItems)
      .values(item({ quantity: 6, unitPriceMinor: 10_000_000 }));

    await expect(
      client.db.insert(holdItems).values(item()),
    ).rejects.toMatchObject({
      cause: { constraint: 'hold_items_hold_id_price_option_id_pk' },
    });
  });
});
