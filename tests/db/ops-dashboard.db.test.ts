import { randomUUID } from 'node:crypto';
import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { venueTimeZone } from '@/lib/venue';
import { zonedDayWindow } from '@/lib/zonedDay';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { seedCancellable } from './cancelFixtures';
import { catalogFixtures } from './catalogFixtures';
import { serveNeonHttp } from './harness';
import { client, schema, setupRefundsDatabase } from './refundFixtures';

const raise = vi.hoisted(() => vi.fn());
vi.mock('@/server/monitoring/alerts', () => ({ alerts: { raise } }));
vi.mock('@/server/monitoring/logger', () => ({
  logger: { warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));
setupRefundsDatabase(raise);

// Behaviours under test, against the real database (the numbers on the ops landing):
// - a guest, a host owner, an admin and nobody are refused by every function with ForbiddenError, and nothing is written
// - the review count counts experiences in review and no other status
// - the refund-failed count counts bookings flagged as refund failed and no others
// - the support count counts requests with no resolution, and drops one once it is resolved
// - the private requests count counts every request received
// - the sessions-today count counts scheduled sessions from the first instant of today in New York up to the first instant of tomorrow, and not a cancelled one, one a millisecond before, or one at the end
// - the recent audit read returns the newest rows first, at most as many as asked for, and each read writes no audit row

type Data = typeof import('@/server/db/opsDashboard');
type Requests = typeof import('@/server/db/privateRequests');
let data: Data;
let requests: Requests;

const ops: Caller = testCaller({ userId: randomUUID(), roles: [Role.Ops] });

const refused: [string, Caller][] = [
  ['a guest', testCaller({ userId: randomUUID() })],
  [
    'a host owner',
    testCaller({
      userId: randomUUID(),
      roles: [Role.HostOwner],
      hostIds: [randomUUID()],
    }),
  ],
  ['an admin', testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', { userId: null, roles: [], hostIds: [] }],
];

let stopHttp: () => Promise<void>;

// The counts read through the HTTP driver, which the shim serves from the file's own database.
beforeAll(async () => {
  stopHttp = await serveNeonHttp(process.env.DATABASE_URL ?? '');
  data = await import('@/server/db/opsDashboard');
  requests = await import('@/server/db/privateRequests');
});

afterAll(async () => {
  await stopHttp();
});

const auditCount = async () =>
  Number(
    (await client.db.execute(sql`SELECT count(*) AS n FROM audit_log`)).rows[0]
      ?.n,
  );

describe('access', () => {
  it.each(refused)(
    '%s is refused by every function and nothing is written',
    async (_who, caller) => {
      const before = await auditCount();
      for (const read of [
        data.countExperiencesInReview,
        data.countRefundFailedBookings,
        data.countOpenSupportRequests,
        data.countSessionsToday,
        requests.countOpsPrivateRequests,
        (c: Caller) => data.readRecentAuditForOps(c, 5),
      ]) {
        await expect(read(caller)).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await auditCount()).toBe(before);
    },
  );
});

describe('the counts', () => {
  it('counts experiences in review and no other status', async () => {
    const world = await seedCancellable();
    const [session] = await client.db
      .select({ experienceId: schema.sessions.experienceId })
      .from(schema.sessions)
      .where(eq(schema.sessions.id, world.sessionId));
    if (!session) throw new Error('expected a session');
    const before = await data.countExperiencesInReview(ops);

    await client.db
      .update(schema.experiences)
      .set({ status: 'in_review' })
      .where(eq(schema.experiences.id, session.experienceId));
    expect(await data.countExperiencesInReview(ops)).toBe(before + 1);

    await client.db
      .update(schema.experiences)
      .set({ status: 'live' })
      .where(eq(schema.experiences.id, session.experienceId));
    expect(await data.countExperiencesInReview(ops)).toBe(before);
  });

  it('counts bookings whose refund failed and no others', async () => {
    const flagged = await seedCancellable();
    await seedCancellable();
    const before = await data.countRefundFailedBookings(ops);

    await client.db
      .update(schema.orders)
      .set({ refundFailed: true })
      .where(eq(schema.orders.id, flagged.orderId));
    expect(await data.countRefundFailedBookings(ops)).toBe(before + 1);
  });

  it('counts support requests with no resolution, and drops one once resolved', async () => {
    const before = await data.countOpenSupportRequests(ops);
    const [row] = await client.db
      .insert(schema.supportRequests)
      .values({
        name: 'Guest One',
        email: 'guest1@example.com',
        topic: 'booking',
        message: 'Where do we meet?',
      })
      .returning({ id: schema.supportRequests.id });
    if (!row) throw new Error('expected a request');
    expect(await data.countOpenSupportRequests(ops)).toBe(before + 1);

    await client.db
      .update(schema.supportRequests)
      .set({ resolvedAt: new Date(), resolutionNote: 'Told them.' })
      .where(eq(schema.supportRequests.id, row.id));
    expect(await data.countOpenSupportRequests(ops)).toBe(before);
  });

  it('counts every private request received', async () => {
    const fixtures = catalogFixtures(() => client.db);
    const experience = await fixtures.insertExperience(
      await fixtures.parents(),
      { status: 'live' },
    );
    const before = await requests.countOpsPrivateRequests(ops);
    await client.db.insert(schema.privateRequests).values(
      [1, 2].map((n) => ({
        experienceId: experience.id,
        requestedDate: '2099-01-15',
        groupSize: 12,
        budgetMinor: 120_000,
        name: `Guest ${String(n)}`,
        email: `guest${String(n)}@example.com`,
        message: 'A birthday.',
      })),
    );
    expect(await requests.countOpsPrivateRequests(ops)).toBe(before + 2);
  });

  it('counts the scheduled sessions that start today in New York, edges included and excluded', async () => {
    const fixtures = catalogFixtures(() => client.db);
    const experience = await fixtures.insertExperience(
      await fixtures.parents(),
      { status: 'live' },
    );
    const today = zonedDayWindow(new Date(), venueTimeZone);
    const first = today.from.getTime();
    const next = today.to.getTime();
    const before = await data.countSessionsToday(ops);

    // In: the first instant of the day, and the last millisecond of it.
    await fixtures.insertSession(experience.id, new Date(first));
    await fixtures.insertSession(experience.id, new Date(next - 1));
    // Out: the millisecond before the day, the first instant of tomorrow, and a cancelled session in the day.
    await fixtures.insertSession(experience.id, new Date(first - 1));
    await fixtures.insertSession(experience.id, new Date(next));
    await fixtures.insertSession(experience.id, new Date(first + 3_600_000), {
      status: 'cancelled',
      cancelReason: 'host',
    });
    expect(await data.countSessionsToday(ops)).toBe(before + 2);
  });
});

describe('the recent audit rows', () => {
  it('returns the newest rows first, no more than the limit, and writes nothing', async () => {
    const { recordOpsAccess } = await import('@/server/db/audit');
    for (let visit = 0; visit < 4; visit += 1) await recordOpsAccess(ops);
    const total = await auditCount();
    const newest = await client.db.execute(
      sql`SELECT id FROM audit_log ORDER BY id DESC LIMIT 3`,
    );

    const rows = await data.readRecentAuditForOps(ops, 3);
    expect(rows.map((row) => row.id)).toEqual(
      newest.rows.map((row) => String(row.id)),
    );
    expect(rows).toHaveLength(3);
    expect(await auditCount()).toBe(total);
  });
});
