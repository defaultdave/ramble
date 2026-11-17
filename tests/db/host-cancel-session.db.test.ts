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
  jobsOfKind,
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

// Behaviours under test, against the real database (`readHostSessionCancel`, `cancelSessionAsHost`):
// - only the owner of the session's host reads or cancels: a guest, host staff of that host, ops, an admin, nobody, and
//   another host's owner are refused with a ForbiddenError, and nothing is written
// - the read shows the session with its bookings and the refund each would get, the unpaid orders and holds, and no audit row
// - a session of another host, or none, reads as nothing and cancels nothing, so the two look alike
// - cancelling goes through cancelSession as the host's own cancellation: booking refunded in full, session cancelled
//   with the host reason, the guest queued an email, and the owner named in the audit rows
// - an impact that changed since it was read is refused as stale and writes nothing
// - a session that has started, and a booking that cannot be refunded in full, are refused before anything is written
// - a repeat submit, one after the other or at the same moment, cancels once and refunds once: it answers already_cancelled and writes nothing more

const ownerUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const day = 86_400_000;
const wrong = '9:9:9:9:9:9';

const ownerOf = (hostId: string): Caller =>
  testCaller({
    userId: ownerUser,
    roles: [Role.HostOwner],
    hostIds: [hostId],
  });

const refused: [string, () => Caller][] = [
  ['a guest', () => testCaller({ userId: randomUUID() })],
  [
    'host staff of the session’s own host',
    () =>
      testCaller({
        userId: randomUUID(),
        roles: [Role.HostStaff],
        hostIds: [getParents().hostId],
      }),
  ],
  ['the owner of another host', () => ownerOf(randomUUID())],
  ['ops', () => testCaller({ userId: randomUUID(), roles: [Role.Ops] })],
  ['an admin', () => testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', () => ({ userId: null, roles: [], hostIds: [] })],
];

let stopHttp: () => Promise<void>;
let data: typeof import('@/server/db/hostCancelSession');

beforeAll(async () => {
  stopHttp = await serveNeonHttp(process.env.DATABASE_URL ?? '');
  data = await import('@/server/db/hostCancelSession');
});
afterAll(async () => {
  await stopHttp();
});
beforeEach(async () => {
  await clearJobs();
  // Sessions of earlier tests share the experience: only the ones a test makes are scheduled.
  await client.db.execute(
    sql`UPDATE sessions SET status = 'completed' WHERE status = 'scheduled'`,
  );
});

const owner = () => ownerOf(getParents().hostId);

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

const orderOf = async (orderId: string) =>
  (
    await client.db
      .select()
      .from(schema.orders)
      .where(eq(schema.orders.id, orderId))
  )[0];

/** The fingerprint the page would carry for the session, as the owner reads it. */
async function fingerprintOf(sessionId: string): Promise<string> {
  const read = await data.readHostSessionCancel(
    owner(),
    getParents().hostId,
    sessionId,
  );
  if (!read) throw new Error('no session');
  const { impactView } = await import('@/lib/opsSessions');
  return impactView(read.impact).fingerprint;
}

const submit = async (sessionId: string, fingerprint?: string) =>
  data.cancelSessionAsHost(owner(), getParents().hostId, {
    sessionId,
    fingerprint: fingerprint ?? (await fingerprintOf(sessionId)),
  });

describe('access', () => {
  it.each(refused)('refuses %s and writes nothing', async (_who, make) => {
    const session = await newSession();
    await seedConfirmedOn(session.id, 2);
    const who = make();
    const { hostId } = getParents();
    const before = await auditCount();

    await expect(
      data.readHostSessionCancel(who, hostId, session.id),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      data.cancelSessionAsHost(who, hostId, {
        sessionId: session.id,
        fingerprint: wrong,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
  });

  it('refuses the owner of another host who names the session’s host', async () => {
    const session = await newSession();
    const other = ownerOf(randomUUID());

    await expect(
      data.cancelSessionAsHost(other, getParents().hostId, {
        sessionId: session.id,
        fingerprint: wrong,
      }),
    ).rejects.toBeInstanceOf(ForbiddenError);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
  });

  it('reads a session of another host as nothing, and cancels nothing', async () => {
    const session = await newSession();
    await seedConfirmedOn(session.id, 2);
    const elsewhere = randomUUID();
    const other = ownerOf(elsewhere);

    expect(
      await data.readHostSessionCancel(other, elsewhere, session.id),
    ).toBeNull();
    expect(
      await data.cancelSessionAsHost(other, elsewhere, {
        sessionId: session.id,
        fingerprint: wrong,
      }),
    ).toEqual({ kind: 'done', result: { status: 'not_found' } });
    expect((await sessionOf(session.id)).status).toBe('scheduled');
  });

  it('reads a session that is not there as nothing', async () => {
    expect(
      await data.readHostSessionCancel(
        owner(),
        getParents().hostId,
        randomUUID(),
      ),
    ).toBeNull();
    expect(
      await data.cancelSessionAsHost(owner(), getParents().hostId, {
        sessionId: randomUUID(),
        fingerprint: wrong,
      }),
    ).toEqual({ kind: 'done', result: { status: 'not_found' } });
  });
});

describe('readHostSessionCancel', () => {
  it('shows the bookings with their refunds, the unpaid orders and the holds, and writes no audit row', async () => {
    const session = await newSession({ allocation: 10 });
    await seedConfirmedOn(session.id, 3);
    await seedUnpaidOn(session.id);
    await seedActiveHoldOn(session.id, 2);
    const before = await auditCount();

    const read = await data.readHostSessionCancel(
      owner(),
      getParents().hostId,
      session.id,
    );

    expect(read?.session).toMatchObject({
      id: session.id,
      status: 'scheduled',
      allocation: 10,
    });
    expect(read?.impact.refunds).toHaveLength(1);
    expect(read?.impact.refunds[0]?.amountMinor).toBeGreaterThan(0);
    expect(read?.impact.unpaidCount).toBe(1);
    expect(read?.impact.openHolds).toBeGreaterThanOrEqual(2);
    expect(read?.impact.blocked).toEqual([]);
    expect(await auditCount()).toBe(before);
  });
});

describe('cancelSessionAsHost', () => {
  it('cancels through cancelSession as the host’s own: refunded, cancelled, told, the owner named', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);

    const outcome = await submit(session.id);

    expect(outcome).toMatchObject({
      kind: 'done',
      result: { status: 'cancelled', ordersRefunded: 1 },
    });
    expect(await sessionOf(session.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'host',
    });
    expect(await orderOf(booking.orderId)).toMatchObject({
      status: 'cancelled',
      cancelledBy: 'host',
    });
    expect(await refundsOf(booking)).toHaveLength(1);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(1);
    const rows = await client.db.execute(
      sql`SELECT actor_id FROM audit_log WHERE action = 'session.cancelled' AND subject_id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ actor_id: ownerUser }]);
  });

  it('refuses a changed impact as stale and writes nothing, then cancels with the fresh one', async () => {
    const session = await newSession();
    await seedConfirmedOn(session.id, 2);
    const shown = await fingerprintOf(session.id);
    const late = await seedConfirmedOn(session.id, 1);
    const before = await auditCount();

    expect(await submit(session.id, shown)).toEqual({ kind: 'stale' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await orderOf(late.orderId))?.status).toBe('confirmed');
    expect(await submit(session.id)).toMatchObject({
      kind: 'done',
      result: { ordersRefunded: 2 },
    });
  });

  it('refuses a session that has started, whatever the form said, and writes nothing', async () => {
    const session = await newSession({
      startsAt: new Date(Date.now() - day),
      endsAt: new Date(Date.now() - day + 3_600_000),
    });
    const before = await auditCount();

    expect(await submit(session.id, wrong)).toEqual({ kind: 'ended' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
  });

  it('refuses a booking paid in part by a gift before writing anything', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    const gift = await insertGift(client.db, getParents());
    await client.db
      .update(schema.orders)
      .set({
        giftId: gift.id,
        giftAppliedMinor: 1000,
        amountDueMinor: sql`${schema.orders.totalMinor} - 1000`,
      })
      .where(eq(schema.orders.id, booking.orderId));
    const before = await auditCount();

    expect(await submit(session.id, wrong)).toEqual({ kind: 'blocked' });

    expect(await auditCount()).toBe(before);
    expect((await sessionOf(session.id)).status).toBe('scheduled');
    expect((await orderOf(booking.orderId))?.status).toBe('confirmed');
  });
});

describe('a repeat submit', () => {
  it('answers already_cancelled, and refunds and writes nothing a second time', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    const fingerprint = await fingerprintOf(session.id);

    expect(await submit(session.id, fingerprint)).toMatchObject({
      result: { status: 'cancelled', ordersRefunded: 1 },
    });
    const audit = await auditCount();

    expect(await submit(session.id, fingerprint)).toMatchObject({
      kind: 'done',
      result: { status: 'already_cancelled', ordersRefunded: 0 },
    });

    expect(await auditCount()).toBe(audit);
    expect(await refundsOf(booking)).toHaveLength(1);
    expect(await jobsOfKind('process-refund')).toHaveLength(1);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(1);
    expect((await sessionOf(session.id)).version).toBe(2);
  });

  it('cancels once and refunds once when two submits arrive together', async () => {
    const session = await newSession();
    const booking = await seedConfirmedOn(session.id, 2);
    const fingerprint = await fingerprintOf(session.id);

    const outcomes = await Promise.all([
      submit(session.id, fingerprint),
      submit(session.id, fingerprint),
    ]);

    const statuses = outcomes.map((outcome) =>
      outcome.kind === 'done' ? outcome.result.status : outcome.kind,
    );
    expect(statuses.sort()).toEqual(['already_cancelled', 'cancelled']);
    expect(await refundsOf(booking)).toHaveLength(1);
    expect(await jobsOfKind('process-refund')).toHaveLength(1);
    expect(await jobsOfKind('guest-cancellation')).toHaveLength(1);
    expect(await auditCount('session.cancelled')).toBeGreaterThanOrEqual(1);
    expect((await sessionOf(session.id)).version).toBe(2);
  });
});
