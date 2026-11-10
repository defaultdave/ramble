import { randomInt, randomUUID } from 'node:crypto';
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
import {
  jobs,
  messages,
  orderItems,
  orders,
  sessions,
} from '@/server/db/schema';
import { setEnv } from '../email/testEnv';
import { createFreshDatabase, type FreshDatabase } from './harness';
import { insertHold } from './holdFixtures';
import { createOrderParents } from './orderParents';

const testEnv = vi.hoisted((): Record<string, unknown> => ({}));
vi.mock('@/server/env', () => ({ env: testEnv }));
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise: vi.fn() } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Behaviours under test, one per decision, branch, or risk. The session starts 2026-11-07T21:00Z.
// the email
// - the reminder goes to the contact address with the session, the party, and the manage link, and holds no payment
// - one message however many times the handler runs
// - a cancelled order, and a session that has started, send nothing; an order that is not a confirmed booking is refused
// - an order with no manage hash is refused with nothing logged; an order that does not exist is refused
// queuing at confirm
// - the job is due 24 hours before the session, or at once when the booking is made inside that window
// - a replayed confirm writes one job, whose payload is the order id alone
// - a session that has started gets none; an order that does not exist is refused
// the job
// - a drain claims the job only once it is due, and sends the reminder
// - a booking cancelled after the job was queued is claimed and succeeds with nothing sent

let fresh: FreshDatabase;
let client: typeof import('@/server/db/client');
let handlers: typeof import('@/server/jobs/bookingEmails');
let dbEmails: typeof import('@/server/db/sessionReminder');
let tokens: typeof import('@/server/tokens');
let drainModule: typeof import('@/server/jobs/drain');
let parents: Awaited<ReturnType<typeof createOrderParents>>;
let sessionId: string;

const dayBefore = { now: () => new Date('2026-11-06T22:00:00Z') };
const afterStart = { now: () => new Date('2026-11-07T21:00:00Z') };

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  setEnv(testEnv, {
    DATABASE_URL: fresh.url,
    APP_URL: 'https://ramble.example',
  });
  client = await import('@/server/db/client');
  handlers = await import('@/server/jobs/bookingEmails');
  dbEmails = await import('@/server/db/sessionReminder');
  tokens = await import('@/server/tokens');
  drainModule = await import('@/server/jobs/drain');
  parents = await createOrderParents(client.db, 'session-reminder');
  const [session] = await client.db
    .insert(sessions)
    .values({
      experienceId: parents.experienceId,
      startsAt: new Date('2026-11-07T21:00:00Z'),
      endsAt: new Date('2026-11-07T23:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 20,
      source: 'ramble',
    })
    .returning();
  if (!session) throw new Error('missing fixtures');
  sessionId = session.id;
});

afterAll(async () => {
  await client.db.$client.end();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(async () => {
  await client.db.execute(sql`DELETE FROM messages`);
  await client.db.execute(sql`DELETE FROM jobs`);
});

const crockford = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
function reference() {
  return `RMB-${Array.from({ length: 6 }, () => crockford[randomInt(crockford.length)]).join('')}`;
}

/** A taxless booking for one adult, with the manage hash the confirm step writes. */
async function insertOrder(
  status: 'confirmed' | 'cancelled' | 'pending_payment' = 'confirmed',
  withHash = true,
) {
  const id = randomUUID();
  const { id: holdId } = await insertHold(client.db, sessionId);
  const [row] = await client.db
    .insert(orders)
    .values({
      id,
      reference: reference(),
      kind: 'booking',
      status,
      idempotencyKey: `book:${holdId}`,
      holdId,
      sessionId,
      experienceId: parents.experienceId,
      hostId: parents.hostId,
      guestId: parents.guestId,
      contactEmail: 'pat@example.com',
      leadGuestName: 'Pat Rivera',
      termsDocumentId: parents.termsDocumentId,
      ticketSubtotalMinor: 8500,
      taxTreatment: 'not_taxable',
      taxRatePpm: 0,
      taxMinor: 0,
      totalMinor: 8500,
      amountDueMinor: 8500,
      commissionRateBps: 1500,
      commissionMinor: 1275,
      cancellationTierId: parents.tierId,
      freeCancelUntil: new Date('2026-11-06T21:00:00Z'),
      manageTokenHash: withHash
        ? tokens.hashToken(tokens.capabilityToken('manage', id, 1))
        : null,
      manageTokenVersion: 1,
      confirmedAt: status === 'pending_payment' ? null : sql`clock_timestamp()`,
      cancelledAt: status === 'cancelled' ? sql`clock_timestamp()` : null,
      cancelledBy: status === 'cancelled' ? 'guest' : null,
    })
    .returning();
  if (!row) throw new Error('insert returned no order');
  await client.db.insert(orderItems).values({
    orderId: id,
    priceOptionId: parents.priceOptionId,
    label: 'Adult',
    quantity: 1,
    unitPriceMinor: 8500,
    usesSpace: true,
    lineTotalMinor: 8500,
  });
  return row;
}

function runReminder(orderId: string, clock = dayBefore) {
  return client.db.transaction((tx) =>
    handlers.sendSessionReminder({
      tx,
      payload: { orderId },
      jobId: randomUUID(),
      clock,
    }),
  );
}

function enqueueReminder(orderId: string, now: string) {
  return client.db.transaction((tx) =>
    dbEmails.enqueueSessionReminder(tx, { orderId, now: new Date(now) }),
  );
}

const messageRows = () => client.db.select().from(messages);

describe('the session reminder email', () => {
  it('goes to the contact address with the session and the manage link, and no payment', async () => {
    const order = await insertOrder();

    await runReminder(order.id);

    const [row] = await messageRows();
    expect(row).toMatchObject({
      template: 'session-reminder',
      recipient: 'pat@example.com',
      subject: 'Coming up: Experience, Saturday, November 7, 2026',
    });
    expect(row?.textBody).toContain(
      'Saturday, November 7, 2026 at 4:00 PM EST',
    );
    expect(row?.textBody).toContain('1 guest');
    expect(row?.textBody).not.toMatch(/\$\d/);
    expect(row?.html).toContain(tokens.capabilityToken('manage', order.id, 1));
  });

  it('sends one message however many times the handler runs', async () => {
    const order = await insertOrder();

    await runReminder(order.id);
    await runReminder(order.id);

    expect(await messageRows()).toHaveLength(1);
  });

  it('sends nothing for a cancelled order', async () => {
    const order = await insertOrder('cancelled');

    await runReminder(order.id);

    expect(await messageRows()).toHaveLength(0);
  });

  it('sends nothing once the session has started', async () => {
    const order = await insertOrder();

    await runReminder(order.id, afterStart);

    expect(await messageRows()).toHaveLength(0);
  });

  it('refuses an order that is not a confirmed booking, and logs nothing', async () => {
    const order = await insertOrder('pending_payment', false);

    await expect(runReminder(order.id)).rejects.toThrow(
      'the order is not a confirmed booking',
    );
    expect(await messageRows()).toHaveLength(0);
  });

  it('refuses to send a link for an order with no manage hash, and logs nothing', async () => {
    const order = await insertOrder('confirmed', false);

    await expect(runReminder(order.id)).rejects.toThrow('no live manage link');
    expect(await messageRows()).toHaveLength(0);
  });

  it('refuses an order that does not exist', async () => {
    await expect(runReminder(randomUUID())).rejects.toThrow(
      'there is no such booking',
    );
  });
});

describe('queuing the reminder at confirm', () => {
  it.each([
    [
      'days ahead: 24 hours before the session',
      '2026-11-01T00:00:00Z',
      '2026-11-06T21:00:00Z',
    ],
    [
      'inside 24 hours: at once',
      '2026-11-07T10:00:00Z',
      '2026-11-07T10:00:00Z',
    ],
  ])('with the booking made %s', async (_label, now, due) => {
    const order = await insertOrder();

    const queued = await enqueueReminder(order.id, now);

    expect(queued).not.toBeNull();
    const [job] = await client.db.select().from(jobs);
    expect(job).toMatchObject({
      kind: 'session-reminder',
      payload: { orderId: order.id },
      dedupeKey: `session-reminder:${order.id}`,
      status: 'pending',
    });
    expect(job?.runAfter).toEqual(new Date(due));
  });

  it('queues one job however many times the confirm replays', async () => {
    const order = await insertOrder();

    const first = await enqueueReminder(order.id, '2026-11-01T00:00:00Z');
    const again = await enqueueReminder(order.id, '2026-11-02T00:00:00Z');

    expect(first).not.toBeNull();
    expect(again).toBeNull();
    expect(await client.db.select().from(jobs)).toHaveLength(1);
  });

  it('queues nothing for a session that has started', async () => {
    const order = await insertOrder();

    await expect(
      enqueueReminder(order.id, '2026-11-08T00:00:00Z'),
    ).resolves.toBeNull();
    expect(await client.db.select().from(jobs)).toHaveLength(0);
  });

  it('refuses an order that does not exist', async () => {
    await expect(
      enqueueReminder(randomUUID(), '2026-11-01T00:00:00Z'),
    ).rejects.toThrow('needs an order');
  });
});

describe('the reminder job', () => {
  it('is claimed by a drain only once due, and then sends the reminder', async () => {
    const order = await insertOrder();
    await enqueueReminder(order.id, '2026-11-01T00:00:00Z');

    const early = await drainModule.drainJobs({
      now: () => new Date('2026-11-06T20:00:00Z'),
    });
    expect(early.claimed).toBe(0);
    expect(await messageRows()).toHaveLength(0);

    const due = await drainModule.drainJobs(dayBefore);

    expect(due).toMatchObject({ claimed: 1, succeeded: 1 });
    expect((await messageRows()).map((message) => message.template)).toEqual([
      'session-reminder',
    ]);
  });

  it('succeeds with nothing sent for a booking cancelled after it was queued', async () => {
    const order = await insertOrder();
    await enqueueReminder(order.id, '2026-11-01T00:00:00Z');
    await client.db
      .update(orders)
      .set({
        status: 'cancelled',
        cancelledBy: 'guest',
        cancelledAt: sql`clock_timestamp()`,
      })
      .where(eq(orders.id, order.id));

    const report = await drainModule.drainJobs(dayBefore);

    expect(report).toMatchObject({ claimed: 1, succeeded: 1 });
    expect(await messageRows()).toHaveLength(0);
  });
});
