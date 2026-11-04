import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { maxAllocation } from '@/lib/sessions';
import { experiences, sessions, sessionTemplates } from '@/server/db/schema';
import {
  createFreshDatabase,
  expectConstraint,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { sessionsFixtures } from './sessionsFixtures';

vi.mock('next/cache', () => ({ updateTag: vi.fn(), revalidateTag: vi.fn() }));

// Behaviours under test, one per decision, branch or risk:
// - every CHECK, foreign key and unique index on the two tables refuses its bad row; the
//   seats_sold CHECK refuses an insert and a later capacity drop alike
// - the created_at, starts_at and local_date range CHECKs refuse both ends

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

const { setup, createTemplate, countSessions, insertSession } =
  sessionsFixtures(
    () => client,
    () => sessionData,
  );

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

    await expectConstraint(
      client.db.insert(sessionTemplates).values({
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 60,
        allocation: 4,
        ...override,
      }),
      constraint,
    );
  });

  it.each([
    ['before year 1000', sql`'0500-01-01 00:00:00+00'::timestamptz`],
    ['at infinity', sql`'infinity'::timestamptz`],
    ['in year 10000', sql`'10000-01-01 00:00:00+00'::timestamptz`],
  ])('refuses a template created %s', async (_name, createdAt) => {
    const { experience } = await setup();

    await expectConstraint(
      client.db.insert(sessionTemplates).values({
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 60,
        allocation: 4,
        createdAt,
      }),
      'session_templates_created_at_in_range',
    );
  });

  it('refuses a second template for the same weekday and start time', async () => {
    const { experience } = await setup();
    await createTemplate(experience.id);

    await expectConstraint(
      client.db.insert(sessionTemplates).values({
        experienceId: experience.id,
        weekday: 6,
        startTime: '10:00:00',
        durationMinutes: 30,
        allocation: 1,
      }),
      'session_templates_slot_unique',
    );
  });

  it('refuses a session whose seats sold exceed its allocation', async () => {
    const { experience } = await setup();

    await expectConstraint(
      insertSession(experience.id, { allocation: 4, seatsSold: 5 }),
      'sessions_seats_sold_within_allocation',
    );
  });

  it('refuses to lower a stored allocation below the seats sold, and keeps the row', async () => {
    const { experience } = await setup();
    const session = await insertSession(experience.id, {
      allocation: 6,
      seatsSold: 4,
    });

    await expectConstraint(
      client.db
        .update(sessions)
        .set({ allocation: 3 })
        .where(eq(sessions.id, session.id)),
      'sessions_seats_sold_within_allocation',
    );
    await expectConstraint(
      client.db
        .update(sessions)
        .set({ seatsSold: 7 })
        .where(eq(sessions.id, session.id)),
      'sessions_seats_sold_within_allocation',
    );
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

    await expectConstraint(
      insertSession(experience.id, override()),
      constraint,
    );
  });

  it('refuses a template without a local date, a date outside years 1000 to 9999, and an external generated session', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);
    const generated = {
      templateId: template.id,
      localDate: '2026-06-06',
    };

    await expectConstraint(
      insertSession(experience.id, { templateId: template.id }),
      'sessions_template_has_local_date',
    );
    await expectConstraint(
      insertSession(experience.id, { ...generated, source: 'external' }),
      'sessions_template_source_generated',
    );
  });

  it.each([
    ['before year 1000', '0999-12-31'],
    ['in year 10000', '10000-01-01'],
  ])('refuses a local date %s', async (_name, localDate) => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await expectConstraint(
      insertSession(experience.id, { templateId: template.id, localDate }),
      'sessions_local_date_in_range',
    );
  });

  it('accepts local dates at both ends of the range', async () => {
    const { experience } = await setup();
    const template = await createTemplate(experience.id);

    await insertSession(experience.id, {
      templateId: template.id,
      localDate: '1000-01-01',
    });
    await insertSession(experience.id, {
      templateId: template.id,
      localDate: '9999-12-31',
    });

    expect(await countSessions(experience.id)).toBe(2);
  });

  it.each([
    ['at the first instant of year 10000', '10000-01-01 00:00:00+00'],
    ['in year 10000, after a valid end', '10000-06-01 00:00:00+00'],
  ])('refuses a start %s', async (_name, startsAt) => {
    const { experience } = await setup();

    await expect(
      insertSession(experience.id, {
        startsAt: sql`${startsAt}::timestamptz`,
        endsAt: sql`'10000-12-01 00:00:00+00'::timestamptz`,
      }),
    ).rejects.toMatchObject({ cause: { code: '23514' } });
  });

  it('accepts a start at the first instant of year 1000 and one just inside year 9999', async () => {
    const { experience } = await setup();

    await insertSession(experience.id, {
      startsAt: new Date('1000-01-01T00:00:00Z'),
      endsAt: new Date('1000-01-01T01:00:00Z'),
    });
    await insertSession(experience.id, {
      startsAt: new Date('9999-12-31T22:00:00Z'),
      endsAt: new Date('9999-12-31T23:59:59Z'),
    });

    expect(await countSessions(experience.id)).toBe(2);
  });

  it('refuses a second session for one template and date, and a template of another experience', async () => {
    const { experience } = await setup();
    const other = await setup();
    const template = await createTemplate(experience.id);
    await insertSession(experience.id, {
      templateId: template.id,
      localDate: '2026-06-06',
    });

    await expectConstraint(
      insertSession(experience.id, {
        templateId: template.id,
        localDate: '2026-06-06',
      }),
      'sessions_template_local_date_unique',
    );
    await expectConstraint(
      insertSession(other.experience.id, {
        templateId: template.id,
        localDate: '2026-06-13',
      }),
      'sessions_template_experience_fk',
    );
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

    await expectConstraint(
      client.db
        .delete(sessionTemplates)
        .where(eq(sessionTemplates.id, template.id)),
      'sessions_template_experience_fk',
    );
    await expect(
      client.db.delete(experiences).where(eq(experiences.id, experience.id)),
    ).rejects.toMatchObject({ cause: { code: '23503' } });
  });
});
