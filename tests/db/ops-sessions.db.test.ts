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
import { opsSessionsPageSize } from '@/lib/opsSessions';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  newSession,
  seedActiveHoldOn,
  seedConfirmedOn,
  seedUnpaidOn,
  sessionOf,
} from './cancelSessionFixtures';
import { insertGift } from './giftFixtures';
import { serveNeonHttp } from './harness';
import {
  client,
  clearJobs,
  getParents,
  refundsOf,
  schema,
  setupRefundsDatabase,
} from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));
setupRefundsDatabase(raise);

// Behaviours under test, against the real database:
// - every function refuses a guest, an admin, nobody, and the host owner of the session's own host, and writes nothing
// - the list shows sold, held and capacity; filters upcoming and past; searches by experience or host; pages by cursor; one audit row per read
// - a session's impact lists its confirmed bookings with the amount each would be refunded, counts unpaid orders and releasable holds, and is audited with ids only
// - a booking with no succeeded payment, or paid in part by a gift, blocks the cancellation before anything is written
// - cancelling goes through cancelSession (booking refunded, session cancelled, the ops user named in the audit rows) when the impact read is still the impact now
// - an impact that changed since it was read (a booking confirmed in between) is refused as stale and writes nothing
// - a session that has started is refused server-side, whatever the form shows
// - a cancellation whose audit row cannot be written rolls back whole: the session stays scheduled, the booking confirmed, no refund, no audit row

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const day = 86_400_000;
const wrong = '9:9:9:9:9:9';

const refused: [string, () => Caller][] = [
  ['a guest', () => testCaller({ userId: randomUUID() })],
  [
    'the host owner of the session’s own host',
    () =>
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostOwner],
        hostIds: [getParents().hostId],
      }),
  ],
  [
    'a host owner of another host',
    () =>
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostOwner],
        hostIds: [randomUUID()],
      }),
  ],
  ['an admin', () => testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', () => ({ userId: null, roles: [], hostIds: [] })],
];

let stopHttp: () => Promise<void>;
let data: typeof import('@/server/db/opsSessions');

beforeAll(async () => {
  stopHttp = await serveNeonHttp(process.env.DATABASE_URL ?? '');
  data = await import('@/server/db/opsSessions');
});
afterAll(async () => {
  await stopHttp();
});
beforeEach(async () => {
  await clearJobs();
  await client.db.execute(sql`DROP TRIGGER IF EXISTS fail_audit ON audit_log`);
  // Sessions of earlier tests share the experience: only the ones a test makes are scheduled.
  await client.db.execute(
    sql`UPDATE sessions SET status = 'completed' WHERE status = 'scheduled'`,
  );
});

const auditCount = async (action?: string) =>
  Number(
    (
      await client.db.execute(
        action === undefined
          ? sql`SELECT count(*) AS n FROM audit_log`
          : sql`SELECT count(*) AS n FROM audit_log WHERE action = ${action}`,
      )
    ).rows[0]?.n,
  );

/** Makes the audit log refuse a row of this action, as a database outage would. */
async function breakAudit(action: string) {
  await client.db.execute(sql`
    CREATE OR REPLACE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'audit is down'; END $$`);
  await client.db.execute(
    sql.raw(
      `CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.action = '${action}') EXECUTE FUNCTION fail_audit()`,
    ),
  );
}

async function giftPaidBooking(sessionId: string) {
  const booking = await seedConfirmedOn(sessionId, 2);
  const gift = await insertGift(client.db, getParents());
  await client.db
    .update(schema.orders)
    .set({
      giftId: gift.id,
      giftAppliedMinor: 1000,
      amountDueMinor: sql`${schema.orders.totalMinor} - 1000`,
    })
    .where(eq(schema.orders.id, booking.orderId));
  return booking;
}

const fingerprintOf = async (sessionId: string) => {
  const detail = await data.readOpsSession(ops, sessionId);
  if (!detail) throw new Error('no session');
  return detail.impact.fingerprint;
};

const orderOf = async (orderId: string) =>
  (
    await client.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
  )[0];

describe('access', () => {
  it.each(refused)(
    'refuses %s every function and writes nothing',
    async (_name, caller) => {
      const session = await newSession();
      const before = await auditCount();
      const who = caller();
      const attempts = [
        () => data.readOpsSessions(who, { when: null, term: '', cursor: null }),
        () => data.readOpsSession(who, session.id),
        () =>
          data.cancelSessionAsOps(who, {
            sessionId: session.id,
            reason: 'ramble',
            fingerprint: wrong,
          }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await auditCount()).toBe(before);
      expect((await sessionOf(session.id)).status).toBe('scheduled');
    },
  );
});

describe('readOpsSessions', () => {
  it('shows sold, held and capacity, and records one audit row', async () => {
    const session = await newSession({ allocation: 8 });
    await seedConfirmedOn(session.id, 3);
    await seedActiveHoldOn(session.id, 2);
    const before = await auditCount('sessions.list_viewed');

    const page = await data.readOpsSessions(ops, {
      when: 'upcoming',
      term: '',
      cursor: null,
    });

    expect(page.rows.find((row) => row.id === session.id)).toMatchObject({
      sold: 3,
      held: 2,
      capacity: 8,
      experienceName: 'Experience',
      hostName: 'Host',
      statusLabel: 'Scheduled',
    });
    expect(await auditCount('sessions.list_viewed')).toBe(before + 1);
  });

  it('filters upcoming and past, and searches the experience or host name', async () => {
    const future = await newSession({
      startsAt: new Date(Date.now() + 40 * day),
    });
    const past = await newSession({
      startsAt: new Date(Date.now() - 40 * day),
      status: 'completed',
    });
    const ids = async (options: Parameters<typeof data.readOpsSessions>[1]) =>
      (await data.readOpsSessions(ops, options)).rows.map((row) => row.id);

    expect(await ids({ when: 'upcoming', term: '', cursor: null })).toContain(
      future.id,
    );
    expect(
      await ids({ when: 'upcoming', term: '', cursor: null }),
    ).not.toContain(past.id);
    expect(await ids({ when: 'past', term: '', cursor: null })).toContain(
      past.id,
    );
    expect(await ids({ when: 'past', term: '', cursor: null })).not.toContain(
      future.id,
    );
    expect(await ids({ when: null, term: 'xperienc', cursor: null })).toContain(
      future.id,
    );
    expect(await ids({ when: null, term: 'ost', cursor: null })).toContain(
      past.id,
    );
    expect(
      await ids({ when: null, term: 'nothing like it', cursor: null }),
    ).toEqual([]);
    expect(await ids({ when: null, term: '100%', cursor: null })).toEqual([]);
  });

  it('pages by cursor so each session shows once, and starts again from the first page for a cursor that is no id', async () => {
    for (let n = 0; n < opsSessionsPageSize + 3; n += 1) {
      await newSession({ startsAt: new Date(Date.now() + (100 + n) * day) });
    }
    const options = { when: 'upcoming', term: '' } as const;
    const first = await data.readOpsSessions(ops, { ...options, cursor: null });
    expect(first.rows).toHaveLength(opsSessionsPageSize);
    expect(first.nextCursor).not.toBeNull();
    const second = await data.readOpsSessions(ops, {
      ...options,
      cursor: first.nextCursor,
    });
    const seen = new Set(first.rows.map((row) => row.id));
    expect(second.rows.length).toBeGreaterThan(0);
    expect(second.rows.some((row) => seen.has(row.id))).toBe(false);
    const again = await data.readOpsSessions(ops, {
      ...options,
      cursor: 'not-an-id',
    });
    expect(again.rows.map((row) => row.id)).toEqual(
      first.rows.map((row) => row.id),
    );
  });
});

describe('readOpsSession', () => {
  it('lists the bookings with the amount each is refunded, and audits the read by id', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    await seedUnpaidOn(session.id);
    const order = await orderOf(booking.orderId);
    const before = await auditCount('session.viewed');

    const detail = await data.readOpsSession(ops, session.id);

    expect(detail?.session).toMatchObject({ id: session.id, canCancel: true });
    expect(detail?.impact.bookings).toHaveLength(1);
    expect(detail?.impact.bookings[0]?.reference).toBe(order?.reference);
    expect(detail?.impact.summary).toMatch(
      /1 booking refunded in full.*1 unpaid order voided; 1 hold released\.$/,
    );
    expect(await auditCount('session.viewed')).toBe(before + 1);
    const rows = await client.db.execute(
      sql`SELECT actor_id, subject_id, details FROM audit_log WHERE action = 'session.viewed' AND subject_id = ${session.id}`,
    );
    expect(rows.rows[0]).toMatchObject({
      actor_id: opsUser,
      subject_id: session.id,
    });
    expect(JSON.stringify(rows.rows[0]?.details)).not.toContain('Pat');
  });

  it.each([
    ['a missing id', randomUUID()],
    ['text that is no id', 'not-an-id'],
  ])('answers null for %s and records nothing', async (_name, id) => {
    const before = await auditCount('session.viewed');
    expect(await data.readOpsSession(ops, id)).toBeNull();
    expect(await auditCount('session.viewed')).toBe(before);
  });

  it('names a confirmed booking with no succeeded payment, and does not offer the cancel', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    await client.db
      .update(schema.paymentAttempts)
      .set({ status: 'canceled' })
      .where(eq(schema.paymentAttempts.id, booking.attemptId));

    const detail = await data.readOpsSession(ops, session.id);

    expect(detail?.impact.blockedText).toMatch(
      /has no payment to send the money back to/,
    );
    expect(detail?.impact.bookings).toEqual([]);
    expect(detail?.session.canCancel).toBe(false);
  });
});

describe('cancelSessionAsOps', () => {
  it('cancels through cancelSession when the impact is the one read: refunded, cancelled, the ops user named', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    const fingerprint = await fingerprintOf(session.id);

    const outcome = await data.cancelSessionAsOps(ops, {
      sessionId: session.id,
      reason: 'weather',
      fingerprint,
    });

    expect(outcome).toMatchObject({
      kind: 'done',
      result: { status: 'cancelled', ordersRefunded: 1 },
    });
    expect(await sessionOf(session.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'weather',
    });
    const rows = await client.db.execute(
      sql`SELECT actor_id FROM audit_log WHERE action = 'session.cancelled' AND subject_id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ actor_id: opsUser }]);
    expect(await refundsOf(booking)).toHaveLength(1);
  });

  it('refuses a changed impact as stale and writes nothing, then cancels with the fresh one', async () => {
    const session = await newSession();
    await seedConfirmedOn(session.id, 2);
    const shown = await fingerprintOf(session.id);
    const late = await seedConfirmedOn(session.id, 1);
    const before = await auditCount();

    expect(
      await data.cancelSessionAsOps(ops, {
        sessionId: session.id,
        reason: 'ramble',
        fingerprint: shown,
      }),
    ).toEqual({ kind: 'stale' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await orderOf(late.orderId))?.status).toBe('confirmed');
    expect(
      await data.cancelSessionAsOps(ops, {
        sessionId: session.id,
        reason: 'ramble',
        fingerprint: await fingerprintOf(session.id),
      }),
    ).toMatchObject({ kind: 'done', result: { ordersRefunded: 2 } });
  });

  it('refuses a session that has started, whatever the form said, and writes nothing', async () => {
    const session = await newSession({
      startsAt: new Date(Date.now() - day),
      endsAt: new Date(Date.now() - day + 3_600_000),
    });
    const before = await auditCount();

    expect(
      await data.cancelSessionAsOps(ops, {
        sessionId: session.id,
        reason: 'ramble',
        fingerprint: wrong,
      }),
    ).toEqual({ kind: 'ended' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
  });

  it('answers not found for a session that is not there', async () => {
    expect(
      await data.cancelSessionAsOps(ops, {
        sessionId: randomUUID(),
        reason: 'ramble',
        fingerprint: wrong,
      }),
    ).toEqual({ kind: 'done', result: { status: 'not_found' } });
  });

  it.each([
    ['paid in part by a gift', giftPaidBooking],
    [
      'with no succeeded payment',
      async (sessionId: string) => {
        const booking = await seedConfirmedOn(sessionId, 2);
        await client.db
          .update(schema.paymentAttempts)
          .set({ status: 'canceled' })
          .where(eq(schema.paymentAttempts.id, booking.attemptId));
        return booking;
      },
    ],
  ])('refuses a booking %s before writing anything', async (_name, seed) => {
    const session = await newSession();
    const booking = await seed(session.id);
    const before = await auditCount();

    expect(
      await data.cancelSessionAsOps(ops, {
        sessionId: session.id,
        reason: 'ramble',
        fingerprint: wrong,
      }),
    ).toEqual({ kind: 'blocked' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await orderOf(booking.orderId))?.status).toBe('confirmed');
  });

  it('rolls the whole cancellation back when its audit row cannot be written', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    const fingerprint = await fingerprintOf(session.id);
    await breakAudit('session.cancelled');
    const before = await auditCount('order.cancelled');

    await expect(
      data.cancelSessionAsOps(ops, {
        sessionId: session.id,
        reason: 'ramble',
        fingerprint,
      }),
    ).rejects.toThrow();

    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await orderOf(booking.orderId))?.status).toBe('confirmed');
    expect(await refundsOf(booking)).toHaveLength(0);
    expect(await auditCount('order.cancelled')).toBe(before);
  });
});
