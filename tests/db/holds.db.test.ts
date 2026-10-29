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
import { openHeldSeats, type HoldTimes } from '@/lib/holds';
import { maxAllocation } from '@/lib/sessions';
import { Role } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  holdItems,
  holds,
  priceOptions,
  sessions,
  settings,
} from '@/server/db/schema';
import type { Device } from '@/server/device';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import {
  day,
  hash,
  insertHold,
  insertSession,
  minute,
  seedBookable,
} from './holdFixtures';

// Behaviours under test, one per decision, branch or risk:
// - every CHECK on holds and hold_items refuses its bad row, and each boundary the CHECK allows is accepted
// - reserveSpaces answers held with the hold, its items, and totals for a taxable, a not-taxable and an
//   unknown experience; seats count only space-using lines; ids in capitals work; expires_at follows holdMinutes
// - every refusal writes nothing: invalid input, a party the experience cannot serve, a gift redemption,
//   paused bookings, a missing or hidden or cancelled or completed or started session, sold out
// - sold_out offers other scheduled dates of the same experience with room, and no others
// - spaces left counts seats sold, active holds before their deadline, and paying holds before paying_until,
//   and counts no lapsed, converted or released hold
// - the SQL pre-filter and isOpenHold agree at each boundary, to the millisecond, and the fetch is bounded
// - releaseHold: own active hold released as guest_left; another device's hold, a missing one, a malformed id
//   and a converted one all answer not_found; paying is refused; a second release answers released; a lapsed
//   active hold is released
// - a capacity edit is refused below seats sold plus open holds, allowed at exactly that, and lapsed holds
//   do not block it

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let holdData: typeof import('@/server/db/holds');
let sessionData: typeof import('@/server/db/sessions');
let testDevice: typeof import('@/server/test-device').testDevice;
let guestA: Device;
let guestB: Device;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  holdData = await import('@/server/db/holds');
  sessionData = await import('@/server/db/sessions');
  // The environment module reads DATABASE_URL when it is first imported, so the device waits for the stub.
  ({ testDevice } = await import('@/server/test-device'));
  guestA = testDevice('guest-a');
  guestB = testDevice('guest-b');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db
    .update(settings)
    .set({ bookingsPaused: false, holdMinutes: 10, taxRatePpm: 88_750 });
});

type Bookable = Awaited<ReturnType<typeof seedBookable>>;

const forAdults = (bookable: Bookable, quantity: number) => ({
  sessionId: bookable.session.id,
  items: [{ priceOptionId: bookable.adult.id, quantity }],
  purpose: 'booking' as const,
});

async function holdCount(sessionId: string) {
  const [row] = await client.db
    .select({ total: count() })
    .from(holds)
    .where(eq(holds.sessionId, sessionId));
  return row?.total ?? 0;
}

async function totalHolds() {
  const [row] = await client.db.select({ total: count() }).from(holds);
  return row?.total ?? 0;
}

async function storedHold(id: string) {
  const [row] = await client.db.select().from(holds).where(eq(holds.id, id));
  if (!row) throw new Error('no such hold');
  return row;
}

async function reserveHeld(
  bookable: Bookable,
  quantity: number,
  device = guestA,
) {
  const result = await holdData.reserveSpaces(
    device,
    forAdults(bookable, quantity),
  );
  if (result.status !== 'held') throw new Error(`not held: ${result.status}`);
  return result;
}

describe('constraints on holds', () => {
  let bookable: Bookable;
  beforeAll(async () => {
    bookable = await seedBookable(client.db);
  });

  const now = () => new Date();
  const ago = (ms: number) => new Date(Date.now() - ms);

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
      payingUntil: new Date(Date.now() + 10 * minute),
      expiresAt: new Date(Date.now() + 10 * minute),
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

describe('reserveSpaces answers held', () => {
  it('stores the hold and its items, and returns the totals of a taxable experience', async () => {
    const bookable = await seedBookable(client.db);

    const result = await reserveHeld(bookable, 2);

    expect(result).toMatchObject({ status: 'held', totalMinor: 10_888 });
    expect(result.lines).toEqual([
      {
        priceOptionId: bookable.adult.id,
        kind: 'adult',
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
        lineTotalMinor: 10_000,
      },
    ]);
    const stored = await storedHold(result.holdId);
    expect(stored).toMatchObject({
      sessionId: bookable.session.id,
      purpose: 'booking',
      giftId: null,
      status: 'active',
      seats: 2,
      deviceKey: guestA.deviceKey,
      ipHash: guestA.ipHash,
      payingUntil: null,
      releasedReason: null,
      supersededBy: null,
    });
    expect(stored.createdAt).toEqual(stored.updatedAt);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      10 * minute,
    );
    expect(result.expiresAt).toBe(stored.expiresAt.toISOString());
    expect(
      await client.db
        .select()
        .from(holdItems)
        .where(eq(holdItems.holdId, result.holdId)),
    ).toEqual([
      {
        holdId: result.holdId,
        priceOptionId: bookable.adult.id,
        quantity: 2,
        unitPriceMinor: 5000,
        usesSpace: true,
      },
    ]);
  });

  it.each([
    ['not taxable', 'not_taxable' as const],
    ['of unknown tax treatment', 'unknown' as const],
  ])(
    'charges no tax on an experience that is %s',
    async (_name, taxTreatment) => {
      const bookable = await seedBookable(client.db, {
        experience: { taxTreatment },
      });

      expect(await reserveHeld(bookable, 2)).toMatchObject({
        totalMinor: 10_000,
      });
    },
  );

  it('prices a rate changed in settings', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.update(settings).set({ taxRatePpm: 0 });

    expect(await reserveHeld(bookable, 1)).toMatchObject({ totalMinor: 5000 });
  });

  it('counts only the space-using lines as seats, and snapshots every line', async () => {
    const bookable = await seedBookable(client.db);

    const result = await holdData.reserveSpaces(guestA, {
      sessionId: bookable.session.id,
      items: [
        { priceOptionId: bookable.adult.id, quantity: 2 },
        { priceOptionId: bookable.child.id, quantity: 3 },
      ],
      purpose: 'booking',
    });

    if (result.status !== 'held') throw new Error('not held');
    expect((await storedHold(result.holdId)).seats).toBe(2);
    const items = await client.db
      .select()
      .from(holdItems)
      .where(eq(holdItems.holdId, result.holdId));
    expect(items).toHaveLength(2);
    expect(
      items
        .filter((row) => row.usesSpace)
        .reduce((total, row) => total + row.quantity, 0),
    ).toBe(2);
    expect(result.totalMinor).toBe(Math.round((2 * 5000 + 3 * 2500) * 1.08875));
  });

  it('accepts ids written in capitals', async () => {
    const bookable = await seedBookable(client.db);

    const result = await holdData.reserveSpaces(guestA, {
      sessionId: bookable.session.id.toUpperCase(),
      items: [{ priceOptionId: bookable.adult.id.toUpperCase(), quantity: 1 }],
      purpose: 'booking',
    });

    expect(result.status).toBe('held');
  });

  it('follows the hold length in settings', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.update(settings).set({ holdMinutes: 25 });

    const result = await reserveHeld(bookable, 1);

    const stored = await storedHold(result.holdId);
    expect(stored.expiresAt.getTime() - stored.createdAt.getTime()).toBe(
      25 * minute,
    );
  });

  it('gives a device two holds on two sessions, because supersede is not built', async () => {
    const bookable = await seedBookable(client.db);
    const other = await insertSession(client.db, bookable.experience.id);

    await reserveHeld(bookable, 1);
    const second = await holdData.reserveSpaces(guestA, {
      ...forAdults(bookable, 1),
      sessionId: other.id,
    });

    expect(second.status).toBe('held');
  });
});

describe('reserveSpaces refuses and writes nothing', () => {
  async function expectNothingWritten(
    run: () => Promise<unknown>,
    sessionId?: string,
  ) {
    const holdsBefore = await totalHolds();
    const [items] = await client.db.select({ total: count() }).from(holdItems);
    const answer = await run();
    const [itemsAfter] = await client.db
      .select({ total: count() })
      .from(holdItems);
    expect(await totalHolds()).toBe(holdsBefore);
    expect(itemsAfter?.total).toBe(items?.total);
    if (sessionId) expect(await holdCount(sessionId)).toBe(0);
    return answer;
  }

  it.each([
    [
      'a session id that is not an id',
      (b: Bookable) => ({ ...forAdults(b, 1), sessionId: 'nope' }),
      { sessionId: 'invalid' },
    ],
    [
      'no lines',
      (b: Bookable) => ({ ...forAdults(b, 1), items: [] }),
      { items: 'invalid' },
    ],
    ['quantity 7', (b: Bookable) => forAdults(b, 7), { items: 'invalid' }],
    [
      'a gift token on a booking',
      (b: Bookable) => ({ ...forAdults(b, 1), giftToken: 'abc' }),
      { giftToken: 'invalid' },
    ],
  ])('invalid input: %s', async (_name, build, fieldErrors) => {
    const bookable = await seedBookable(client.db);

    const answer = await expectNothingWritten(
      () => holdData.reserveSpaces(guestA, build(bookable)),
      bookable.session.id,
    );

    expect(answer).toEqual({ status: 'invalid', fieldErrors });
  });

  it('a redemption with no token needs one', async () => {
    const bookable = await seedBookable(client.db);

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          ...forAdults(bookable, 1),
          purpose: 'gift_redemption',
        }),
      bookable.session.id,
    );

    expect(answer).toEqual({
      status: 'invalid',
      fieldErrors: { giftToken: 'required' },
    });
  });

  it('a party of only people who take no space is refused as party_size', async () => {
    const bookable = await seedBookable(client.db);

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          sessionId: bookable.session.id,
          items: [{ priceOptionId: bookable.child.id, quantity: 2 }],
          purpose: 'booking',
        }),
      bookable.session.id,
    );

    expect(answer).toEqual({
      status: 'invalid',
      fieldErrors: { items: 'party_size' },
    });
  });

  it('a party of more than six space-using seats is refused as party_size', async () => {
    const bookable = await seedBookable(client.db);
    await client.db
      .update(priceOptions)
      .set({ usesSpace: true })
      .where(eq(priceOptions.id, bookable.child.id));

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          sessionId: bookable.session.id,
          items: [
            { priceOptionId: bookable.adult.id, quantity: 6 },
            { priceOptionId: bookable.child.id, quantity: 1 },
          ],
          purpose: 'booking',
        }),
      bookable.session.id,
    );

    expect(answer).toEqual({
      status: 'invalid',
      fieldErrors: { items: 'party_size' },
    });
    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 6))).status,
    ).toBe('held');
  });

  it('a price option of another experience is refused as not_offered', async () => {
    const bookable = await seedBookable(client.db);
    const other = await seedBookable(client.db);

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          sessionId: bookable.session.id,
          items: [{ priceOptionId: other.adult.id, quantity: 1 }],
          purpose: 'booking',
        }),
      bookable.session.id,
    );

    expect(answer).toEqual({
      status: 'invalid',
      fieldErrors: { items: 'not_offered' },
    });
  });

  it('a gift redemption is refused until the gift branch exists', async () => {
    const bookable = await seedBookable(client.db);

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          ...forAdults(bookable, 1),
          purpose: 'gift_redemption',
          giftToken: 'a-token',
        }),
      bookable.session.id,
    );

    expect(answer).toEqual({ status: 'unavailable', reason: 'gift_not_valid' });
  });

  it('paused bookings are refused, and resume when ops resume them', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.update(settings).set({ bookingsPaused: true });

    const answer = await expectNothingWritten(
      () => holdData.reserveSpaces(guestA, forAdults(bookable, 1)),
      bookable.session.id,
    );
    await client.db.update(settings).set({ bookingsPaused: false });

    expect(answer).toEqual({
      status: 'unavailable',
      reason: 'bookings_paused',
    });
    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 1))).status,
    ).toBe('held');
  });

  it('a session that does not exist and one of a hidden experience get one answer', async () => {
    const hidden = await Promise.all(
      (['draft', 'in_review', 'paused'] as const).map(async (status) => {
        const bookable = await seedBookable(client.db, {
          experience: { status },
        });
        return bookable.session.id;
      }),
    );
    const guideOnly = await seedBookable(client.db, {
      experience: {
        status: 'guide_only',
        linkOutUrl: 'https://example.com/tour',
      },
    });

    const answers = await expectNothingWritten(() =>
      Promise.all(
        [
          ...hidden,
          guideOnly.session.id,
          '1f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f',
        ].map((sessionId) =>
          holdData.reserveSpaces(guestA, {
            sessionId,
            items: [{ priceOptionId: guideOnly.adult.id, quantity: 1 }],
            purpose: 'booking',
          }),
        ),
      ),
    );

    expect(
      new Set((answers as unknown[]).map((answer) => JSON.stringify(answer))),
    ).toEqual(
      new Set([
        JSON.stringify({
          status: 'invalid',
          fieldErrors: { sessionId: 'invalid' },
        }),
      ]),
    );
  });

  it.each([
    [
      'cancelled',
      { status: 'cancelled' as const, cancelReason: 'host' as const },
    ],
    ['completed', { status: 'completed' as const }],
  ])('a %s session is refused as cancelled', async (_name, override) => {
    const bookable = await seedBookable(client.db);
    await client.db
      .update(sessions)
      .set(override)
      .where(eq(sessions.id, bookable.session.id));

    const answer = await expectNothingWritten(
      () => holdData.reserveSpaces(guestA, forAdults(bookable, 1)),
      bookable.session.id,
    );

    expect(answer).toEqual({
      status: 'unavailable',
      reason: 'session_cancelled',
    });
  });

  it('a session that has started is refused as past', async () => {
    const bookable = await seedBookable(client.db);
    const started = await insertSession(client.db, bookable.experience.id, {
      startsAt: new Date(Date.now() - 60 * minute),
      endsAt: new Date(Date.now() + 60 * minute),
    });

    const answer = await expectNothingWritten(
      () =>
        holdData.reserveSpaces(guestA, {
          ...forAdults(bookable, 1),
          sessionId: started.id,
        }),
      started.id,
    );

    expect(answer).toEqual({ status: 'unavailable', reason: 'past' });
  });
});

describe('sold out', () => {
  it('refuses a party that does not fit, writing nothing, and takes the last spaces for one that does', async () => {
    const bookable = await seedBookable(client.db, { allocation: 3 });
    await reserveHeld(bookable, 2, guestA);

    const tooMany = await holdData.reserveSpaces(
      guestB,
      forAdults(bookable, 2),
    );
    const lastOne = await holdData.reserveSpaces(
      guestB,
      forAdults(bookable, 1),
    );
    const none = await holdData.reserveSpaces(
      testDevice('guest-c'),
      forAdults(bookable, 1),
    );

    expect(tooMany).toEqual({ status: 'sold_out', alternatives: [] });
    expect(lastOne.status).toBe('held');
    expect(none.status).toBe('sold_out');
    expect(await holdCount(bookable.session.id)).toBe(2);
  });

  it('counts the seats already sold', async () => {
    const bookable = await seedBookable(client.db, { allocation: 5 });
    await client.db
      .update(sessions)
      .set({ seatsSold: 4 })
      .where(eq(sessions.id, bookable.session.id));

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('sold_out');
    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 1))).status,
    ).toBe('held');
  });

  it('offers other dates of the same experience that have room, soonest first, and no others', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });
    const experienceId = bookable.experience.id;
    const startsIn = (days: number) => ({
      startsAt: new Date(Date.now() + days * day),
      endsAt: new Date(Date.now() + days * day + 60 * minute),
    });
    const soon = await insertSession(client.db, experienceId, startsIn(2));
    const later = await insertSession(client.db, experienceId, startsIn(9));
    const heldElsewhere = await insertSession(client.db, experienceId, {
      ...startsIn(3),
      allocation: 4,
    });
    await insertHold(client.db, heldElsewhere.id, { seats: 3 });
    await insertSession(client.db, experienceId, {
      ...startsIn(4),
      status: 'cancelled',
      cancelReason: 'host',
    });
    await insertSession(client.db, experienceId, startsIn(30));
    await insertSession(client.db, experienceId, {
      ...startsIn(5),
      allocation: 0,
    });
    const otherExperience = await seedBookable(client.db);
    await reserveHeld(bookable, 1, guestA);

    const answer = await holdData.reserveSpaces(guestB, forAdults(bookable, 1));

    expect(answer).toMatchObject({ status: 'sold_out' });
    if (answer.status !== 'sold_out') throw new Error('expected sold out');
    expect(answer.alternatives.map((summary) => summary.sessionId)).toEqual([
      soon.id,
      heldElsewhere.id,
      later.id,
    ]);
    expect(answer.alternatives.map((summary) => summary.spacesLeft)).toEqual([
      10, 1, 10,
    ]);
    expect(answer.alternatives[0]).toEqual({
      sessionId: soon.id,
      startsAt: soon.startsAt.toISOString(),
      timeZone: 'America/New_York',
      spacesLeft: 10,
    });
    expect(
      answer.alternatives.map((summary) => summary.sessionId),
    ).not.toContain(otherExperience.session.id);
  });

  it('leaves out a date that cannot take the whole party, and offers at most three', async () => {
    const bookable = await seedBookable(client.db, { allocation: 1 });
    const experienceId = bookable.experience.id;
    const startsIn = (days: number) => ({
      startsAt: new Date(Date.now() + days * day),
      endsAt: new Date(Date.now() + days * day + 60 * minute),
    });
    await insertSession(client.db, experienceId, {
      ...startsIn(2),
      allocation: 1,
    });
    for (const days of [3, 4, 5, 6]) {
      await insertSession(client.db, experienceId, {
        ...startsIn(days),
        allocation: 2,
      });
    }
    await reserveHeld(bookable, 1, guestA);

    const answer = await holdData.reserveSpaces(guestB, forAdults(bookable, 2));

    if (answer.status !== 'sold_out') throw new Error('expected sold out');
    expect(answer.alternatives).toHaveLength(3);
    expect(
      answer.alternatives.every((summary) => summary.spacesLeft >= 2),
    ).toBe(true);
  });
});

describe('which holds count', () => {
  const past = (ms: number) => new Date(Date.now() - ms);
  const ahead = (ms: number) => new Date(Date.now() + ms);

  it('counts an active hold before its deadline and not one past it', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    await insertHold(client.db, bookable.session.id, {
      seats: 2,
      createdAt: past(20 * minute),
      updatedAt: past(20 * minute),
      expiresAt: past(10 * minute),
    });

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('held');
    expect(
      (await holdData.reserveSpaces(guestB, forAdults(bookable, 1))).status,
    ).toBe('sold_out');
  });

  it('counts a paying hold past expires_at but before paying_until, and not past paying_until', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    const stillPaying = await insertHold(client.db, bookable.session.id, {
      seats: 2,
      status: 'paying',
      createdAt: past(12 * minute),
      updatedAt: past(12 * minute),
      expiresAt: past(2 * minute),
      payingUntil: ahead(3 * minute),
    });

    const refused = await holdData.reserveSpaces(
      guestA,
      forAdults(bookable, 1),
    );
    await client.db
      .update(holds)
      .set({ payingUntil: past(1000) })
      .where(eq(holds.id, stillPaying.id));
    const accepted = await holdData.reserveSpaces(
      guestA,
      forAdults(bookable, 2),
    );

    expect(refused.status).toBe('sold_out');
    expect(accepted.status).toBe('held');
  });

  it.each([
    ['converted', { status: 'converted' as const }],
    [
      'released',
      { status: 'released' as const, releasedReason: 'guest_left' as const },
    ],
  ])('does not count a %s hold', async (_name, override) => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    await insertHold(client.db, bookable.session.id, { seats: 2, ...override });

    expect(
      (await holdData.reserveSpaces(guestA, forAdults(bookable, 2))).status,
    ).toBe('held');
  });
});

describe('the SQL pre-filter and isOpenHold', () => {
  const at = new Date('2026-11-01T12:00:00.000Z');
  const createdAt = new Date('2026-11-01T11:55:00.000Z');

  async function seedAgreement() {
    const bookable = await seedBookable(client.db, { allocation: 500 });
    const sessionId = bookable.session.id;
    const common = { createdAt, updatedAt: createdAt };
    const activeAt = (expires: string) =>
      insertHold(client.db, sessionId, {
        ...common,
        expiresAt: sql`${expires}::timestamptz`,
      });
    const payingAt = (until: string) =>
      insertHold(client.db, sessionId, {
        ...common,
        status: 'paying',
        expiresAt: new Date('2026-11-01T11:56:00.000Z'),
        payingUntil: sql`${until}::timestamptz`,
        seats: 2,
      });
    await activeAt('2026-11-01 11:59:59.999+00');
    await activeAt('2026-11-01 12:00:00.000+00');
    await activeAt('2026-11-01 12:00:00.000500+00');
    await activeAt('2026-11-01 12:00:00.001+00');
    await activeAt('2026-11-01 12:00:00.001999+00');
    await payingAt('2026-11-01 11:59:59.999+00');
    await payingAt('2026-11-01 12:00:00.000+00');
    await payingAt('2026-11-01 12:00:00.000999+00');
    await payingAt('2026-11-01 12:00:00.001+00');
    return sessionId;
  }

  it('count the same seats at each boundary, down to the millisecond', async () => {
    const sessionId = await seedAgreement();
    const rows: (HoldTimes & { seats: number })[] = await client.db
      .select({
        status: holds.status,
        expiresAt: holds.expiresAt,
        payingUntil: holds.payingUntil,
        seats: holds.seats,
      })
      .from(holds)
      .where(eq(holds.sessionId, sessionId));

    const fromSql = await client.db.transaction((tx) =>
      holdData.readOpenHeldSeats(tx, sessionId, at),
    );

    expect(fromSql).toBe(openHeldSeats(rows, at));
    // Open: the two active holds ending at .001 and .001999 (1 seat each) and the paying hold ending
    // at .001 (2 seats). A deadline within the millisecond of `at` (.000, .000500, .000999) is reached.
    expect(fromSql).toBe(1 + 1 + 2);
  });

  it('refuses more open holds than the largest capacity', async () => {
    const bookable = await seedBookable(client.db);
    await client.db.execute(sql`
      INSERT INTO holds (session_id, purpose, status, seats, device_key, ip_hash, expires_at, created_at, updated_at)
      SELECT ${bookable.session.id}, 'booking', 'active', 1, ${hash('c')}, ${hash('d')},
             ${at}::timestamptz + interval '5 minutes', ${createdAt}, ${createdAt}
      FROM generate_series(1, ${maxAllocation + 1})
    `);

    await expect(
      client.db.transaction((tx) =>
        holdData.readOpenHeldSeats(tx, bookable.session.id, at),
      ),
    ).rejects.toThrow(RangeError);
  });
});

describe('releaseHold', () => {
  it("releases the device's active hold as guest_left, and keeps its items", async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 2);

    const answer = await holdData.releaseHold(guestA, { holdId });

    expect(answer).toEqual({ status: 'released' });
    const stored = await storedHold(holdId);
    expect(stored).toMatchObject({
      status: 'released',
      releasedReason: 'guest_left',
    });
    expect(stored.updatedAt.getTime()).toBeGreaterThanOrEqual(
      stored.createdAt.getTime(),
    );
    expect(
      await client.db
        .select()
        .from(holdItems)
        .where(eq(holdItems.holdId, holdId)),
    ).toHaveLength(1);
  });

  it('frees the spaces at once', async () => {
    const bookable = await seedBookable(client.db, { allocation: 2 });
    const { holdId } = await reserveHeld(bookable, 2);

    await holdData.releaseHold(guestA, { holdId });

    expect(
      (await holdData.reserveSpaces(guestB, forAdults(bookable, 2))).status,
    ).toBe('held');
  });

  it('accepts the id in capitals', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1);

    expect(
      await holdData.releaseHold(guestA, { holdId: holdId.toUpperCase() }),
    ).toEqual({ status: 'released' });
  });

  it('answers a second release as released and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1);
    await holdData.releaseHold(guestA, { holdId });
    const first = await storedHold(holdId);

    const again = await holdData.releaseHold(guestA, { holdId });

    expect(again).toEqual({ status: 'released' });
    expect(await storedHold(holdId)).toEqual(first);
  });

  it('releases an active hold that has already lapsed', async () => {
    const bookable = await seedBookable(client.db);
    const lapsed = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      createdAt: new Date(Date.now() - 30 * minute),
      updatedAt: new Date(Date.now() - 30 * minute),
      expiresAt: new Date(Date.now() - 20 * minute),
    });

    expect(await holdData.releaseHold(guestA, { holdId: lapsed.id })).toEqual({
      status: 'released',
    });
    expect(await storedHold(lapsed.id)).toMatchObject({
      status: 'released',
      releasedReason: 'guest_left',
    });
  });

  it('refuses a paying hold and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const paying = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'paying',
      payingUntil: new Date(Date.now() + 10 * minute),
      expiresAt: new Date(Date.now() + 10 * minute),
    });
    const before = await storedHold(paying.id);

    expect(await holdData.releaseHold(guestA, { holdId: paying.id })).toEqual({
      status: 'payment_in_progress',
    });
    expect(await storedHold(paying.id)).toEqual(before);
  });

  it('answers another device, a missing hold, a malformed id and a converted hold alike, and changes nothing', async () => {
    const bookable = await seedBookable(client.db);
    const { holdId } = await reserveHeld(bookable, 1, guestA);
    const converted = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'converted',
    });
    const paying = await insertHold(client.db, bookable.session.id, {
      deviceKey: guestA.deviceKey,
      status: 'paying',
      payingUntil: new Date(Date.now() + 10 * minute),
      expiresAt: new Date(Date.now() + 10 * minute),
    });
    const before = [
      await storedHold(holdId),
      await storedHold(converted.id),
      await storedHold(paying.id),
    ];

    const answers = await Promise.all([
      holdData.releaseHold(guestB, { holdId }),
      holdData.releaseHold(guestB, { holdId: paying.id }),
      holdData.releaseHold(guestA, {
        holdId: '2f1c3c3e-1b0e-4d7a-8f6e-0a1b2c3d4e5f',
      }),
      holdData.releaseHold(guestA, { holdId: 'nope' }),
      holdData.releaseHold(guestA, { holdId: converted.id }),
    ]);

    expect(answers).toEqual(
      Array.from({ length: 5 }, () => ({ status: 'not_found' })),
    );
    expect([
      await storedHold(holdId),
      await storedHold(converted.id),
      await storedHold(paying.id),
    ]).toEqual(before);
  });
});

describe('capacity edits count open holds', () => {
  const ops = testCaller({ roles: [Role.Ops] });
  const edit = (bookable: Bookable, allocation: number, version = 1) =>
    sessionData.updateSessionAllocation(ops, {
      sessionId: bookable.session.id,
      allocation,
      expectedVersion: version,
    });

  it('refuses a capacity below the seats sold plus the open holds, naming both', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await client.db
      .update(sessions)
      .set({ seatsSold: 3 })
      .where(eq(sessions.id, bookable.session.id));
    await reserveHeld(bookable, 4);

    expect(await edit(bookable, 6)).toEqual({
      ok: false,
      reason: 'below_sold_and_held',
      seatsSold: 3,
      heldSeats: 4,
    });
    expect(await edit(bookable, 7)).toMatchObject({
      ok: true,
      session: { allocation: 7 },
    });
  });

  it('counts a paying hold that is still inside paying_until', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await insertHold(client.db, bookable.session.id, {
      seats: 5,
      status: 'paying',
      createdAt: new Date(Date.now() - 12 * minute),
      updatedAt: new Date(Date.now() - 12 * minute),
      expiresAt: new Date(Date.now() - 2 * minute),
      payingUntil: new Date(Date.now() + 3 * minute),
    });

    expect(await edit(bookable, 4)).toMatchObject({
      ok: false,
      reason: 'below_sold_and_held',
      heldSeats: 5,
    });
  });

  it('allows a lower capacity when only lapsed or finished holds stand in the way', async () => {
    const bookable = await seedBookable(client.db, { allocation: 8 });
    await insertHold(client.db, bookable.session.id, {
      seats: 5,
      createdAt: new Date(Date.now() - 30 * minute),
      updatedAt: new Date(Date.now() - 30 * minute),
      expiresAt: new Date(Date.now() - 20 * minute),
    });
    await insertHold(client.db, bookable.session.id, {
      seats: 3,
      status: 'converted',
    });
    await insertHold(client.db, bookable.session.id, {
      seats: 3,
      status: 'released',
      releasedReason: 'guest_left',
    });

    expect(await edit(bookable, 1)).toMatchObject({
      ok: true,
      session: { allocation: 1 },
    });
  });

  it('is reached again after a release frees the spaces', async () => {
    const bookable = await seedBookable(client.db, { allocation: 4 });
    const { holdId } = await reserveHeld(bookable, 4);
    expect(await edit(bookable, 2)).toMatchObject({ ok: false });

    await holdData.releaseHold(guestA, { holdId });

    expect(await edit(bookable, 2)).toMatchObject({ ok: true });
  });
});
