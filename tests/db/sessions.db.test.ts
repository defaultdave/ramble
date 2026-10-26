import { count, eq, sql, type SQL } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { maxAllocation, type SessionTemplateInput } from '@/lib/sessions';
import {
  anonymousCaller,
  ForbiddenError,
  Role,
  type Caller,
} from '@/server/auth/caller';
import { testCaller } from '@/server/auth/test-caller';
import {
  categories,
  cancellationTiers,
  experiences,
  hosts,
  neighborhoods,
  sessions,
  sessionTemplates,
} from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';

// Behaviours under test, one per decision, branch or risk:
// - every CHECK, foreign key and unique index on the two tables refuses its bad row; the
//   seats_sold CHECK refuses an insert and a later capacity drop alike
// - a template is created by the experience's host owner (Ramble source) or by ops and admin
//   (either source); an allocation template is refused for a host owner; another host's owner,
//   a guest and an anonymous caller are refused; a refusal writes nothing
// - a repeat slot is reported and leaves the first template as it was; an unknown experience is reported
// - generation lists the weekday's dates in the host's zone with the template's allocation and
//   source, holds the wall time across a clock change, and records the zone it used
// - generation is idempotent: a rerun, an overlapping range, two runs at once, and a changed host
//   zone create no duplicate; an edited or cancelled session is not rebuilt
// - generation skips dates that start at or before now, and reports a bad host zone, a missing
//   template, and a refused caller without writing; an over-long range throws
// - a capacity edit raises, lowers to exactly the seats sold, and refuses below it; a stale version
//   is refused; two edits on one version let one win; the seats sold are read under the row lock
// - an allocation session's capacity is ops only; the same refusals apply to the edit

let fresh: FreshDatabase;
let stopHttp: () => Promise<void>;
let client: typeof import('@/server/db/client');
let sessionData: typeof import('@/server/db/sessions');

beforeAll(async () => {
  fresh = await createFreshDatabase(process.env.DATABASE_URL_UNPOOLED ?? '');
  stopHttp = await serveNeonHttp(fresh.url);
  vi.stubEnv('DATABASE_URL', fresh.url);
  client = await import('@/server/db/client');
  sessionData = await import('@/server/db/sessions');
});

afterAll(async () => {
  await client.db.$client.end();
  await stopHttp();
  await fresh.dispose();
  vi.unstubAllEnvs();
});

let counter = 0;
function unique(prefix: string) {
  counter += 1;
  return `${prefix}-${String(counter)}`;
}

const ops = testCaller({ roles: [Role.Ops] });
const admin = testCaller({ roles: [Role.Admin] });
const guest = testCaller();

function ownerOf(hostId: string): Caller {
  return testCaller({ roles: [Role.HostOwner], hostIds: [hostId] });
}

const earlyNow = new Date('2026-01-01T00:00:00Z');

async function insertHost(timeZone = 'America/New_York') {
  const [row] = await client.db
    .insert(hosts)
    .values({ slug: unique('host'), name: unique('Host'), timeZone })
    .returning();
  if (!row) throw new Error('insert returned no host');
  return row;
}

async function insertExperience(hostId: string) {
  const [category] = await client.db
    .insert(categories)
    .values({ slug: unique('category'), name: unique('Category') })
    .returning();
  const [neighborhood] = await client.db
    .insert(neighborhoods)
    .values({ slug: unique('neighborhood'), name: unique('Neighborhood') })
    .returning();
  const [tier] = await client.db
    .select()
    .from(cancellationTiers)
    .where(eq(cancellationTiers.isDefault, true));
  if (!category || !neighborhood || !tier) throw new Error('missing parents');
  const [row] = await client.db
    .insert(experiences)
    .values({
      hostId,
      categoryId: category.id,
      neighborhoodId: neighborhood.id,
      cancellationTierId: tier.id,
      slug: unique('experience'),
      name: unique('Experience'),
    })
    .returning();
  if (!row) throw new Error('insert returned no experience');
  return row;
}

/** A host with one experience and the host owner who may act on it. */
async function setup(timeZone?: string) {
  const host = await insertHost(timeZone);
  const experience = await insertExperience(host.id);
  return { host, experience, owner: ownerOf(host.id) };
}

type TemplateFields = Omit<SessionTemplateInput, 'experienceId'>;

const saturdayTenAm: TemplateFields = {
  weekday: 6,
  startTime: '10:00',
  durationMinutes: 120,
  allocation: 8,
  source: 'ramble',
};

async function createTemplate(
  experienceId: string,
  overrides: Partial<TemplateFields> = {},
  caller: Caller = ops,
) {
  const result = await sessionData.createSessionTemplate(caller, {
    experienceId,
    ...saturdayTenAm,
    ...overrides,
  });
  if (!result.ok) throw new Error(`template not created: ${result.reason}`);
  return result.template;
}

async function sessionsOf(templateId: string) {
  return client.db
    .select()
    .from(sessions)
    .where(eq(sessions.templateId, templateId))
    .orderBy(sessions.localDate);
}

async function countSessions(experienceId: string) {
  const [row] = await client.db
    .select({ total: count() })
    .from(sessions)
    .where(eq(sessions.experienceId, experienceId));
  return row?.total ?? 0;
}

type SessionInsert = typeof sessions.$inferInsert;

async function insertSession(
  experienceId: string,
  overrides: { [K in keyof SessionInsert]?: SessionInsert[K] | SQL } = {},
) {
  const [row] = await client.db
    .insert(sessions)
    .values({
      experienceId,
      startsAt: new Date('2026-06-06T14:00:00Z'),
      endsAt: new Date('2026-06-06T16:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 8,
      source: 'ramble',
      ...overrides,
    })
    .returning();
  if (!row) throw new Error('insert returned no session');
  return row;
}

describe('constraints', () => {
  it.each([
    ['weekday above 6', 'session_templates_weekday_in_range', { weekday: 7 }],
    ['weekday below 0', 'session_templates_weekday_in_range', { weekday: -1 }],
    [
      'a start time of 24:00',
      'session_templates_start_time_whole_minute',
      { startTime: '24:00:00' },
    ],
    [
      'a start time with seconds',
      'session_templates_start_time_whole_minute',
      { startTime: '10:00:30' },
    ],
    [
      'a duration of 0',
      'session_templates_duration_in_range',
      { durationMinutes: 0 },
    ],
    [
      'a duration over a day',
      'session_templates_duration_in_range',
      { durationMinutes: 1441 },
    ],
    [
      'a negative allocation',
      'session_templates_allocation_in_range',
      { allocation: -1 },
    ],
    [
      'an allocation over the limit',
      'session_templates_allocation_in_range',
      { allocation: maxAllocation + 1 },
    ],
    [
      'an external source',
      'session_templates_source_generated',
      { source: 'external' as const },
    ],
  ])('refuse a template with %s', async (_name, constraint, override) => {
    const { experience } = await setup();

    await expect(
      client.db.insert(sessionTemplates).values({
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 60,
        allocation: 4,
        ...override,
      }),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuses a second template for the same weekday and start time', async () => {
    const { experience } = await setup();
    await createTemplate(experience.id);

    await expect(
      client.db.insert(sessionTemplates).values({
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 30,
        allocation: 1,
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'session_templates_slot_unique' },
    });
  });

  it('refuses a session whose seats sold exceed its allocation', async () => {
    const { experience } = await setup();

    await expect(
      insertSession(experience.id, { allocation: 4, seatsSold: 5 }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_seats_sold_within_allocation' },
    });
  });

  it('refuses to lower a stored allocation below the seats sold, and keeps the row', async () => {
    const { experience } = await setup();
    const session = await insertSession(experience.id, {
      allocation: 6,
      seatsSold: 4,
    });

    await expect(
      client.db
        .update(sessions)
        .set({ allocation: 3 })
        .where(eq(sessions.id, session.id)),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_seats_sold_within_allocation' },
    });
    await expect(
      client.db
        .update(sessions)
        .set({ seatsSold: 7 })
        .where(eq(sessions.id, session.id)),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_seats_sold_within_allocation' },
    });
    const [stored] = await client.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, session.id));
    expect(stored).toMatchObject({ allocation: 6, seatsSold: 4 });
  });

  it('allows seats sold equal to the allocation', async () => {
    const { experience } = await setup();

    const session = await insertSession(experience.id, {
      allocation: 4,
      seatsSold: 4,
    });

    expect(session.seatsSold).toBe(4);
  });

  it.each([
    [
      'an end at the start',
      'sessions_ends_after_start',
      () => ({ endsAt: new Date('2026-06-06T14:00:00Z') }),
    ],
    [
      'an end before the start',
      'sessions_ends_after_start',
      () => ({ endsAt: new Date('2026-06-06T13:00:00Z') }),
    ],
    [
      'an end of infinity',
      'sessions_ends_at_in_range',
      () => ({ endsAt: sql`'infinity'::timestamptz` }),
    ],
    [
      'a start before year 1000',
      'sessions_starts_at_in_range',
      () => ({
        startsAt: sql`'0500-01-01 00:00:00+00'::timestamptz`,
        endsAt: new Date('2026-06-06T16:00:00Z'),
      }),
    ],
    [
      'a negative allocation',
      'sessions_allocation_in_range',
      () => ({ allocation: -1 }),
    ],
    [
      'an allocation over the limit',
      'sessions_allocation_in_range',
      () => ({ allocation: maxAllocation + 1 }),
    ],
    [
      'negative seats sold',
      'sessions_seats_sold_not_negative',
      () => ({ seatsSold: -1 }),
    ],
    [
      'a zone abbreviation',
      'sessions_time_zone_iana',
      () => ({ timeZone: 'EST' }),
    ],
    [
      'a zone with a space',
      'sessions_time_zone_iana',
      () => ({ timeZone: 'New York' }),
    ],
    [
      'an over-long zone',
      'sessions_time_zone_iana',
      () => ({ timeZone: `America/${'a'.repeat(60)}` }),
    ],
    [
      'a cancelled status with no reason',
      'sessions_cancel_reason_matches_status',
      () => ({ status: 'cancelled' as const }),
    ],
    [
      'a reason on a scheduled session',
      'sessions_cancel_reason_matches_status',
      () => ({ cancelReason: 'host' as const }),
    ],
    ['version 0', 'sessions_version_positive', () => ({ version: 0 })],
    [
      'a local date with no template',
      'sessions_template_has_local_date',
      () => ({ localDate: '2026-06-06' }),
    ],
  ])('refuse a session with %s', async (_name, constraint, override) => {
    const { experience } = await setup();

    await expect(
      insertSession(experience.id, override()),
    ).rejects.toMatchObject({ cause: { constraint } });
  });

  it('refuses a template without a local date, a date outside years 1000 to 9999, and an external generated session', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);
    const generated = {
      templateId: template.id,
      localDate: '2026-06-06',
    };

    await expect(
      insertSession(experience.id, { templateId: template.id }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_template_has_local_date' },
    });
    await expect(
      insertSession(experience.id, { ...generated, localDate: '0999-01-01' }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_local_date_in_range' },
    });
    await expect(
      insertSession(experience.id, { ...generated, source: 'external' }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_template_source_generated' },
    });
  });

  it('refuses a second session for one template and date, and a template of another experience', async () => {
    const { experience } = await setup();
    const other = await setup();
    const template = await createTemplate(experience.id);
    await insertSession(experience.id, {
      templateId: template.id,
      localDate: '2026-06-06',
    });

    await expect(
      insertSession(experience.id, {
        templateId: template.id,
        localDate: '2026-06-06',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_template_local_date_unique' },
    });
    await expect(
      insertSession(other.experience.id, {
        templateId: template.id,
        localDate: '2026-06-13',
      }),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_template_experience_fk' },
    });
  });

  it('keeps sessions without a template unconstrained by the date key', async () => {
    const { experience } = await setup();

    await insertSession(experience.id);
    await insertSession(experience.id);

    expect(await countSessions(experience.id)).toBe(2);
  });

  it('restricts deleting an experience or a template that has sessions', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);
    await insertSession(experience.id, {
      templateId: template.id,
      localDate: '2026-06-06',
    });

    await expect(
      client.db
        .delete(sessionTemplates)
        .where(eq(sessionTemplates.id, template.id)),
    ).rejects.toMatchObject({
      cause: { constraint: 'sessions_template_experience_fk' },
    });
    await expect(
      client.db.delete(experiences).where(eq(experiences.id, experience.id)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});

describe('createSessionTemplate', () => {
  it('lets the host owner create a Ramble template, stored with zero seconds', async () => {
    const { experience, owner } = await setup();

    const result = await sessionData.createSessionTemplate(owner, {
      experienceId: experience.id,
      ...saturdayTenAm,
    });

    expect(result).toMatchObject({
      ok: true,
      template: {
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 120,
        allocation: 8,
        source: 'ramble',
      },
    });
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s create an allocation template', async (_name, caller) => {
    const { experience } = await setup();

    const result = await sessionData.createSessionTemplate(caller, {
      experienceId: experience.id,
      ...saturdayTenAm,
      allocation: 6,
      source: 'allocation',
    });

    expect(result).toMatchObject({
      ok: true,
      template: { source: 'allocation', allocation: 6 },
    });
  });

  it('refuses an allocation template for the host owner, and writes nothing', async () => {
    const { experience, owner } = await setup();

    await expect(
      sessionData.createSessionTemplate(owner, {
        experienceId: experience.id,
        ...saturdayTenAm,
        source: 'allocation',
      }),
    ).rejects.toThrow(ForbiddenError);

    const [row] = await client.db
      .select({ total: count() })
      .from(sessionTemplates)
      .where(eq(sessionTemplates.experienceId, experience.id));
    expect(row?.total).toBe(0);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
    [
      'host staff',
      async () =>
        testCaller({
          roles: [Role.HostStaff],
          hostIds: [(await setup()).host.id],
        }),
    ],
  ])('refuses %s', async (_name, getCaller) => {
    const { experience } = await setup();

    await expect(
      sessionData.createSessionTemplate(await getCaller(), {
        experienceId: experience.id,
        ...saturdayTenAm,
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it('reports a repeat slot and leaves the first template as it was', async () => {
    const { experience, owner } = await setup();
    const first = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.createSessionTemplate(owner, {
      experienceId: experience.id,
      ...saturdayTenAm,
      allocation: 1,
      durationMinutes: 30,
    });

    expect(result).toEqual({ ok: false, reason: 'duplicate_slot' });
    const [stored] = await client.db
      .select()
      .from(sessionTemplates)
      .where(eq(sessionTemplates.id, first.id));
    expect(stored).toMatchObject({ allocation: 8, durationMinutes: 120 });
  });

  it('reports an experience that does not exist', async () => {
    const result = await sessionData.createSessionTemplate(ops, {
      experienceId: '11111111-1111-4111-8111-111111111111',
      ...saturdayTenAm,
    });

    expect(result).toEqual({ ok: false, reason: 'experience_not_found' });
  });

  it.each([
    ['a weekday of 7', { weekday: 7 }],
    ['a start time of 24:00', { startTime: '24:00' }],
    ['an external source', { source: 'external' }],
    ['an allocation over the limit', { allocation: maxAllocation + 1 }],
  ])('throws for %s', async (_name, override) => {
    const { experience } = await setup();

    await expect(
      sessionData.createSessionTemplate(ops, {
        experienceId: experience.id,
        ...saturdayTenAm,
        ...override,
      } as never),
    ).rejects.toThrow();
  });
});

describe('generateSessions', () => {
  const range = { fromDate: '2026-06-06', toDate: '2026-06-27' };

  it('creates a session for each matching date in the host zone, with the template values', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      earlyNow,
    );

    expect(result).toMatchObject({
      ok: true,
      experienceId: experience.id,
      alreadyExisted: 0,
      inThePast: 0,
    });
    const stored = await sessionsOf(template.id);
    expect(stored.map((row) => row.localDate)).toEqual([
      '2026-06-06',
      '2026-06-13',
      '2026-06-20',
      '2026-06-27',
    ]);
    expect(stored[0]).toMatchObject({
      experienceId: experience.id,
      startsAt: new Date('2026-06-06T14:00:00Z'),
      endsAt: new Date('2026-06-06T16:00:00Z'),
      timeZone: 'America/New_York',
      allocation: 8,
      seatsSold: 0,
      status: 'scheduled',
      source: 'ramble',
      cancelReason: null,
      version: 1,
    });
    expect(result.ok && result.created).toHaveLength(4);
  });

  it('holds the wall time across the spring-forward change', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-03-01', toDate: '2026-03-21' },
      earlyNow,
    );

    const starts = (await sessionsOf(template.id)).map((row) =>
      row.startsAt.toISOString(),
    );
    expect(starts).toEqual([
      '2026-03-07T15:00:00.000Z',
      '2026-03-14T14:00:00.000Z',
      '2026-03-21T14:00:00.000Z',
    ]);
  });

  it('uses the host zone, not the server zone', async () => {
    const { experience, owner } = await setup('Europe/London');
    const template = await createTemplate(experience.id, {}, owner);

    await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      earlyNow,
    );

    const [first] = await sessionsOf(template.id);
    expect(first).toMatchObject({
      startsAt: new Date('2026-06-06T09:00:00Z'),
      timeZone: 'Europe/London',
    });
  });

  it('creates nothing new on a rerun over the same range', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    const before = await sessionsOf(template.id);

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    expect(await sessionsOf(template.id)).toEqual(before);
  });

  it('creates only the missing dates over an overlapping range', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-06-06', toDate: '2026-06-20' },
      earlyNow,
    );

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, fromDate: '2026-06-13', toDate: '2026-07-04' },
      earlyNow,
    );

    expect(result.ok && result.created.map((row) => row.localDate)).toEqual([
      '2026-06-27',
      '2026-07-04',
    ]);
    expect(result).toMatchObject({ alreadyExisted: 2 });
    expect(await sessionsOf(template.id)).toHaveLength(5);
  });

  it('creates each date once when two runs overlap in time', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };

    const results = await Promise.all([
      sessionData.generateSessions(owner, input, earlyNow),
      sessionData.generateSessions(owner, input, earlyNow),
      sessionData.generateSessions(owner, input, earlyNow),
    ]);

    const created = results.reduce(
      (total, result) => total + (result.ok ? result.created.length : 0),
      0,
    );
    expect(created).toBe(4);
    expect(await sessionsOf(template.id)).toHaveLength(4);
  });

  it('creates no duplicate when the host zone changed after the first run', async () => {
    const { host, experience, owner } = await setup('America/New_York');
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    await client.db
      .update(hosts)
      .set({ timeZone: 'Europe/London' })
      .where(eq(hosts.id, host.id));

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored[0]?.timeZone).toBe('America/New_York');
  });

  it('does not rebuild an edited session or a cancelled one', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);
    const input = { templateId: template.id, ...range };
    await sessionData.generateSessions(owner, input, earlyNow);
    const [edited, cancelled] = await sessionsOf(template.id);
    if (!edited || !cancelled) throw new Error('expected sessions');
    await client.db
      .update(sessions)
      .set({ allocation: 3, version: 2 })
      .where(eq(sessions.id, edited.id));
    await client.db
      .update(sessions)
      .set({ status: 'cancelled', cancelReason: 'host' })
      .where(eq(sessions.id, cancelled.id));

    const second = await sessionData.generateSessions(owner, input, earlyNow);

    expect(second).toMatchObject({ ok: true, created: [], alreadyExisted: 4 });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored[0]).toMatchObject({ allocation: 3, version: 2 });
    expect(stored[1]).toMatchObject({
      status: 'cancelled',
      cancelReason: 'host',
    });
  });

  it('skips dates that start at or before now and reports how many', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      new Date('2026-06-13T14:00:00Z'),
    );

    expect(result).toMatchObject({ ok: true, inThePast: 2, alreadyExisted: 0 });
    expect((await sessionsOf(template.id)).map((row) => row.localDate)).toEqual(
      ['2026-06-20', '2026-06-27'],
    );
  });

  it('writes nothing and reports when every date is in the past', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {}, owner);

    const result = await sessionData.generateSessions(
      owner,
      { templateId: template.id, ...range },
      new Date('2027-01-01T00:00:00Z'),
    );

    expect(result).toMatchObject({ ok: true, created: [], inThePast: 4 });
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('generates allocation sessions for ops with the allocation as capacity', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id, {
      source: 'allocation',
      allocation: 6,
    });

    const result = await sessionData.generateSessions(
      ops,
      { templateId: template.id, ...range },
      earlyNow,
    );

    expect(result).toMatchObject({ ok: true });
    const stored = await sessionsOf(template.id);
    expect(stored).toHaveLength(4);
    expect(stored.every((row) => row.source === 'allocation')).toBe(true);
    expect(stored.every((row) => row.allocation === 6)).toBe(true);
  });

  it('refuses the host owner for an allocation template, and writes nothing', async () => {
    const { experience, owner } = await setup();
    const template = await createTemplate(experience.id, {
      source: 'allocation',
    });

    await expect(
      sessionData.generateSessions(
        owner,
        { templateId: template.id, ...range },
        earlyNow,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await countSessions(experience.id)).toBe(0);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
  ])('refuses %s, and writes nothing', async (_name, getCaller) => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await expect(
      sessionData.generateSessions(
        await getCaller(),
        { templateId: template.id, ...range },
        earlyNow,
      ),
    ).rejects.toThrow(ForbiddenError);
    expect(await countSessions(experience.id)).toBe(0);
  });

  it.each([
    ['an abbreviation', 'EST'],
    ['a name Intl does not know', 'Nowhere/Land'],
  ])(
    'reports a host zone that is %s, and writes nothing',
    async (_name, zone) => {
      const { host, experience, owner } = await setup();
      const template = await createTemplate(experience.id, {}, owner);
      await client.db
        .update(hosts)
        .set({ timeZone: zone })
        .where(eq(hosts.id, host.id));

      const result = await sessionData.generateSessions(
        owner,
        { templateId: template.id, ...range },
        earlyNow,
      );

      expect(result).toEqual({ ok: false, reason: 'invalid_time_zone' });
      expect(await countSessions(experience.id)).toBe(0);
    },
  );

  it('reports a template that does not exist', async () => {
    const result = await sessionData.generateSessions(
      ops,
      {
        templateId: '11111111-1111-4111-8111-111111111111',
        ...range,
      },
      earlyNow,
    );

    expect(result).toEqual({ ok: false, reason: 'template_not_found' });
  });

  it.each([
    ['a range over 366 days', { fromDate: '2028-01-01', toDate: '2029-01-01' }],
    [
      'a range that runs backwards',
      { fromDate: '2026-06-27', toDate: '2026-06-06' },
    ],
    [
      'a date that is not real',
      { fromDate: '2026-02-30', toDate: '2026-03-30' },
    ],
    ['a malformed template id', { templateId: 'nope', ...range }],
  ])('throws for %s, and writes nothing', async (_name, override) => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await expect(
      sessionData.generateSessions(
        ops,
        { templateId: template.id, ...range, ...override },
        earlyNow,
      ),
    ).rejects.toThrow();
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('generates a full year in one call', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    const result = await sessionData.generateSessions(
      ops,
      { templateId: template.id, fromDate: '2028-01-01', toDate: '2028-12-31' },
      earlyNow,
    );

    expect(result.ok && result.created).toHaveLength(53);
  });
});

describe('updateSessionAllocation', () => {
  async function generated(source: 'ramble' | 'allocation' = 'ramble') {
    const context = await setup();
    const template = await createTemplate(context.experience.id, {
      source,
      allocation: 8,
    });
    await sessionData.generateSessions(
      ops,
      { templateId: template.id, fromDate: '2026-06-06', toDate: '2026-06-06' },
      earlyNow,
    );
    const [session] = await sessionsOf(template.id);
    if (!session) throw new Error('expected a session');
    return { ...context, session };
  }

  async function stored(sessionId: string) {
    const [row] = await client.db
      .select()
      .from(sessions)
      .where(eq(sessions.id, sessionId));
    if (!row) throw new Error('expected a session');
    return row;
  }

  it('raises the capacity and bumps the version', async () => {
    const { session, owner } = await generated();

    const result = await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 12,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({
      ok: true,
      session: { id: session.id, allocation: 12, version: 2 },
    });
    expect(await stored(session.id)).toMatchObject({
      allocation: 12,
      version: 2,
    });
  });

  it('lowers the capacity to exactly the seats sold', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 5 })
      .where(eq(sessions.id, session.id));

    const result = await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 5,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true, session: { allocation: 5 } });
  });

  it('refuses a capacity below the seats sold, naming them, and changes nothing', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 5 })
      .where(eq(sessions.id, session.id));

    const result = await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 4,
      expectedVersion: 1,
    });

    expect(result).toEqual({
      ok: false,
      reason: 'below_seats_sold',
      seatsSold: 5,
    });
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      seatsSold: 5,
      version: 1,
    });
  });

  it('refuses a stale version and changes nothing', async () => {
    const { session, owner } = await generated();
    await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 9,
      expectedVersion: 1,
    });

    const result = await sessionData.updateSessionAllocation(owner, {
      sessionId: session.id,
      allocation: 10,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    expect(await stored(session.id)).toMatchObject({
      allocation: 9,
      version: 2,
    });
  });

  it('lets one of two edits on the same version win', async () => {
    const { session, owner } = await generated();

    const results = await Promise.all([
      sessionData.updateSessionAllocation(owner, {
        sessionId: session.id,
        allocation: 9,
        expectedVersion: 1,
      }),
      sessionData.updateSessionAllocation(owner, {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ]);

    expect(results.filter((result) => result.ok)).toHaveLength(1);
    expect(results.filter((result) => !result.ok)).toEqual([
      { ok: false, reason: 'version_conflict' },
    ]);
    expect((await stored(session.id)).version).toBe(2);
  });

  it('reads the seats sold under the row lock, so a booking that confirms first is counted', async () => {
    const { session, owner } = await generated();
    const booking = await client.db.$client.connect();
    try {
      await booking.query('BEGIN');
      await booking.query('SELECT id FROM sessions WHERE id = $1 FOR UPDATE', [
        session.id,
      ]);
      const pending = sessionData.updateSessionAllocation(owner, {
        sessionId: session.id,
        allocation: 2,
        expectedVersion: 1,
      });
      await new Promise((resolve) => setTimeout(resolve, 150));
      await booking.query('UPDATE sessions SET seats_sold = 3 WHERE id = $1', [
        session.id,
      ]);
      await booking.query('COMMIT');

      await expect(pending).resolves.toEqual({
        ok: false,
        reason: 'below_seats_sold',
        seatsSold: 3,
      });
    } finally {
      booking.release();
    }
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      seatsSold: 3,
    });
  });

  it.each([
    ['ops', ops],
    ['admin', admin],
  ])('lets %s edit an allocation session', async (_name, caller) => {
    const { session } = await generated('allocation');

    const result = await sessionData.updateSessionAllocation(caller, {
      sessionId: session.id,
      allocation: 10,
      expectedVersion: 1,
    });

    expect(result).toMatchObject({ ok: true, session: { allocation: 10 } });
  });

  it('refuses the host owner on an allocation session', async () => {
    const { session, owner } = await generated('allocation');

    await expect(
      sessionData.updateSessionAllocation(owner, {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect((await stored(session.id)).allocation).toBe(8);
  });

  it.each([
    ['the owner of another host', async () => ownerOf((await setup()).host.id)],
    ['a guest', () => Promise.resolve(guest)],
    ['an anonymous caller', () => Promise.resolve(anonymousCaller)],
  ])('refuses %s, and changes nothing', async (_name, getCaller) => {
    const { session } = await generated();

    await expect(
      sessionData.updateSessionAllocation(await getCaller(), {
        sessionId: session.id,
        allocation: 10,
        expectedVersion: 1,
      }),
    ).rejects.toThrow(ForbiddenError);
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      version: 1,
    });
  });

  it('reports a session that does not exist', async () => {
    const result = await sessionData.updateSessionAllocation(ops, {
      sessionId: '11111111-1111-4111-8111-111111111111',
      allocation: 4,
      expectedVersion: 1,
    });

    expect(result).toEqual({ ok: false, reason: 'session_not_found' });
  });

  it.each([
    ['a negative capacity', { allocation: -1 }],
    ['a capacity over the limit', { allocation: maxAllocation + 1 }],
    ['a malformed session id', { sessionId: 'nope' }],
    ['a version of 0', { expectedVersion: 0 }],
  ])('throws for %s, and changes nothing', async (_name, override) => {
    const { session } = await generated();

    await expect(
      sessionData.updateSessionAllocation(ops, {
        sessionId: session.id,
        allocation: 4,
        expectedVersion: 1,
        ...override,
      }),
    ).rejects.toThrow();
    expect(await stored(session.id)).toMatchObject({
      allocation: 8,
      version: 1,
    });
  });
});
