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
import { reviewInviteDelayMs, reviewWindowMs } from '@/lib/reviews';
import { jobs, messages, orders, reviews } from '@/server/db/schema';
import { setEnv } from '../email/testEnv';
import { dueClock } from '../support/dueClock';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { createOrderParents } from './orderParents';
import { day, hour, insertBooking } from './reviewFixtures';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise: vi.fn() } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk.
// the sweep
// - it invites a confirmed booking whose session ended at least the delay ago, and only that: not a cancelled or unpaid one,
//   not one that ended too recently, not one past the review window, not one that has a review, not one refunded, not one invited before
// - a second sweep queues nothing new, and a sweep at a later time picks up a booking that was too recent before
// - the job's payload is the order id alone, and it is due now
// - the sweep reads past orders already invited, so a backlog drains and does not start again at the same rows
// the email
// - draining sends one message to the contact address, whose link opens that order's review page and no other order's
// - the link's token is of its own kind: a manage token for the same order does not open it, and a bumped version voids it
// - sink mode keeps the token only in the dev mailbox body; the job row and the order row hold none
// - running the handler twice sends one message; a cancelled, reviewed, or not-yet-ended booking sends nothing; no such order is refused
// the test console's invite
// - queueing for an invitable order sends a message when drained, and a second send is a second message
// - a booking that cannot be invited now (cancelled, refunded, not over, past the window) is not queued; a caller without ops or admin is refused
// - the console lists invitable bookings newest session first, and only to ops or admin
// the page and the submit
// - the page read for a good link finds the order and names its session; a wrong token, a token for another order, and a bad shape are invalid, the bad shape spending no try
// - a submit through the link writes the review once; a second, a wrong token, and a link counted out each answer as such
// - a link opened more often than the limit is told to wait

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let handlers: typeof import('@/server/jobs/reviewInvite');
let schedule: typeof import('@/server/jobs/reviewInviteSchedule');
let drain: typeof import('@/server/jobs/drain');
let enqueueModule: typeof import('@/server/jobs/enqueue');
let tokens: typeof import('@/server/tokens');
let form: typeof import('@/server/reviewForm');
let readModule: typeof import('@/server/db/reviews');
let caller: typeof import('@/server/auth/caller');
let parents: Awaited<ReturnType<typeof createOrderParents>>;

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  handlers = await import('@/server/jobs/reviewInvite');
  schedule = await import('@/server/jobs/reviewInviteSchedule');
  drain = await import('@/server/jobs/drain');
  enqueueModule = await import('@/server/jobs/enqueue');
  tokens = await import('@/server/tokens');
  form = await import('@/server/reviewForm');
  readModule = await import('@/server/db/reviews');
  caller = await import('@/server/auth/caller');
  parents = await createOrderParents(client.db, 'review-invites');
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  // Every test starts with no queue, no mail, and no orders waiting to be swept.
  await client.db.execute(sql`DELETE FROM messages`);
  await client.db.execute(sql`DELETE FROM jobs`);
  await client.db.execute(sql`DELETE FROM reviews`);
  await client.db.execute(sql`DELETE FROM rate_limits`);
  await client.db.execute(
    sql`UPDATE orders SET status = 'cancelled', cancelled_at = clock_timestamp(), cancelled_by = 'ramble' WHERE kind = 'booking' AND status = 'confirmed'`,
  );
});

const ops = { userId: 'u', roles: ['ops'], hostIds: [] } as const;
const guestCaller = { userId: 'g', roles: ['guest'], hostIds: [] } as const;

const sweepAt = (now: Date) => schedule.scheduleReviewInvites(now);
const jobRows = () => client.db.select().from(jobs);
const mailRows = () => client.db.select().from(messages);
const drainAll = () => drain.drainJobs(dueClock);
const runHandler = (orderId: string, clockAt = new Date()) =>
  client.db.transaction((tx) =>
    handlers.sendReviewInvite({
      tx,
      payload: { orderId },
      jobId: randomUUID(),
      clock: { now: () => clockAt },
    }),
  );

const reviewTokenIn = (body: string) => {
  const match = /\/review\/(RMB-[0-9A-Z]{6})\/([A-Za-z0-9_-]{43})/.exec(body);
  if (!match?.[1] || !match[2]) throw new Error('no review link in the body');
  return { reference: match[1], token: match[2] };
};

describe('the sweep', () => {
  it('invites only the bookings that are due', async () => {
    const due = await insertBooking(client.db, parents, {
      endedAgoMs: 5 * hour,
    });
    await insertBooking(client.db, parents, { endedAgoMs: hour });
    await insertBooking(client.db, parents, { status: 'cancelled' });
    await insertBooking(client.db, parents, { status: 'pending_payment' });
    await insertBooking(client.db, parents, { refundedTicketMinor: 8500 });
    await insertBooking(client.db, parents, {
      endedAgoMs: reviewWindowMs + day,
    });
    const reviewed = await insertBooking(client.db, parents);
    await client.db.insert(reviews).values({
      orderId: reviewed.id,
      experienceId: parents.experienceId,
      rating: 5,
      body: 'Done already',
    });
    const earlier = await insertBooking(client.db, parents, {
      endedAgoMs: 6 * hour,
    });
    await client.db.transaction((tx) =>
      enqueueModule.enqueue(tx, {
        kind: 'review-invite',
        payload: { orderId: earlier.id },
        dedupeKey: `review-invite:${earlier.id}`,
      }),
    );

    const queued = await sweepAt(new Date());

    expect(queued).toBe(1);
    const rows = await jobRows();
    const payloads = rows.map((row) => row.payload);
    expect(payloads).toContainEqual({ orderId: due.id });
    expect(rows).toHaveLength(2);
  });

  it('queues nothing on a second sweep, and picks up a booking that was too recent at a later time', async () => {
    const recent = await insertBooking(client.db, parents, {
      endedAgoMs: hour,
    });
    const old = await insertBooking(client.db, parents, {
      endedAgoMs: 5 * hour,
    });

    expect(await sweepAt(new Date())).toBe(1);
    expect(await sweepAt(new Date())).toBe(0);
    expect(await sweepAt(new Date(Date.now() + reviewInviteDelayMs))).toBe(1);
    const ids = (await jobRows()).map(
      (row) => (row.payload as { orderId: string }).orderId,
    );
    expect(new Set(ids)).toEqual(new Set([old.id, recent.id]));
  });

  it('writes a job whose payload is the order id alone, due now', async () => {
    const order = await insertBooking(client.db, parents);
    await sweepAt(new Date());
    const [row] = await jobRows();
    expect(row).toMatchObject({
      kind: 'review-invite',
      status: 'pending',
      payload: { orderId: order.id },
      dedupeKey: `review-invite:${order.id}`,
    });
    expect(JSON.stringify(row)).not.toContain('@');
  });

  it('reads past the orders it has invited, oldest session first', async () => {
    const first = await insertBooking(client.db, parents, {
      endedAgoMs: 30 * hour,
    });
    const second = await insertBooking(client.db, parents, {
      endedAgoMs: 20 * hour,
    });
    const third = await insertBooking(client.db, parents, {
      endedAgoMs: 10 * hour,
    });
    const now = new Date();
    const firstBatch = await client.db.transaction((tx) =>
      readModule.readInvitableOrders(tx, now, 2),
    );
    expect(firstBatch.map((row) => row.orderId)).toEqual([first.id, second.id]);
    await sweepAt(now);
    expect(await jobRows()).toHaveLength(3);
    const afterwards = await client.db.transaction((tx) =>
      readModule.readInvitableOrders(tx, now, 2),
    );
    expect(afterwards).toEqual([]);
    expect(third.id).toBeDefined();
  });
});

describe('the invite email', () => {
  it('goes to the contact address with a link that opens that order and no other', async () => {
    const a = await insertBooking(client.db, parents, {
      contactEmail: 'pat@example.com',
    });
    const b = await insertBooking(client.db, parents, {
      contactEmail: 'sam@example.com',
    });
    await sweepAt(new Date());

    await drainAll();

    const sent = await mailRows();
    expect(sent).toHaveLength(2);
    const toPat = sent.find((m) => m.recipient === 'pat@example.com');
    const toSam = sent.find((m) => m.recipient === 'sam@example.com');
    const linkA = reviewTokenIn(toPat?.html ?? '');
    const linkB = reviewTokenIn(toSam?.html ?? '');
    expect(linkA.reference).toBe(a.reference);
    expect(linkB.reference).toBe(b.reference);
    expect(linkA.token).toBe(tokens.capabilityToken('review', a.id, 1));
    await expect(
      tokens.resolveToken('review', linkA.token, a.reference),
    ).resolves.toEqual({ id: a.id, version: 1 });
    await expect(
      tokens.resolveToken('review', linkA.token, b.reference),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken('review', linkB.token, a.reference),
    ).resolves.toBeNull();
    expect(toPat?.subject).toBe('How was Experience?');
  });

  it('is of its own kind: the manage token for the order does not open it, and a bumped version voids it', async () => {
    const order = await insertBooking(client.db, parents);
    const manage = tokens.capabilityToken('manage', order.id, 1);
    const review = tokens.capabilityToken('review', order.id, 1);
    expect(manage).not.toBe(review);
    await expect(
      tokens.resolveToken('review', manage, order.reference),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken('review', review, order.reference),
    ).resolves.toEqual({ id: order.id, version: 1 });

    await client.db.transaction((tx) =>
      tokens.bumpTokenVersion(tx, 'review', order.id),
    );

    await expect(
      tokens.resolveToken('review', review, order.reference),
    ).resolves.toBeNull();
    await expect(
      tokens.resolveToken(
        'review',
        tokens.capabilityToken('review', order.id, 2),
        order.reference,
      ),
    ).resolves.toEqual({ id: order.id, version: 2 });
  });

  it('keeps the token only in the dev mailbox body in sink mode', async () => {
    const order = await insertBooking(client.db, parents);
    await sweepAt(new Date());
    await drainAll();

    const token = tokens.capabilityToken('review', order.id, 1);
    const [row] = await mailRows();
    const { html, textBody, ...rest } = row ?? {};
    expect(html).toContain(token);
    expect(textBody).toContain(token);
    expect(JSON.stringify(rest)).not.toContain(token);
    expect(JSON.stringify(await jobRows())).not.toContain(token);
    expect(JSON.stringify(await client.db.select().from(orders))).not.toContain(
      token,
    );
  });

  it('sends one message when the handler runs twice', async () => {
    const order = await insertBooking(client.db, parents);
    await runHandler(order.id);
    await runHandler(order.id);
    expect(await mailRows()).toHaveLength(1);
  });

  it.each([
    ['a booking cancelled since', { status: 'cancelled' as const }],
    ['a booking refunded since', { refundedTicketMinor: 8500 }],
    ['a session that has not ended', { endedAgoMs: -hour }],
    ['a session past the window', { endedAgoMs: reviewWindowMs + day }],
  ])('sends nothing for %s', async (_label, options) => {
    const order = await insertBooking(client.db, parents, options);
    await runHandler(order.id);
    expect(await mailRows()).toHaveLength(0);
  });

  it('sends nothing for a booking already reviewed', async () => {
    const order = await insertBooking(client.db, parents);
    await client.db.insert(reviews).values({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 4,
      body: 'Already',
    });
    await runHandler(order.id);
    expect(await mailRows()).toHaveLength(0);
  });

  it('refuses an order that does not exist', async () => {
    await expect(runHandler(randomUUID())).rejects.toThrow(
      'Review invite refused: there is no such booking',
    );
  });
});

describe('the test console invite', () => {
  it('queues an invitable booking to run now and sends it when drained, and a second send is a second message', async () => {
    const order = await insertBooking(client.db, parents);
    expect(await schedule.queueReviewInviteNow(ops, order.id)).toBe('queued');
    await drainAll();
    expect(await schedule.queueReviewInviteNow(ops, order.id)).toBe('queued');
    await drainAll();
    const sent = await mailRows();
    expect(sent).toHaveLength(2);
    const links = sent.map((m) => reviewTokenIn(m.html ?? ''));
    expect(links[0]).toEqual(links[1]);
    expect(links[0]?.reference).toBe(order.reference);
  });

  it.each([
    ['cancelled', { status: 'cancelled' as const }],
    ['refunded', { refundedTicketMinor: 2500 }],
    ['not over', { endedAgoMs: -hour }],
    ['past the window', { endedAgoMs: reviewWindowMs + day }],
  ])('does not queue a booking that is %s', async (_label, options) => {
    const order = await insertBooking(client.db, parents, options);
    expect(await schedule.queueReviewInviteNow(ops, order.id)).toBe(
      'not_eligible',
    );
    expect(await jobRows()).toHaveLength(0);
  });

  it('does not queue an order that does not exist, or one already reviewed', async () => {
    expect(await schedule.queueReviewInviteNow(ops, randomUUID())).toBe(
      'not_eligible',
    );
    const order = await insertBooking(client.db, parents);
    await client.db.insert(reviews).values({
      orderId: order.id,
      experienceId: parents.experienceId,
      rating: 4,
      body: 'Already',
    });
    expect(await schedule.queueReviewInviteNow(ops, order.id)).toBe(
      'not_eligible',
    );
  });

  it('refuses a caller without the ops or admin role, and queues nothing', async () => {
    const order = await insertBooking(client.db, parents);
    await expect(
      schedule.queueReviewInviteNow(guestCaller, order.id),
    ).rejects.toBeInstanceOf(caller.ForbiddenError);
    await expect(
      readModule.readInvitableOrderRows(guestCaller),
    ).rejects.toBeInstanceOf(caller.ForbiddenError);
    expect(await jobRows()).toHaveLength(0);
  });

  it('lists invitable bookings newest session first, and none that are not', async () => {
    const older = await insertBooking(client.db, parents, {
      endedAgoMs: 30 * hour,
    });
    const newer = await insertBooking(client.db, parents, {
      endedAgoMs: 4 * hour,
    });
    await insertBooking(client.db, parents, { endedAgoMs: -hour });
    await insertBooking(client.db, parents, { status: 'cancelled' });
    await insertBooking(client.db, parents, { refundedTicketMinor: 8500 });
    const rows = await readModule.readInvitableOrderRows(ops);
    expect(rows.map((row) => row.orderId)).toEqual([newer.id, older.id]);
    expect(rows[0]).toMatchObject({
      reference: newer.reference,
      experienceName: 'Experience',
    });
  });
});

describe('the page and the submit', () => {
  it('finds the order for a good link and names its session', async () => {
    const order = await insertBooking(client.db, parents);
    const token = tokens.capabilityToken('review', order.id, 1);

    const page = await form.readReviewPage(order.reference, token);

    expect(page.read).toMatchObject({
      kind: 'found',
      facts: { kind: 'booking', status: 'confirmed', reviewed: false },
    });
    expect(page.summary).toMatchObject({
      experienceName: 'Experience',
      hostName: 'Host',
    });
  });

  it("answers a wrong token, another order's token, and a bad shape alike, the bad shape without spending a try", async () => {
    const a = await insertBooking(client.db, parents);
    const b = await insertBooking(client.db, parents);
    const tokenB = tokens.capabilityToken('review', b.id, 1);

    for (const [reference, token] of [
      [a.reference, 'A'.repeat(43)],
      [a.reference, tokenB],
      [a.reference, 'short'],
      ['nope', tokenB],
    ] as const) {
      const page = await form.readReviewPage(reference, token);
      expect(page.read).toEqual({ kind: 'invalid' });
      expect(page.summary).toBeNull();
    }
    const spent = await client.db.execute(
      sql`SELECT count(*)::int AS n FROM rate_limits`,
    );
    expect(spent.rows[0]).toEqual({ n: 2 });
  });

  it('writes the review once through the link, then says already reviewed, and refuses a wrong token', async () => {
    const order = await insertBooking(client.db, parents);
    const token = tokens.capabilityToken('review', order.id, 1);
    const input = {
      reference: order.reference,
      token,
      rating: 5,
      body: 'Loved it',
    };

    expect(await form.submitReview(input)).toBe('created');
    expect(await form.submitReview({ ...input, rating: 1 })).toBe(
      'already_reviewed',
    );
    expect(await form.submitReview({ ...input, token: 'A'.repeat(43) })).toBe(
      'not_found',
    );
    const rows = await client.db
      .select()
      .from(reviews)
      .where(eq(reviews.orderId, order.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ rating: 5, body: 'Loved it' });
    const page = await form.readReviewPage(order.reference, token);
    expect(page.read).toMatchObject({
      kind: 'found',
      facts: { reviewed: true },
    });
  });

  it('tells a link opened more often than the limit to wait, with no booking in the answer', async () => {
    const order = await insertBooking(client.db, parents);
    const token = tokens.capabilityToken('review', order.id, 1);
    let last = await form.readReviewPage(order.reference, token);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      last = await form.readReviewPage(order.reference, token);
    }
    expect(last.read).toMatchObject({ kind: 'rate_limited' });
    expect(last.summary).toBeNull();
    expect(
      await form.submitReview({
        reference: order.reference,
        token,
        rating: 5,
        body: 'Too late',
      }),
    ).toBe('rate_limited');
  });
});
