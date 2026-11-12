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
import { tagsForChanges } from '@/lib/cacheTags';
import type { AddSlotsInput } from '@/lib/sessions';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import { hosts, sessionTemplates, sessions } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { insertHold, minute } from './holdFixtures';
import { earlyNow, ownerOf, sessionsFixtures } from './sessionsFixtures';

const cache = vi.hoisted(() => ({ updateTag: vi.fn() }));
vi.mock('next/cache', () => ({
  updateTag: cache.updateTag,
  revalidateTag: vi.fn(),
}));

// Behaviours under test, against the real database, one per decision, branch or risk:
// Access:
// - every function refuses a guest, a host owner, an admin and nobody with ForbiddenError, and writes nothing
// Adding slots:
// - one slot per ticked day is made, each with its sessions for the 12 weeks ahead from the generator, in the host's zone, copying the slot's seats and source, and one audit row per slot in codes and numbers
// - the daily job run afterwards finds every date already there and creates nothing
// - a day that already has a slot at that time refuses the whole add: no slot, no session, no audit row, no invalidation
// - an unusable host zone and an unknown experience are refused with nothing written
// - an add that opens sessions invalidates the experience's tags after the commit
// Changing seats:
// - the upcoming scheduled sessions that carry the old cap take the new one, with their version raised; a hand-set, cancelled and past session keep what they had
// - a cap under the seats sold on a following session, or under the seats held in an open hold, is refused whole: the slot, every session and the audit log are as they were
// - a cap equal to the seats sold plus held is allowed; a hand-set session over the new cap does not block it
// - the same cap writes nothing, audit row included; an unknown slot is reported
// - each session that moved invalidates its spaces tag; a refusal and a no-op invalidate nothing
// Reading:
// - the slots come in week order with how many upcoming sessions each has and the last date; a cancelled or started session is not counted; an unknown experience reads null

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let sessionData: typeof import('@/server/db/sessions');
let availability: typeof import('@/server/db/availability');

const opsUser = '5b3d7ad4-6f3c-4c2f-9d58-3a0a2f0e8a10';
const ops = testCaller({ userId: opsUser, roles: [Role.Ops] });

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  sessionData = await import('@/server/db/sessions');
  availability = await import('@/server/db/availability');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

beforeEach(() => {
  cache.updateTag.mockClear();
});

const { setup, sessionsOf } = sessionsFixtures(
  () => client,
  () => sessionData,
);

const count = async (table: string, where = sql`true`) =>
  (
    await client.db.execute<{ n: number }>(
      sql`SELECT count(*)::int AS n FROM ${sql.raw(table)} WHERE ${where}`,
    )
  ).rows[0]?.n ?? 0;

async function auditRows(action: string, experienceId: string) {
  const { rows } = await client.db.execute<{
    actor_id: string | null;
    subject_id: string;
    details: Record<string, unknown>;
  }>(
    sql`SELECT actor_id, subject_id, details FROM audit_log WHERE action = ${action} AND details->>'experience_id' = ${experienceId} ORDER BY id`,
  );
  return rows;
}

const slotFields = {
  startTime: '10:00',
  durationMinutes: 120,
  allocation: 8,
  source: 'allocation',
} as const;

function addInput(
  experienceId: string,
  overrides: Partial<AddSlotsInput> = {},
): AddSlotsInput {
  return { experienceId, weekdays: [1, 6], ...slotFields, ...overrides };
}

const templatesOf = (experienceId: string) =>
  client.db
    .select()
    .from(sessionTemplates)
    .where(eq(sessionTemplates.experienceId, experienceId))
    .orderBy(sessionTemplates.weekday);

/** An experience with one Saturday slot, opened for 12 weeks. */
async function withSaturdaySlot(allocation = 8) {
  const context = await setup();
  const added = await availability.addWeeklySlots(
    ops,
    addInput(context.experience.id, { weekdays: [6], allocation }),
    earlyNow,
  );
  expect(added.status).toBe('added');
  const [template] = await templatesOf(context.experience.id);
  if (!template) throw new Error('expected a template');
  const upcoming = await sessionsOf(template.id);
  return { ...context, template, upcoming };
}

const setSeats = (sessionId: string, seats: number) =>
  client.db
    .update(sessions)
    .set({ seatsSold: seats })
    .where(eq(sessions.id, sessionId));

const refused: [string, Caller][] = [
  ['a guest', testCaller({ userId: randomUUID() })],
  ['a host owner', ownerOf(randomUUID())],
  ['an admin', testCaller({ userId: randomUUID(), roles: [Role.Admin] })],
  ['nobody', anonymousCaller],
];

describe('access', () => {
  it.each(refused)('refuses %s and writes nothing', async (_who, caller) => {
    const { experience, template, upcoming } = await withSaturdaySlot();
    const before = {
      templates: await count('session_templates'),
      sessions: await count('sessions'),
      audit: await count('audit_log'),
    };

    await expect(
      availability.addWeeklySlots(
        caller,
        addInput(experience.id, { weekdays: [2] }),
        earlyNow,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      availability.updateSlotSeats(
        caller,
        { templateId: template.id, allocation: 3 },
        earlyNow,
      ),
    ).rejects.toBeInstanceOf(ForbiddenError);
    await expect(
      availability.readAvailability(caller, experience.id, earlyNow),
    ).rejects.toBeInstanceOf(ForbiddenError);

    expect({
      templates: await count('session_templates'),
      sessions: await count('sessions'),
      audit: await count('audit_log'),
    }).toEqual(before);
    expect((await sessionsOf(template.id)).map((s) => s.allocation)).toEqual(
      upcoming.map((s) => s.allocation),
    );
  });
});

describe('addWeeklySlots', () => {
  it('makes a slot per day with its sessions for the weeks ahead and an audit row each', async () => {
    const { experience } = await setup('America/Los_Angeles');

    const result = await availability.addWeeklySlots(
      ops,
      addInput(experience.id),
      earlyNow,
    );

    const templates = await templatesOf(experience.id);
    expect(templates.map((t) => [t.weekday, t.startTime])).toEqual([
      [1, '10:00:00'],
      [6, '10:00:00'],
    ]);
    const made = [
      ...(await sessionsOf(templates[0]?.id ?? '')),
      ...(await sessionsOf(templates[1]?.id ?? '')),
    ];
    expect(made.length).toBeGreaterThanOrEqual(24);
    expect(result).toEqual({
      status: 'added',
      slots: 2,
      sessionsCreated: made.length,
    });
    expect(made.every((s) => s.timeZone === 'America/Los_Angeles')).toBe(true);
    expect(
      made.every((s) => s.allocation === 8 && s.source === 'allocation'),
    ).toBe(true);
    expect(
      made.every(
        (s) =>
          new Intl.DateTimeFormat('en-GB', {
            timeZone: 'America/Los_Angeles',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23',
          }).format(s.startsAt) === '10:00',
      ),
    ).toBe(true);
    const audit = await auditRows('session_template.created', experience.id);
    expect(audit.map((row) => row.subject_id).sort()).toEqual(
      templates.map((t) => t.id).sort(),
    );
    expect(audit[0]).toMatchObject({
      actor_id: opsUser,
      details: {
        experience_id: experience.id,
        allocation: 8,
        source: 'allocation',
        duration_minutes: 120,
      },
    });
  });

  it('leaves nothing for the daily job to add', async () => {
    const { experience } = await setup();
    await availability.addWeeklySlots(ops, addInput(experience.id), earlyNow);
    const before = await count('sessions');

    const run = await sessionData.extendSessionHorizon(earlyNow);

    expect(run.created).toBe(0);
    expect(await count('sessions')).toBe(before);
  });

  it('refuses the whole add when one day already has a slot at that time', async () => {
    const { experience } = await setup();
    await availability.addWeeklySlots(
      ops,
      addInput(experience.id, { weekdays: [6] }),
      earlyNow,
    );
    const before = {
      templates: await count('session_templates'),
      sessions: await count('sessions'),
      audit: await count('audit_log'),
    };
    cache.updateTag.mockClear();

    const result = await availability.addWeeklySlots(
      ops,
      addInput(experience.id, { weekdays: [1, 6] }),
      earlyNow,
    );

    expect(result).toEqual({ status: 'duplicate_slot' });
    expect({
      templates: await count('session_templates'),
      sessions: await count('sessions'),
      audit: await count('audit_log'),
    }).toEqual(before);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('refuses a host whose zone cannot be used, writing nothing', async () => {
    const { experience, host } = await setup();
    await client.db
      .update(hosts)
      .set({ timeZone: 'Mars/Phobos' })
      .where(eq(hosts.id, host.id));

    const result = await availability.addWeeklySlots(
      ops,
      addInput(experience.id),
      earlyNow,
    );

    expect(result).toEqual({ status: 'invalid_time_zone' });
    expect(await templatesOf(experience.id)).toEqual([]);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('reports an experience that is not there', async () => {
    const result = await availability.addWeeklySlots(
      ops,
      addInput(randomUUID()),
      earlyNow,
    );

    expect(result).toEqual({ status: 'experience_not_found' });
  });

  it('invalidates the experience’s tags once the sessions are made', async () => {
    const { experience } = await setup();

    await availability.addWeeklySlots(ops, addInput(experience.id), earlyNow);

    const updated = cache.updateTag.mock.calls.map(([tag]) => tag as string);
    expect(updated).toEqual(
      expect.arrayContaining(
        tagsForChanges([{ kind: 'experience', experienceId: experience.id }]),
      ),
    );
  });
});

describe('updateSlotSeats', () => {
  it('gives the upcoming sessions that carry the old cap the new one, and leaves the rest', async () => {
    const { template, upcoming } = await withSaturdaySlot(8);
    const [past, handSet, cancelled, ...following] = upcoming;
    if (!past || !handSet || !cancelled) throw new Error('expected sessions');
    // The first week is over by `now`; the next was set by hand; the third was cancelled.
    const now = new Date(past.startsAt.getTime() + 60 * minute);
    await client.db
      .update(sessions)
      .set({ allocation: 5 })
      .where(eq(sessions.id, handSet.id));
    await client.db
      .update(sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(eq(sessions.id, cancelled.id));
    cache.updateTag.mockClear();

    const result = await availability.updateSlotSeats(
      ops,
      { templateId: template.id, allocation: 12 },
      now,
    );

    expect(result).toEqual({
      status: 'saved',
      sessionsUpdated: following.length,
    });
    const after = new Map(
      (await sessionsOf(template.id)).map((s) => [s.id, s]),
    );
    for (const session of following) {
      expect(after.get(session.id)).toMatchObject({
        allocation: 12,
        version: session.version + 1,
      });
    }
    for (const kept of [
      [past, 8],
      [handSet, 5],
      [cancelled, 8],
    ] as const) {
      expect(after.get(kept[0].id)).toMatchObject({
        allocation: kept[1],
        version: kept[0].version,
      });
    }
    const [row] = await templatesOf(template.experienceId);
    expect(row?.allocation).toBe(12);
    const audit = await auditRows(
      'session_template.seats_changed',
      template.experienceId,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]).toMatchObject({
      actor_id: opsUser,
      subject_id: template.id,
      details: {
        from_allocation: 8,
        to_allocation: 12,
        sessions_updated: following.length,
      },
    });
    const invalidated = cache.updateTag.mock.calls.map(
      ([tag]) => tag as string,
    );
    expect(invalidated).toEqual(
      expect.arrayContaining(
        tagsForChanges(
          following.map((s) => ({ kind: 'spaces', sessionId: s.id })),
        ),
      ),
    );
  });

  it.each([
    ['a seat sold', 5, 0, 4],
    ['a hold', 0, 3, 2],
    ['a seat sold and a hold', 2, 2, 3],
  ])(
    'refuses a cap under %s, whole, and changes nothing',
    async (_label, sold, held, cap) => {
      const { template, upcoming } = await withSaturdaySlot(8);
      const [first, second] = upcoming;
      if (!first || !second) throw new Error('expected sessions');
      if (sold > 0) await setSeats(second.id, sold);
      if (held > 0) {
        await insertHold(client.db, second.id, { seats: held });
      }
      const before = await sessionsOf(template.id);
      const auditBefore = await count('audit_log');
      cache.updateTag.mockClear();

      const result = await availability.updateSlotSeats(
        ops,
        { templateId: template.id, allocation: cap },
        earlyNow,
      );

      expect(result).toEqual({
        status: 'below_sold_and_held',
        booked: sold + held,
      });
      expect(await sessionsOf(template.id)).toEqual(before);
      expect((await templatesOf(template.experienceId))[0]?.allocation).toBe(8);
      expect(await count('audit_log')).toBe(auditBefore);
      expect(cache.updateTag).not.toHaveBeenCalled();
    },
  );

  it('allows a cap equal to the seats sold plus held', async () => {
    const { template, upcoming } = await withSaturdaySlot(8);
    const target = upcoming[1];
    if (!target) throw new Error('expected a session');
    await setSeats(target.id, 2);
    await insertHold(client.db, target.id, { seats: 2 });

    const result = await availability.updateSlotSeats(
      ops,
      { templateId: template.id, allocation: 4 },
      earlyNow,
    );

    expect(result.status).toBe('saved');
    expect(
      (await sessionsOf(template.id)).every((s) => s.allocation === 4),
    ).toBe(true);
  });

  it('is not blocked by a hand-set session that is over the new cap', async () => {
    const { template, upcoming } = await withSaturdaySlot(8);
    const target = upcoming[1];
    if (!target) throw new Error('expected a session');
    await client.db
      .update(sessions)
      .set({ allocation: 10, seatsSold: 9 })
      .where(eq(sessions.id, target.id));

    const result = await availability.updateSlotSeats(
      ops,
      { templateId: template.id, allocation: 4 },
      earlyNow,
    );

    expect(result.status).toBe('saved');
    const [after] = (await sessionsOf(template.id)).filter(
      (s) => s.id === target.id,
    );
    expect(after).toMatchObject({ allocation: 10, seatsSold: 9 });
  });

  it('writes nothing for the same cap, audit row included', async () => {
    const { template } = await withSaturdaySlot(8);
    const auditBefore = await count('audit_log');
    cache.updateTag.mockClear();

    const result = await availability.updateSlotSeats(
      ops,
      { templateId: template.id, allocation: 8 },
      earlyNow,
    );

    expect(result).toEqual({ status: 'unchanged' });
    expect(await count('audit_log')).toBe(auditBefore);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('reports a slot that is not there', async () => {
    const result = await availability.updateSlotSeats(
      ops,
      { templateId: randomUUID(), allocation: 3 },
      earlyNow,
    );

    expect(result).toEqual({ status: 'template_not_found' });
  });

  it('gives sessions the daily job makes later the new cap', async () => {
    const { template } = await withSaturdaySlot(8);
    await availability.updateSlotSeats(
      ops,
      { templateId: template.id, allocation: 3 },
      earlyNow,
    );
    const before = (await sessionsOf(template.id)).length;
    const later = new Date(earlyNow.getTime() + 28 * 24 * 60 * minute);

    await sessionData.extendSessionHorizon(later);

    const made = await sessionsOf(template.id);
    expect(made.length).toBeGreaterThan(before);
    expect(made.every((s) => s.allocation === 3)).toBe(true);
  });
});

describe('readAvailability', () => {
  it('lists the slots in week order with their upcoming sessions', async () => {
    const { experience } = await setup();
    await availability.addWeeklySlots(
      ops,
      addInput(experience.id, { weekdays: [0, 6], startTime: '15:00' }),
      earlyNow,
    );
    await availability.addWeeklySlots(
      ops,
      addInput(experience.id, { weekdays: [6], startTime: '09:00' }),
      earlyNow,
    );
    const [sunday] = await templatesOf(experience.id);
    const [first, second] = await sessionsOf(sunday?.id ?? '');
    if (!first || !second) throw new Error('expected sessions');
    await client.db
      .update(sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(eq(sessions.id, second.id));
    const now = new Date(first.startsAt.getTime() + 60 * minute);

    const data = await availability.readAvailability(ops, experience.id, now);

    expect(data?.experienceId).toBe(experience.id);
    expect(data?.slots.map((s) => [s.weekday, s.startTime])).toEqual([
      [0, '15:00:00'],
      [6, '09:00:00'],
      [6, '15:00:00'],
    ]);
    const sundayRow = data?.slots[0];
    const total = (await sessionsOf(sunday?.id ?? '')).length;
    // The first has started and the second is cancelled.
    expect(sundayRow?.upcoming).toBe(total - 2);
    expect(sundayRow?.lastDate).toBe(
      (await sessionsOf(sunday?.id ?? '')).at(-1)?.localDate,
    );
  });

  it('reads an experience with no slots as empty, and an unknown one as null', async () => {
    const { experience } = await setup();

    expect(
      (await availability.readAvailability(ops, experience.id, earlyNow))
        ?.slots,
    ).toEqual([]);
    expect(
      await availability.readAvailability(ops, randomUUID(), earlyNow),
    ).toBeNull();
  });
});
