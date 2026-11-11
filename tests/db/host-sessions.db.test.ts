import { eq, sql } from 'drizzle-orm';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { ForbiddenError } from '@/server/auth/caller';
import { hosts, priceOptions, sessions } from '@/server/db/schema';
import {
  createFreshDatabase,
  serveNeonHttp,
  type FreshDatabase,
} from './harness';
import { insertHold } from './holdFixtures';
import {
  earlyNow,
  guest,
  ops,
  ownerOf,
  sessionsFixtures,
} from './sessionsFixtures';

const cache = vi.hoisted(() => ({
  updateTag: vi.fn<(tag: string) => void>(),
  revalidateTag: vi.fn<(tag: string, profile: string) => void>(),
}));
vi.mock('next/cache', () => cache);

// Behaviours under test, one per decision, branch or risk. The generated session is Saturday
// 2026-06-06, 10:00 to 12:00 New York (14:00Z to 16:00Z), version 1, 8 seats, nothing sold.
// - a time edit on an unbooked session moves the start and end on the same date, bumps the version
//   and keeps the template and date; the same edit on a session with seats sold or an open hold,
//   a cancelled one, a started one, a stale version, or to a time already past, changes nothing
// - a time edit on a one-off session reads its date from the stored start
// - cancelling an unbooked session marks it cancelled by the host, keeps its template and date so
//   publishing never rebuilds it; a session with seats sold or an open hold, a started one, or a
//   stale version is not cancelled
// - a price edit changes the experience's adult price only, and refuses an experience without one
// - a one-off date is the host's own capacity with no template, in the host's zone; past, too far
//   ahead, and a missing experience are refused
// - publishing a week generates the Ramble slots for Monday to Sunday and nothing outside it, is
//   safe to repeat, never rebuilds a cancelled session, never touches an allocation slot, counts
//   dates already past, and refuses a week past the horizon
// - the week read holds this host's sessions from Monday 00:00 to the next Monday 00:00 in the host's
//   zone, with cancelled ones, the adult price and the host's experiences
// - every one of these refuses another host's owner, a guest and, for a session or experience
//   that is not there, answers the same way; an allocation session is staff only; publishing and
//   reading the week are the host owner's alone

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

const {
  setup,
  generated,
  stored,
  createTemplate,
  sessionsOf,
  insertSession,
  insertExperience,
  countSessions,
} = sessionsFixtures(
  () => client,
  () => sessionData,
);

const beforeTheDay = new Date('2026-06-01T00:00:00Z');
const timeInput = (sessionId: string, overrides = {}) => ({
  sessionId,
  startTime: '13:30',
  durationMinutes: 90,
  expectedVersion: 1,
  ...overrides,
});

async function unchanged(sessionId: string) {
  expect(await stored(sessionId)).toMatchObject({
    startsAt: new Date('2026-06-06T14:00:00Z'),
    endsAt: new Date('2026-06-06T16:00:00Z'),
    status: 'scheduled',
    version: 1,
  });
}

describe('updateSessionTime', () => {
  it('moves an unbooked session on its own date and keeps what names it', async () => {
    const { session, owner } = await generated();

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id),
      beforeTheDay,
    );

    expect(result).toMatchObject({ ok: true, session: { version: 2 } });
    expect(await stored(session.id)).toMatchObject({
      startsAt: new Date('2026-06-06T17:30:00Z'),
      endsAt: new Date('2026-06-06T19:00:00Z'),
      localDate: '2026-06-06',
      templateId: session.templateId,
      version: 2,
    });
  });

  it('refuses a session with seats sold', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 1 })
      .where(eq(sessions.id, session.id));

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id),
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'has_bookings' });
    expect(await stored(session.id)).toMatchObject({ version: 1 });
  });

  it('refuses a session with an open hold', async () => {
    const { session, owner } = await generated();
    await insertHold(client.db, session.id, { seats: 2 });

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id),
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'has_holds' });
    await unchanged(session.id);
  });

  it('refuses a stale version', async () => {
    const { session, owner } = await generated();

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id, { expectedVersion: 2 }),
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'version_conflict' });
    await unchanged(session.id);
  });

  it('refuses a session that has started', async () => {
    const { session, owner } = await generated();

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id),
      new Date('2026-06-07T00:00:00Z'),
    );

    expect(result).toEqual({ ok: false, reason: 'in_the_past' });
    await unchanged(session.id);
  });

  it('refuses a new time that has already passed', async () => {
    const { session, owner } = await generated();

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id, { startTime: '07:00' }),
      new Date('2026-06-06T12:00:00Z'),
    );

    expect(result).toEqual({ ok: false, reason: 'in_the_past' });
    await unchanged(session.id);
  });

  it('refuses a cancelled session', async () => {
    const { session, owner } = await generated();
    await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(session.id, { expectedVersion: 2 }),
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'not_scheduled' });
  });

  it('reads a one-off session’s date from its stored start', async () => {
    const { experience, owner } = await setup();
    const added = await sessionData.addOneOffSession(
      owner,
      {
        experienceId: experience.id,
        localDate: '2026-06-06',
        startTime: '10:00',
        durationMinutes: 60,
        allocation: 4,
      },
      beforeTheDay,
    );
    if (!added.ok) throw new Error(added.reason);

    const result = await sessionData.updateSessionTime(
      owner,
      timeInput(added.session.id),
      beforeTheDay,
    );

    expect(result).toMatchObject({ ok: true });
    expect(await stored(added.session.id)).toMatchObject({
      startsAt: new Date('2026-06-06T17:30:00Z'),
      localDate: null,
    });
  });

  it('refuses the owner of another host and a guest, and an allocation session to its own owner', async () => {
    const { session } = await generated();
    const { session: allocated, owner: allocationOwner } =
      await generated('allocation');
    const other = ownerOf((await setup()).host.id);

    for (const [caller, sessionId] of [
      [other, session.id],
      [guest, session.id],
      [allocationOwner, allocated.id],
    ] as const) {
      await expect(
        sessionData.updateSessionTime(
          caller,
          timeInput(sessionId),
          beforeTheDay,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await unchanged(session.id);
    await unchanged(allocated.id);
  });
});

describe('cancelUnbookedSession', () => {
  it('cancels an unbooked session as the host and keeps its date, so publishing does not rebuild it', async () => {
    const { session, owner, host } = await generated();

    const result = await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );

    expect(result).toMatchObject({
      ok: true,
      session: { status: 'cancelled', cancelReason: 'host', version: 2 },
    });
    const published = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      earlyNow,
    );
    expect(published).toMatchObject({
      ok: true,
      created: 0,
      alreadyExisted: 1,
    });
    expect(await sessionsOf(session.templateId ?? '')).toHaveLength(1);
    expect(await stored(session.id)).toMatchObject({ status: 'cancelled' });
  });

  it('refuses a session with seats sold', async () => {
    const { session, owner } = await generated();
    await client.db
      .update(sessions)
      .set({ seatsSold: 2 })
      .where(eq(sessions.id, session.id));

    const result = await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'has_bookings' });
    expect(await stored(session.id)).toMatchObject({ status: 'scheduled' });
  });

  it('refuses a session with an open hold', async () => {
    const { session, owner } = await generated();
    await insertHold(client.db, session.id);

    const result = await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );

    expect(result).toEqual({ ok: false, reason: 'has_holds' });
    await unchanged(session.id);
  });

  it('refuses a session that has started and a stale version', async () => {
    const { session, owner } = await generated();

    expect(
      await sessionData.cancelUnbookedSession(
        owner,
        { sessionId: session.id, expectedVersion: 1 },
        new Date('2026-06-07T00:00:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'in_the_past' });
    expect(
      await sessionData.cancelUnbookedSession(
        owner,
        { sessionId: session.id, expectedVersion: 9 },
        beforeTheDay,
      ),
    ).toEqual({ ok: false, reason: 'version_conflict' });
    await unchanged(session.id);
  });

  it('refuses the owner of another host and an allocation session to its own owner', async () => {
    const { session } = await generated();
    const { session: allocated, owner: allocationOwner } =
      await generated('allocation');
    const other = ownerOf((await setup()).host.id);

    for (const [caller, sessionId] of [
      [other, session.id],
      [allocationOwner, allocated.id],
    ] as const) {
      await expect(
        sessionData.cancelUnbookedSession(
          caller,
          { sessionId, expectedVersion: 1 },
          beforeTheDay,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    await unchanged(session.id);
    await unchanged(allocated.id);
  });
});

describe('updateSessionAllocation on a session that is not open to edits', () => {
  it('refuses a session that has started, and a cancelled one, and changes nothing', async () => {
    const { session, owner } = await generated();
    const edit = { sessionId: session.id, allocation: 12, expectedVersion: 1 };

    expect(
      await sessionData.updateSessionAllocation(
        owner,
        edit,
        new Date('2026-06-07T00:00:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'in_the_past' });
    await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );
    expect(
      await sessionData.updateSessionAllocation(
        owner,
        { ...edit, expectedVersion: 2 },
        beforeTheDay,
      ),
    ).toEqual({ ok: false, reason: 'not_scheduled' });
    expect(await stored(session.id)).toMatchObject({ allocation: 8 });
  });

  it('changes a session that has not started', async () => {
    const { session, owner } = await generated();

    expect(
      await sessionData.updateSessionAllocation(
        owner,
        { sessionId: session.id, allocation: 12, expectedVersion: 1 },
        beforeTheDay,
      ),
    ).toMatchObject({ ok: true, session: { allocation: 12 } });
  });
});

describe('updateSessionPrice', () => {
  async function addPrices(experienceId: string) {
    await client.db.insert(priceOptions).values([
      { experienceId, kind: 'adult', priceMinor: 5000, usesSpace: true },
      { experienceId, kind: 'child', priceMinor: 2500, usesSpace: false },
    ]);
  }
  const priceOf = async (experienceId: string, kind: 'adult' | 'child') => {
    const rows = await client.db
      .select()
      .from(priceOptions)
      .where(eq(priceOptions.experienceId, experienceId));
    return rows.find((row) => row.kind === kind)?.priceMinor;
  };

  it('changes the adult price of the session’s experience and nothing else', async () => {
    const { session, owner, experience } = await generated();
    await addPrices(experience.id);

    const result = await sessionData.updateSessionPrice(
      owner,
      { sessionId: session.id, kind: 'adult', priceMinor: 6250 },
      beforeTheDay,
    );

    expect(result).toEqual({ ok: true, priceMinor: 6250 });
    expect(await priceOf(experience.id, 'adult')).toBe(6250);
    expect(await priceOf(experience.id, 'child')).toBe(2500);
  });

  it('refuses an experience with no adult price', async () => {
    const { session, owner } = await generated();

    expect(
      await sessionData.updateSessionPrice(
        owner,
        { sessionId: session.id, kind: 'adult', priceMinor: 6250 },
        beforeTheDay,
      ),
    ).toEqual({ ok: false, reason: 'no_such_price' });
  });

  it('refuses a form posted for a session that has started or been cancelled, and changes nothing', async () => {
    const { session, owner, experience } = await generated();
    await addPrices(experience.id);
    const input = {
      sessionId: session.id,
      kind: 'adult' as const,
      priceMinor: 6250,
    };

    expect(
      await sessionData.updateSessionPrice(
        owner,
        input,
        new Date('2026-06-07T00:00:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'in_the_past' });
    await sessionData.cancelUnbookedSession(
      owner,
      { sessionId: session.id, expectedVersion: 1 },
      beforeTheDay,
    );
    expect(
      await sessionData.updateSessionPrice(owner, input, beforeTheDay),
    ).toEqual({ ok: false, reason: 'not_scheduled' });
    expect(await priceOf(experience.id, 'adult')).toBe(5000);
  });

  it('refuses the owner of another host, a guest, and an allocation session’s own owner', async () => {
    const { session, experience } = await generated();
    await addPrices(experience.id);
    const { session: allocated, owner: allocationOwner } =
      await generated('allocation');
    const other = ownerOf((await setup()).host.id);

    for (const [caller, sessionId] of [
      [other, session.id],
      [guest, session.id],
      [allocationOwner, allocated.id],
    ] as const) {
      await expect(
        sessionData.updateSessionPrice(
          caller,
          { sessionId, kind: 'adult', priceMinor: 1 },
          beforeTheDay,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(await priceOf(experience.id, 'adult')).toBe(5000);
  });
});

describe('addOneOffSession', () => {
  const input = (experienceId: string, overrides = {}) => ({
    experienceId,
    localDate: '2026-06-06',
    startTime: '09:30',
    durationMinutes: 120,
    allocation: 6,
    ...overrides,
  });

  it('adds the host’s own session with no template, on the date in the host’s zone', async () => {
    const { experience, owner } = await setup('America/Chicago');

    const result = await sessionData.addOneOffSession(
      owner,
      input(experience.id),
      beforeTheDay,
    );

    expect(result).toMatchObject({
      ok: true,
      session: {
        experienceId: experience.id,
        templateId: null,
        localDate: null,
        source: 'ramble',
        allocation: 6,
        seatsSold: 0,
        status: 'scheduled',
        timeZone: 'America/Chicago',
        startsAt: new Date('2026-06-06T14:30:00Z'),
        endsAt: new Date('2026-06-06T16:30:00Z'),
      },
    });
  });

  it('refuses a start that has passed and a date past the horizon', async () => {
    const { experience, owner } = await setup();

    expect(
      await sessionData.addOneOffSession(
        owner,
        input(experience.id),
        new Date('2026-06-07T00:00:00Z'),
      ),
    ).toEqual({ ok: false, reason: 'in_the_past' });
    expect(
      await sessionData.addOneOffSession(
        owner,
        input(experience.id, { localDate: '2028-06-06' }),
        beforeTheDay,
      ),
    ).toEqual({ ok: false, reason: 'beyond_horizon' });
  });

  it('refuses the owner of another host and a guest, and tells only staff an experience is missing', async () => {
    const { experience } = await setup();
    const other = ownerOf((await setup()).host.id);
    const missing = '11111111-1111-4111-8111-111111111111';

    for (const caller of [other, guest]) {
      await expect(
        sessionData.addOneOffSession(
          caller,
          input(experience.id),
          beforeTheDay,
        ),
      ).rejects.toBeInstanceOf(ForbiddenError);
      await expect(
        sessionData.addOneOffSession(caller, input(missing), beforeTheDay),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    expect(
      await sessionData.addOneOffSession(ops, input(missing), beforeTheDay),
    ).toEqual({ ok: false, reason: 'experience_not_found' });
  });
});

describe('publishWeek', () => {
  it('generates the Ramble slots for the week and no other week, and is safe to repeat', async () => {
    const { experience, owner, host } = await setup();
    const slot = await createTemplate(experience.id);

    const first = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-03',
      earlyNow,
    );
    const again = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      earlyNow,
    );

    expect(first).toEqual({
      ok: true,
      templates: 1,
      created: 1,
      alreadyExisted: 0,
      inThePast: 0,
    });
    expect(again).toMatchObject({ ok: true, created: 0, alreadyExisted: 1 });
    expect((await sessionsOf(slot.id)).map((row) => row.localDate)).toEqual([
      '2026-06-06',
    ]);
  });

  it('leaves an allocation slot to ops', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id);
    const allocation = await createTemplate(experience.id, {
      source: 'allocation',
      startTime: '11:00',
    });

    const result = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      earlyNow,
    );

    expect(result).toMatchObject({ ok: true, templates: 1, created: 1 });
    expect(await sessionsOf(allocation.id)).toHaveLength(0);
  });

  it('counts a date already past and creates nothing for it', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id, { weekday: 1 });

    const result = await sessionData.publishWeek(
      owner,
      host.id,
      '2026-06-01',
      new Date('2026-06-03T00:00:00Z'),
    );

    expect(result).toEqual({
      ok: true,
      templates: 1,
      created: 0,
      alreadyExisted: 0,
      inThePast: 1,
    });
  });

  it('says there is nothing to publish for a host with no slots', async () => {
    const { owner, host } = await setup();

    expect(
      await sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).toEqual({
      ok: true,
      templates: 0,
      created: 0,
      alreadyExisted: 0,
      inThePast: 0,
    });
  });

  it('reports a host zone that is not usable and writes nothing, even for slots before the bad one', async () => {
    const { host, experience, owner } = await setup();
    await createTemplate(experience.id);
    await createTemplate(experience.id, { startTime: '12:00' });
    await client.db
      .update(hosts)
      .set({ timeZone: 'Nowhere/Land' })
      .where(eq(hosts.id, host.id));

    expect(
      await sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).toEqual({ ok: false, reason: 'invalid_time_zone' });
    expect(await countSessions(experience.id)).toBe(0);
  });

  it('rolls back every slot when a later one fails, and invalidates nothing', async () => {
    const { host, experience, owner } = await setup();
    const second = await insertExperience(host.id);
    // Slots run in experience order, so the one that fails is the one that runs second.
    const [first, last] =
      experience.id < second.id ? [experience, second] : [second, experience];
    await createTemplate(first.id);
    await createTemplate(last.id);
    const name = `refuse_${last.id.replaceAll('-', '')}`;
    await client.db.execute(
      sql.raw(`CREATE FUNCTION ${name}() RETURNS trigger AS $$
        BEGIN
          IF NEW.experience_id = '${last.id}' THEN
            RAISE EXCEPTION 'refused for the test';
          END IF;
          RETURN NEW;
        END $$ LANGUAGE plpgsql`),
    );
    await client.db.execute(
      sql.raw(
        `CREATE TRIGGER ${name} BEFORE INSERT ON sessions FOR EACH ROW EXECUTE FUNCTION ${name}()`,
      ),
    );
    cache.updateTag.mockClear();

    await expect(
      sessionData.publishWeek(owner, host.id, '2026-06-01', earlyNow),
    ).rejects.toThrow();

    expect(await countSessions(first.id)).toBe(0);
    expect(await countSessions(last.id)).toBe(0);
    expect(cache.updateTag).not.toHaveBeenCalled();
  });

  it('refuses a week that ends past the horizon', async () => {
    const { experience, owner, host } = await setup();
    await createTemplate(experience.id);

    expect(
      await sessionData.publishWeek(owner, host.id, '2028-01-03', earlyNow),
    ).toEqual({ ok: false, reason: 'beyond_horizon' });
  });

  it('is the host owner’s alone: another host’s owner, ops and a guest are refused', async () => {
    const { host } = await setup();
    const other = ownerOf((await setup()).host.id);

    for (const caller of [other, ops, guest]) {
      await expect(
        sessionData.publishWeek(caller, host.id, '2026-06-01', earlyNow),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
  });
});

describe('readHostWeek', () => {
  it('reads this host’s sessions from Monday midnight to the next Monday midnight in the host’s zone', async () => {
    const { experience, owner, host } = await setup();
    await client.db.insert(priceOptions).values({
      experienceId: experience.id,
      kind: 'adult',
      priceMinor: 7500,
      usesSpace: true,
    });
    const at = (startsAt: string, extra = {}) =>
      insertSession(experience.id, {
        startsAt: new Date(startsAt),
        endsAt: new Date(new Date(startsAt).getTime() + 3_600_000),
        ...extra,
      });
    // Monday 2026-06-01 00:00 New York is 04:00Z; Monday 2026-06-08 00:00 is 04:00Z.
    await at('2026-06-01T03:59:00Z');
    const monday = await at('2026-06-01T04:00:00Z');
    const cancelled = await at('2026-06-05T14:00:00Z', {
      status: 'cancelled',
      cancelReason: 'host',
    });
    const sunday = await at('2026-06-08T03:59:00Z');
    await at('2026-06-08T04:00:00Z');
    const stranger = await setup();
    await insertSession(stranger.experience.id, {
      startsAt: new Date('2026-06-02T14:00:00Z'),
      endsAt: new Date('2026-06-02T15:00:00Z'),
    });

    const week = await sessionData.readHostWeek(
      owner,
      host.id,
      '2026-06-03',
      new Date('2026-06-02T00:00:00Z'),
    );

    expect(week).toMatchObject({
      hostName: host.name,
      timeZone: 'America/New_York',
      weekStart: '2026-06-01',
      experiences: [{ id: experience.id, name: experience.name }],
    });
    expect(week?.sessions.map((row) => row.id)).toEqual([
      monday.id,
      cancelled.id,
      sunday.id,
    ]);
    expect(week?.sessions.map((row) => row.status)).toEqual([
      'scheduled',
      'cancelled',
      'scheduled',
    ]);
    expect(week?.sessions[0]?.adultPriceMinor).toBe(7500);
  });

  it('reads this week when the address names one outside the limits', async () => {
    const { owner, host } = await setup();

    const week = await sessionData.readHostWeek(
      owner,
      host.id,
      '1999-01-01',
      new Date('2026-06-03T12:00:00Z'),
    );

    expect(week?.weekStart).toBe('2026-06-01');
  });

  it('is the host owner’s alone, and null for a host that is not there', async () => {
    const { host } = await setup();
    const other = ownerOf((await setup()).host.id);

    for (const caller of [other, ops, guest]) {
      await expect(
        sessionData.readHostWeek(caller, host.id, undefined, beforeTheDay),
      ).rejects.toBeInstanceOf(ForbiddenError);
    }
    const gone = '11111111-1111-4111-8111-111111111111';
    await expect(
      sessionData.readHostWeek(ownerOf(gone), gone, undefined, beforeTheDay),
    ).resolves.toBeNull();
  });
});
