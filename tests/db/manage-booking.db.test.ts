import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { setEnv } from '../email/testEnv';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { seedBooking, type BookingWorld } from './confirmOrderFixtures';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
const sendEmail = vi.hoisted(() => vi.fn());
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/ports/email', () => ({ sendEmail }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise: vi.fn() } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch, or risk (orders A and B are bookings confirmed by the real confirm step):
// access
// - the confirmation email for order A carries a manage link, and that link opens /manage/[token] for order A and not for
//   order B; B's link opens B only
// - after bumpTokenVersion the earlier link opens nothing, and the rebuilt link (the next email's) opens A; B's link is untouched
// - a malformed token, an unknown one, and a token of another kind open nothing, and all answer alike
// what the page shows
// - the refund shown first is the refund `cancelBooking` accepts as expectedRefundMinor
// - the window is judged by the database clock, not the app's
// - a cancelled booking shows as cancelled, and one whose session has started as closed
// - each view spends one try of the manage count, and a token over the count gets the too-many-tries page and no booking

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let confirmModule: typeof import('@/server/db/confirmOrder');
let timeModule: typeof import('@/server/db/time');
let tokens: typeof import('@/server/tokens');
let emails: typeof import('@/server/jobs/bookingEmails');
let page: typeof import('@/server/manageBooking');
let actions: typeof import('@/server/actions/orders');
let schema: typeof import('@/server/db/schema');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  confirmModule = await import('@/server/db/confirmOrder');
  timeModule = await import('@/server/db/time');
  tokens = await import('@/server/tokens');
  emails = await import('@/server/jobs/bookingEmails');
  page = await import('@/server/manageBooking');
  actions = await import('@/server/actions/orders');
  schema = await import('@/server/db/schema');
  parents = await createOrderParents(client.db, 'manage');
  await client.db
    .update(schema.hosts)
    .set({ notificationEmail: 'bookings@harborlight.example' })
    .where(eq(schema.hosts.id, parents.hostId));
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
});

beforeEach(() => {
  sendEmail.mockReset();
  sendEmail.mockResolvedValue({ messageId: 'm', status: 'sent' });
});

/** A booking confirmed by the confirm step, with its deadline in an hour. */
async function confirmed(): Promise<BookingWorld & { reference: string }> {
  const world = await seedBooking(client.db, parents);
  await client.db.transaction(async (tx) =>
    confirmModule.confirmOrder(tx, {
      orderId: world.orderId,
      attemptId: world.attemptId,
      providerEventId: randomUUID(),
      providerPaymentId: world.paymentId,
      amountMinor: world.amountDueMinor,
      currency: 'USD',
      feeMinor: 407,
      now: await timeModule.readDatabaseTime(tx),
    }),
  );
  // The provider event job marks the attempt succeeded beside the confirm; this test runs the confirm alone.
  await client.db
    .update(schema.paymentAttempts)
    .set({ status: 'succeeded' })
    .where(eq(schema.paymentAttempts.id, world.attemptId));
  const [order] = await client.db
    .update(schema.orders)
    .set({ freeCancelUntil: sql`now() + make_interval(mins => 60)` })
    .where(eq(schema.orders.id, world.orderId))
    .returning({ reference: schema.orders.reference });
  if (!order) throw new Error('no order');
  return { ...world, reference: order.reference };
}

/** The manage token in the confirmation email the guest-confirmation job sends for the order. */
async function emailedToken(world: BookingWorld): Promise<string> {
  sendEmail.mockClear();
  await client.db.transaction((tx) =>
    emails.sendGuestConfirmation({
      tx,
      payload: { orderId: world.orderId },
      jobId: randomUUID(),
    }),
  );
  const [call] = sendEmail.mock.calls as [
    [{ template: string; data: { manageUrl: string } }],
  ];
  const url = new URL(call[0].data.manageUrl);
  const [, route, token, ...rest] = url.pathname.split('/');
  expect(route).toBe('manage');
  expect(rest).toEqual([]);
  expect(url.origin).toBe('https://ramble.example');
  expect(url.search).toBe('');
  return token ?? '';
}

const notFound = {
  kind: 'refused',
  refusal: { status: 'not_found' },
} as const;

const manageTries = async () => {
  const { rows } = await client.db.execute<{ n: string }>(
    sql`SELECT count(*)::text AS n FROM rate_limits WHERE key LIKE 'manage:%'`,
  );
  return Number(rows[0]?.n);
};

const referenceOf = (
  result: Awaited<ReturnType<typeof page.readManagePage>>,
) => (result.kind === 'ok' ? result.view.booking.reference : result.kind);

describe('what a manage link opens', () => {
  it("opens order A's booking from A's email link and not B's, and B's link opens B", async () => {
    const a = await confirmed();
    const b = await confirmed();

    const tokenA = await emailedToken(a);
    const tokenB = await emailedToken(b);

    expect(tokenA).not.toBe(tokenB);
    expect(referenceOf(await page.readManagePage(tokenA))).toBe(a.reference);
    expect(referenceOf(await page.readManagePage(tokenB))).toBe(b.reference);
    expect(await tokens.resolveToken('manage', tokenA)).toMatchObject({
      id: a.orderId,
    });
  });

  it('opens nothing from the earlier link after a bump, and the rebuilt link opens the order', async () => {
    const a = await confirmed();
    const b = await confirmed();
    const earlier = await emailedToken(a);
    const tokenB = await emailedToken(b);

    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', a.orderId),
    );

    expect(await page.readManagePage(earlier)).toEqual(notFound);
    const rebuilt = await emailedToken(a);
    expect(rebuilt).not.toBe(earlier);
    expect(referenceOf(await page.readManagePage(rebuilt))).toBe(a.reference);
    expect(referenceOf(await page.readManagePage(tokenB))).toBe(b.reference);
  });

  it('answers alike for a malformed token, an unknown one, and one of another kind', async () => {
    const a = await confirmed();

    for (const token of [
      'short',
      'B'.repeat(43),
      tokens.capabilityToken('order', a.orderId, 1),
      tokens.capabilityToken('gift', a.orderId, 1),
    ]) {
      expect(await page.readManagePage(token)).toEqual(notFound);
    }
  });
});

describe('the order a manage token resolves to', () => {
  it('is the order and version, branded as a manage token, and nothing for another kind or a stale link', async () => {
    const a = await confirmed();
    const manage = await emailedToken(a);

    expect(await tokens.resolveManageToken(manage)).toEqual({
      id: a.orderId,
      version: 1,
      kind: 'manage',
    });
    expect(
      await tokens.resolveManageToken(
        tokens.capabilityToken('order', a.orderId, 1),
      ),
    ).toBeNull();
    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'manage', a.orderId),
    );
    expect(await tokens.resolveManageToken(manage)).toBeNull();
  });
});

describe('a token that cannot be one', () => {
  it.each(['short', 'A'.repeat(44), `${'A'.repeat(42)}!`, ''])(
    'is not found and spends no try of the manage count (%s)',
    async (bad) => {
      const tries = await manageTries();

      expect(await page.readManagePage(bad)).toEqual(notFound);
      expect(await manageTries()).toBe(tries);
    },
  );

  it('spends a try for a well-formed token that opens nothing', async () => {
    const tries = await manageTries();

    expect(await page.readManagePage('C'.repeat(43))).toEqual(notFound);
    expect(await manageTries()).toBe(tries + 1);
  });
});

describe('what the page shows', () => {
  it('shows a refund that cancelBooking accepts as the refund expected', async () => {
    const a = await confirmed();
    const token = await emailedToken(a);

    const shown = await page.readManagePage(token);
    if (shown.kind !== 'ok' || shown.view.kind !== 'active') {
      throw new Error('not an active booking');
    }
    expect(shown.view.prompt.refundMinor).toBe(13_000);

    expect(
      await actions.cancelBooking({
        manageToken: token,
        expectedRefundMinor: shown.view.prompt.refundMinor,
      }),
    ).toMatchObject({ status: 'cancelled', refundMinor: 13_000 });
    const after = await page.readManagePage(token);
    expect(after).toMatchObject({ kind: 'ok', view: { kind: 'cancelled' } });
  });

  it('judges the window by the database clock, whatever the app clock says', async () => {
    const a = await confirmed();
    const token = await emailedToken(a);
    vi.useFakeTimers({
      toFake: ['Date'],
      now: Date.now() + 10 * 24 * 60 * 60_000,
    });

    let shown: Awaited<ReturnType<typeof page.readManagePage>>;
    try {
      shown = await page.readManagePage(token);
    } finally {
      vi.useRealTimers();
    }

    expect(shown).toMatchObject({
      kind: 'ok',
      view: { kind: 'active', prompt: { refundMinor: 13_000 } },
    });
  });

  it('shows a booking whose session has started as closed', async () => {
    const a = await confirmed();
    const token = await emailedToken(a);
    await client.db.execute(
      sql`UPDATE sessions SET starts_at = now() - interval '5 minutes', ends_at = now() + interval '90 minutes' WHERE id = ${a.sessionId}`,
    );

    expect(await page.readManagePage(token)).toMatchObject({
      kind: 'ok',
      view: { kind: 'closed' },
    });
  });

  it('spends one try of the manage count for each view, and refuses a token over it', async () => {
    const a = await confirmed();
    const token = await emailedToken(a);
    const { consumeRateLimit } = await import('@/server/ports/rate-limit');

    await page.readManagePage(token);
    expect(await consumeRateLimit('manage', token)).toEqual({
      allowed: true,
      remaining: 28,
    });
    for (let tries = 0; tries < 28; tries += 1) {
      await consumeRateLimit('manage', token);
    }

    const blocked = await page.readManagePage(token);
    expect(blocked).toMatchObject({
      kind: 'refused',
      refusal: { status: 'rate_limited' },
    });
    const wait =
      blocked.kind === 'refused' && blocked.refusal.status === 'rate_limited'
        ? blocked.refusal.retryAfterSeconds
        : 0;
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600);
    expect(JSON.stringify(blocked)).not.toContain(a.reference);
  });
});
