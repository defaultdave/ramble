import { count, eq } from 'drizzle-orm';
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
  holdItems,
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
import { testDevice } from '../deviceFixture';
import {
  clearHolds,
  insertSession,
  minute,
  seedBookable,
} from './holdFixtures';
import { forAdults, holdDbFixtures, type Bookable } from './holdsDbFixtures';

// Behaviours under test, one per decision, branch or risk:
// - every refusal writes nothing: invalid input, a party the experience cannot serve, a gift redemption,
//   paused bookings, a missing or hidden or cancelled or completed or started session, sold out

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

// One instant per test, so every time derived inside a test shares the same base.
let at = Date.now();

beforeEach(async () => {
  at = Date.now();
  // The limits count a device's holds in every session, so a test starts with none.
  await clearHolds(client.db);
  cache.updateTag.mockClear();
  cache.revalidateTag.mockClear();
  await client.db
    .update(settings)
    .set({ bookingsPaused: false, holdMinutes: 10, taxRatePpm: 88_750 });
});

const { holdCount, totalHolds } = holdDbFixtures(
  () => client.db,
  () => holdData,
  () => guestA,
);

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
      startsAt: new Date(at - 60 * minute),
      endsAt: new Date(at + 60 * minute),
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
