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
import { PauseIncompleteError } from '@/lib/opsSessions';
import { ForbiddenError, Role, type Caller } from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  newSession,
  seedActiveHoldOn,
  seedConfirmedOn,
  sessionOf,
} from './cancelSessionFixtures';
import { insertGift } from './giftFixtures';
import { serveNeonHttp } from './harness';
import {
  client,
  clearJobs,
  getParents,
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
// - both functions refuse a guest, an admin, nobody, and the host owner of the session's own host, and write nothing
// - a capacity change is saved with one audit row (before and after, the ops user named); below sold plus held, a stale version, and a started session are refused and write nothing
// - a capacity change whose audit row cannot be written is rolled back whole
// - the audit row on a capacity change is written for a host owner's change too
// - pausing pauses the experience through the shared pause (its audit row, one transaction) and cancels each future session with guests, leaving empty and past sessions alone
// - the pause counts only the sessions it actually cancelled
// - an impact that changed since it was read, or a booking that cannot be refunded in full, refuses the pause before anything is written
// - an experience that is not pausable is not paused
// - a pause that fails part-way (one session's cancellation throws) leaves the experience paused and the rest cancelled, reports the progress, and a repeat completes the rest
// - a repeat on a paused experience skips the blocked check, cancels what it can, and reports the blocked session as left, never stranding the others

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });
const day = 86_400_000;
const wrong = '9:9:9:9:9';

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
  ['an admin', () => testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', () => ({ userId: null, roles: [], hostIds: [] })],
];

let stopHttp: () => Promise<void>;
let data: typeof import('@/server/db/opsSessions');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  stopHttp = await serveNeonHttp(process.env.DATABASE_URL ?? '');
  data = await import('@/server/db/opsSessions');
  sessionData = await import('@/server/db/sessions');
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
  await setExperienceStatus('live');
});

const setExperienceStatus = (status: string) =>
  client.db.execute(
    sql`UPDATE experiences SET status = ${status} WHERE id = ${getParents().experienceId}`,
  );

const experienceStatus = async () =>
  (
    await client.db
      .select({ status: schema.experiences.status })
      .from(schema.experiences)
      .where(eq(schema.experiences.id, getParents().experienceId))
  )[0]?.status;

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

/** Makes the audit log refuse a row of this action (of one subject, when given), as a database outage would. */
async function breakAudit(action: string, subjectId?: string) {
  await client.db.execute(sql`
    CREATE OR REPLACE FUNCTION fail_audit() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'audit is down'; END $$`);
  const only =
    subjectId === undefined ? '' : ` AND NEW.subject_id = '${subjectId}'`;
  await client.db.execute(
    sql.raw(
      `CREATE TRIGGER fail_audit BEFORE INSERT ON audit_log FOR EACH ROW WHEN (NEW.action = '${action}'${only}) EXECUTE FUNCTION fail_audit()`,
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

/** The fingerprint of the pause impact the page would show for the experience of this session. */
async function pauseFingerprint(sessionId: string) {
  const detail = await data.readOpsSession(ops, sessionId);
  if (!detail?.pause) throw new Error('nothing to pause');
  return detail.pause.impact.fingerprint;
}

describe('access', () => {
  it.each(refused)(
    'refuses %s both functions and writes nothing',
    async (_name, caller) => {
      const session = await newSession();
      const before = await auditCount();
      const who = caller();
      const attempts = [
        () =>
          data.changeAllocationAsOps(who, {
            sessionId: session.id,
            allocation: 5,
            expectedVersion: 1,
          }),
        () =>
          data.pauseExperienceAndCancel(who, {
            sessionId: session.id,
            fingerprint: wrong,
          }),
      ];
      for (const attempt of attempts) {
        await expect(attempt()).rejects.toBeInstanceOf(ForbiddenError);
      }
      expect(await auditCount()).toBe(before);
      expect((await sessionOf(session.id)).allocation).toBe(20);
      expect(await experienceStatus()).toBe('live');
    },
  );
});

describe('changeAllocationAsOps', () => {
  it('saves the capacity with one audit row holding before and after', async () => {
    const session = await newSession({ allocation: 10 });
    const before = await auditCount('session.allocation_changed');

    const result = await data.changeAllocationAsOps(ops, {
      sessionId: session.id,
      allocation: 14,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true });
    expect((await sessionOf(session.id)).allocation).toBe(14);
    expect(await auditCount('session.allocation_changed')).toBe(before + 1);
    const rows = await client.db.execute(
      sql`SELECT actor_id, details FROM audit_log WHERE action = 'session.allocation_changed' AND subject_id = ${session.id}`,
    );
    expect(rows.rows[0]).toMatchObject({
      actor_id: opsUser,
      details: { from: 10, to: 14 },
    });
  });

  it('never goes below the seats sold plus held, and writes nothing when refused', async () => {
    const session = await newSession({ allocation: 10 });
    await seedConfirmedOn(session.id, 3);
    await seedActiveHoldOn(session.id, 2);
    const before = await auditCount();
    const version = (await sessionOf(session.id)).version;

    expect(
      await data.changeAllocationAsOps(ops, {
        sessionId: session.id,
        allocation: 4,
        expectedVersion: version,
      }),
    ).toMatchObject({ ok: false, reason: 'below_sold_and_held' });
    expect(await auditCount()).toBe(before);
    expect(
      await data.changeAllocationAsOps(ops, {
        sessionId: session.id,
        allocation: 5,
        expectedVersion: version,
      }),
    ).toMatchObject({ ok: true });
    expect(await auditCount()).toBe(before + 1);
  });

  it.each([
    [
      'a stale version',
      { allocation: 12, expectedVersion: 99 },
      'version_conflict',
      {},
    ],
    [
      'a started session',
      { allocation: 12, expectedVersion: 1 },
      'in_the_past',
      { startsAt: new Date(Date.now() - day) },
    ],
  ] as const)(
    'refuses %s and writes nothing',
    async (_name, input, reason, over) => {
      const session = await newSession(over);
      const before = await auditCount();
      expect(
        await data.changeAllocationAsOps(ops, {
          sessionId: session.id,
          ...input,
        }),
      ).toMatchObject({ ok: false, reason });
      expect(await auditCount()).toBe(before);
      expect((await sessionOf(session.id)).allocation).toBe(20);
    },
  );

  it('rolls the capacity back when the audit row cannot be written', async () => {
    const session = await newSession({ allocation: 10 });
    await breakAudit('session.allocation_changed');

    await expect(
      data.changeAllocationAsOps(ops, {
        sessionId: session.id,
        allocation: 14,
        expectedVersion: 1,
      }),
    ).rejects.toThrow();

    expect(await sessionOf(session.id)).toMatchObject({
      allocation: 10,
      version: 1,
    });
  });

  it('records a host owner’s own capacity change too', async () => {
    const session = await newSession({ allocation: 10 });
    const owner = testCaller({
      userId: randomUUID(),
      roles: [Role.HostOwner],
      hostIds: [getParents().hostId],
    });

    const result = await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 11,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true });
    const rows = await client.db.execute(
      sql`SELECT actor_id FROM audit_log WHERE action = 'session.allocation_changed' AND subject_id = ${session.id}`,
    );
    expect(rows.rows).toEqual([{ actor_id: owner.userId }]);
  });
});

describe('pauseExperienceAndCancel', () => {
  it('pauses the experience, audits it, and cancels each future session with guests, counting only what it cancelled', async () => {
    const booked = await newSession();
    const held = await newSession();
    const empty = await newSession();
    const past = await newSession({
      startsAt: new Date(Date.now() - day),
      status: 'completed',
    });
    await seedConfirmedOn(booked.id, 2);
    await seedActiveHoldOn(held.id, 1);
    const fingerprint = await pauseFingerprint(empty.id);

    const outcome = await data.pauseExperienceAndCancel(ops, {
      sessionId: empty.id,
      fingerprint,
    });

    expect(outcome).toEqual({
      status: 'paused',
      cancelled: 2,
      total: 2,
      left: 0,
    });
    expect(await experienceStatus()).toBe('paused');
    expect(await sessionOf(booked.id)).toMatchObject({
      status: 'cancelled',
      cancelReason: 'ramble',
    });
    expect((await sessionOf(held.id)).status).toBe('cancelled');
    expect((await sessionOf(empty.id)).status).toBe('scheduled');
    expect((await sessionOf(past.id)).status).toBe('completed');
    const paused = await client.db.execute(
      sql`SELECT actor_id FROM audit_log WHERE action = 'experience.paused' AND subject_id = ${getParents().experienceId}`,
    );
    expect(paused.rows).toEqual([{ actor_id: opsUser }]);
  });

  it('refuses an impact that changed since it was read, and writes nothing', async () => {
    const booked = await newSession();
    await seedConfirmedOn(booked.id, 2);
    const shown = await pauseFingerprint(booked.id);
    await seedConfirmedOn((await newSession()).id, 1);
    const before = await auditCount();

    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: booked.id,
        fingerprint: shown,
      }),
    ).toEqual({ status: 'stale' });

    expect(await auditCount()).toBe(before);
    expect(await experienceStatus()).toBe('live');
    expect((await sessionOf(booked.id)).status).toBe('scheduled');
  });

  it('is refused, before the pause, while a booking cannot be refunded in full', async () => {
    const booked = await newSession();
    await giftPaidBooking(booked.id);
    const before = await auditCount();

    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: booked.id,
        fingerprint: wrong,
      }),
    ).toEqual({ status: 'blocked' });

    expect(await experienceStatus()).toBe('live');
    expect(await auditCount()).toBe(before);
  });

  it('does not pause an experience that is not pausable, and says so for a missing session', async () => {
    const session = await newSession();
    await setExperienceStatus('draft');
    const before = await auditCount();
    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: session.id,
        fingerprint: wrong,
      }),
    ).toEqual({ status: 'not_pausable' });
    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: randomUUID(),
        fingerprint: wrong,
      }),
    ).toEqual({ status: 'not_found' });
    expect(await auditCount()).toBe(before);
  });

  it('refuses a session id that is no id', async () => {
    await expect(
      data.pauseExperienceAndCancel(ops, {
        sessionId: 'not-an-id',
        fingerprint: wrong,
      }),
    ).rejects.toThrow();
  });

  it('stops part-way when one session cannot be cancelled, keeps the experience paused and the rest cancelled, and a repeat completes it', async () => {
    const first = await newSession({
      startsAt: new Date(Date.now() + 2 * day),
    });
    const stuck = await newSession({
      startsAt: new Date(Date.now() + 3 * day),
    });
    const last = await newSession({ startsAt: new Date(Date.now() + 4 * day) });
    for (const session of [first, stuck, last]) {
      await seedConfirmedOn(session.id, 1);
    }
    const fingerprint = await pauseFingerprint(first.id);
    await breakAudit('session.cancelled', stuck.id);

    const failure = await data
      .pauseExperienceAndCancel(ops, {
        sessionId: first.id,
        fingerprint,
      })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(PauseIncompleteError);
    expect(failure).toMatchObject({ cancelled: 1, total: 3 });
    expect(await experienceStatus()).toBe('paused');
    expect((await sessionOf(first.id)).status).toBe('cancelled');
    expect((await sessionOf(stuck.id)).status).toBe('scheduled');
    expect((await sessionOf(last.id)).status).toBe('scheduled');

    await client.db.execute(sql`DROP TRIGGER fail_audit ON audit_log`);
    const detail = await data.readOpsSession(ops, first.id);
    expect(detail?.pause).toMatchObject({
      buttonLabel: 'Cancel the remaining sessions',
      canPause: true,
    });
    const pausedRows = await auditCount('experience.paused');

    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: first.id,
        fingerprint: wrong,
      }),
    ).toEqual({ status: 'paused', cancelled: 2, total: 2, left: 0 });

    expect((await sessionOf(stuck.id)).status).toBe('cancelled');
    expect((await sessionOf(last.id)).status).toBe('cancelled');
    expect(await auditCount('experience.paused')).toBe(pausedRows);
  });

  it('on a paused experience skips the blocked check, cancels what it can, and reports the blocked session as left', async () => {
    const fine = await newSession({ startsAt: new Date(Date.now() + 2 * day) });
    const gifted = await newSession({
      startsAt: new Date(Date.now() + 3 * day),
    });
    await seedConfirmedOn(fine.id, 1);
    await giftPaidBooking(gifted.id);
    await setExperienceStatus('paused');

    expect(
      await data.pauseExperienceAndCancel(ops, {
        sessionId: fine.id,
        fingerprint: wrong,
      }),
    ).toEqual({ status: 'paused', cancelled: 1, total: 2, left: 1 });

    expect((await sessionOf(fine.id)).status).toBe('cancelled');
    expect((await sessionOf(gifted.id)).status).toBe('scheduled');
    const detail = await data.readOpsSession(ops, gifted.id);
    expect(detail?.pause?.impact.blockedText).toMatch(/paid in part by a gift/);
  });
});
